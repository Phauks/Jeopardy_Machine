// Bakes every avatar x every accent to webp sprites in apps/web/static/avatars/ plus the
// generated manifest apps/web/src/lib/avatars/avatar-manifest.json. Deterministic on purpose:
// pinned source zips (packs.mjs), committed recolor targets (roster.mjs), fixed render recipe
// (render-page.html), stable filenames and key order, no timestamps. Run `pnpm download`
// first; `pnpm analyze` renders originals + dominant-cell dumps into analysis/ for curating
// recolor targets.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { accentPalette } from "./accent-palette.mjs";
import { packs } from "./packs.mjs";
import { avatars, packIdFor } from "./roster.mjs";

const analyzeMode = process.argv.includes("--analyze");
const toolRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(toolRoot));
const downloadsDir = path.join(toolRoot, "downloads");
const spritesDir = path.join(repoRoot, "apps", "web", "static", "avatars");
const manifestPath = path.join(
  repoRoot,
  "apps",
  "web",
  "src",
  "lib",
  "avatars",
  "avatar-manifest.json",
);

const SPRITE_SIZE = 192;
// Tuned so the full 27x8 set stays comfortably under the 2 MB budget (0.85 -> ~1 MB total)
// while faces stay clean at 96px.
const WEBP_QUALITY = 0.85;
const TOTAL_BUDGET_BYTES = 2 * 1024 * 1024;

// The palette must contain every theme preset's accentColor (accent-palette.mjs documents
// why). Parsing the presets file keeps this check zero-config: add a preset -> the bake tells
// you if the palette needs a new color.
function assertPresetAccentsCovered() {
  const presetsSource = readFileSync(
    path.join(repoRoot, "apps", "web", "src", "lib", "theme", "theme-presets.ts"),
    "utf8",
  );
  const presetAccents = [...presetsSource.matchAll(/accentColor:\s*"(#[0-9a-fA-F]{6})"/g)].map(
    (match) => match[1].toLowerCase(),
  );
  if (presetAccents.length === 0) {
    throw new Error("no accentColor values found in theme-presets.ts - parser out of date?");
  }
  const paletteHexes = new Set(accentPalette.map((accent) => accent.hex.toLowerCase()));
  const missing = presetAccents.filter((hex) => !paletteHexes.has(hex));
  if (missing.length > 0) {
    throw new Error(
      `theme preset accent(s) ${missing.join(", ")} missing from accent-palette.mjs - ` +
        `add them and re-bake (tools/avatar-bake/README.md)`,
    );
  }
}

function assertDownloadsPresent() {
  for (const [packId, pack] of Object.entries(packs)) {
    const colormap = path.join(downloadsDir, packId, pack.colormapFile);
    if (!existsSync(colormap)) {
      throw new Error(`missing ${colormap} - run \`pnpm download\` first`);
    }
  }
}

// Tiny static server: the render page needs http (module scripts + canvas-readable textures
// don't work over file://). Serves the tool dir (render page, three) and downloads/.
function startServer() {
  const contentTypes = new Map([
    [".html", "text/html"],
    [".js", "text/javascript"],
    [".png", "image/png"],
    [".glb", "model/gltf-binary"],
  ]);
  const roots = new Map([
    ["/render-page.html", path.join(toolRoot, "src", "render-page.html")],
    ["/three/", path.join(toolRoot, "node_modules", "three")],
    ["/packs/", downloadsDir],
  ]);
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let filePath = null;
    if (url === "/render-page.html") filePath = roots.get(url);
    else {
      for (const [prefix, root] of roots) {
        if (prefix.endsWith("/") && url.startsWith(prefix)) {
          const candidate = path.normalize(path.join(root, url.slice(prefix.length)));
          if (candidate.startsWith(root)) filePath = candidate;
          break;
        }
      }
    }
    if (filePath === null || !existsSync(filePath)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
    });
    response.end(readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function dataUriBytes(dataUri) {
  return Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
}

assertPresetAccentsCovered();
assertDownloadsPresent();

const jobAvatars = avatars.map((avatar) => {
  const packId = packIdFor(avatar);
  const pack = packs[packId];
  return {
    id: avatar.id,
    kind: avatar.kind,
    modelUrl: `/packs/${packId}/${pack.modelFile(avatar.id)}`,
    extraModelUrls: (avatar.extraModelFiles ?? []).map((file) => `/packs/${packId}/${file}`),
    colormapUrl: `/packs/${packId}/${pack.colormapFile}`,
    recolorTargets: avatar.recolorTargets,
    tolerance: avatar.tolerance,
  };
});

const server = await startServer();
const port = server.address().port;
// The sandbox has a system chromium (no GPU - swiftshader does the GL); a dev machine can
// omit the env var and use playwright's own browser (`npx playwright install chromium` once).
const browser = await chromium.launch({
  executablePath: process.env.AVATAR_BAKE_BROWSER || undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("[page]", error.message));
await page.goto(`http://127.0.0.1:${port}/render-page.html`);
await page.waitForFunction("window.readyFlag === true", { timeout: 20000 });
const result = await page.evaluate((job) => window.run(job), {
  avatars: jobAvatars,
  accents: accentPalette,
  size: SPRITE_SIZE,
  quality: WEBP_QUALITY,
  analyze: analyzeMode,
});
await browser.close();
server.close();

if (analyzeMode) {
  const analysisDir = path.join(toolRoot, "analysis");
  rmSync(analysisDir, { recursive: true, force: true });
  mkdirSync(analysisDir, { recursive: true });
  const summary = {};
  for (const [avatarId, entry] of Object.entries(result.analysis)) {
    writeFileSync(path.join(analysisDir, `${avatarId}.webp`), dataUriBytes(entry.original));
    summary[avatarId] = { dominant: entry.dominant, clips: entry.clips };
  }
  writeFileSync(path.join(analysisDir, "analysis.json"), JSON.stringify(summary, null, 2));
  console.log(`analyze: wrote ${Object.keys(result.analysis).length} originals to analysis/`);
  process.exit(0);
}

// Write sprites with stable names; sweep stale files so renames can't leave orphans.
mkdirSync(spritesDir, { recursive: true });
const expectedFiles = new Set();
let totalBytes = 0;
const manifestAvatars = [];
for (const avatar of avatars) {
  const spriteFiles = {};
  for (const accent of accentPalette) {
    const fileName = `${avatar.id}--${accent.id}.webp`;
    const bytes = dataUriBytes(result.sprites[avatar.id][accent.id]);
    writeFileSync(path.join(spritesDir, fileName), bytes);
    expectedFiles.add(fileName);
    totalBytes += bytes.length;
    spriteFiles[accent.id] = fileName;
  }
  manifestAvatars.push({
    id: avatar.id,
    kind: avatar.kind,
    displayName: avatar.displayName,
    sprites: spriteFiles,
  });
}
for (const existing of readdirSync(spritesDir)) {
  if (existing.endsWith(".webp") && !expectedFiles.has(existing)) {
    rmSync(path.join(spritesDir, existing));
    console.log(`removed stale sprite ${existing}`);
  }
}

const manifest = {
  // Bump when the manifest shape changes; the loader in apps/web asserts on it.
  version: 1,
  spriteSize: SPRITE_SIZE,
  basePath: "/avatars/",
  accents: accentPalette,
  avatars: manifestAvatars,
};
mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const spriteCount = expectedFiles.size;
console.log(
  `baked ${spriteCount} sprites (${avatars.length} avatars x ${accentPalette.length} accents), ` +
    `${(totalBytes / 1024).toFixed(0)} KB total`,
);
if (totalBytes > TOTAL_BUDGET_BYTES) {
  console.error(
    `total exceeds the ${TOTAL_BUDGET_BYTES / 1024} KB budget - lower WEBP_QUALITY or revisit ` +
      `the sprite matrix (README "size budget")`,
  );
  process.exit(1);
}
