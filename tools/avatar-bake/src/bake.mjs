// Bakes the whole avatar asset set into apps/web/static/avatars/ plus the generated manifest
// apps/web/src/lib/avatars/avatar-manifest.json. Three outputs, one pass:
//   1. STILL SPRITES - every avatar x every accent, the chip representation (M4).
//   2. SPRITE SHEETS - the walk cycle as a horizontal filmstrip, animated on phones with CSS
//      steps() and no JavaScript (docs/decisions/2026-08-14-avatars-in-motion.md, tier 2).
//   3. MODELS - the source GLBs, trimmed by glb-repack.mjs, for the display diorama (tier 3).
// Deterministic on purpose: pinned source zips (packs.mjs), committed recolor targets
// (roster.mjs), fixed render recipe (render-page.html), structural-only model trimming, stable
// filenames and key order, no timestamps. Run `pnpm download` first; `pnpm analyze` renders
// originals + dominant-cell dumps into analysis/ for curating recolor targets.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { accentPalette } from "./accent-palette.mjs";
import { parseGlb, repackGlb } from "./glb-repack.mjs";
import { packs } from "./packs.mjs";
import { avatars, clipsFor, packIdFor } from "./roster.mjs";

const analyzeMode = process.argv.includes("--analyze");
const toolRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(toolRoot));
const downloadsDir = path.join(toolRoot, "downloads");
const spritesDir = path.join(repoRoot, "apps", "web", "static", "avatars");
const modelsDir = path.join(spritesDir, "models");
const webLibDir = path.join(repoRoot, "apps", "web", "src", "lib");
const manifestPath = path.join(webLibDir, "avatars", "avatar-manifest.json");
// The ONE recolor implementation, shared with the shipped diorama; served type-stripped to
// the render page so this tool and apps/web can never hold two versions of the palette math.
const sharedRecolorPath = path.join(webLibDir, "avatars", "palette-recolor.ts");

const SPRITE_SIZE = 192;
// Tuned so the full 27x8 set stays comfortably under the 2 MB budget (0.85 -> ~1 MB total)
// while faces stay clean at 96px.
const WEBP_QUALITY = 0.85;
const TOTAL_BUDGET_BYTES = 2 * 1024 * 1024;

// --- Sprite sheets -------------------------------------------------------------------------
// 10 frames: the Kenney walk cycles are ~0.75-1.0 s loops, so 10 frames is ~12 fps of cycle -
// past the ~8-frame floor where a walk starts to read as a stutter, and short of the ~12-16
// where the extra bytes buy nothing you can see at 96-140 px. It also divides the cycle evenly
// (frame 10 would be frame 0, so the loop needs no duplicate frame) and gives CSS steps(10) a
// round number.
const SHEET_FRAMES = 10;
// Smaller than the still: a sheet is 10 frames wide, and its only surfaces are the join
// preview and the lobby "you're in" card - both well under 160 px on a phone.
const SHEET_FRAME_SIZE = 128;
const SHEET_QUALITY = 0.82;
// ONE sheet per avatar, in the pack's own colors - not one per accent. Measured both ways on
// 2026-08-14: per-accent (216 sheets) is 4648 KB, accent-neutral (27 sheets) is 582 KB. Eight
// times the committed bytes buys a difference nobody sees, because the sheet's two surfaces
// (join preview, lobby "you're in" card) show ONE avatar on its accent-colored backing chip -
// the same "the backing says which player, the sprite says which avatar" split the 24px chip
// has always used (src/lib/avatars/avatar-chip.svelte). Reversing this is one constant plus a
// re-bake if the owner ever wants it; the price is recorded above so that is a decision with
// a number on it. Matches docs/decisions/2026-08-14-avatars-in-motion.md ("accent-neutral
// base").
const SHEET_BUDGET_BYTES = 1024 * 1024;

// --- Models --------------------------------------------------------------------------------
// The trimmed GLBs the display diorama loads. Budget is generous relative to the measured
// ~2 MB because it is a one-device, one-load payload; the check exists to catch a repack that
// silently stopped trimming, not to squeeze bytes.
const MODEL_BUDGET_BYTES = 3 * 1024 * 1024;

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
// don't work over file://). Serves the tool dir (render page, three), downloads/, the models
// this run just wrote, and /shared/palette-recolor.js - the app's own recolor module with its
// type annotations erased, which is how one file serves both the bake and the browser.
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
    ["/models/", modelsDir],
  ]);
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (url === "/shared/palette-recolor.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(
        stripTypeScriptTypes(readFileSync(sharedRecolorPath, "utf8"), { mode: "strip" }),
      );
      return;
    }
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

/**
 * Ship the models: trim each roster avatar's GLB (plus the wheelchair prop) to its three role
 * clips and write it under static/avatars/models/, together with each pack's shared colormap
 * PNG - the GLBs reference it by relative URI (Textures/colormap.png), which is exactly why
 * the models are this small and why the texture ships once per pack instead of 27 times.
 */
function colormapFileNameFor(packId) {
  return `${packId}-colormap.png`;
}

/** Load a pack GLB and point its texture URI at our flat, pack-scoped colormap filename. */
function loadForShipping(packId, inPackPath) {
  const parsed = parseGlb(readFileSync(path.join(downloadsDir, packId, inPackPath)));
  for (const image of parsed.json.images ?? []) {
    // Source URI is "Textures/colormap.png", relative to the GLB. Our models dir is flat and
    // holds both packs, so each model points at its own pack's copy - which keeps the shipped
    // GLBs correct in any glTF viewer, and lets the diorama recolor by REPLACING the texture
    // image rather than by reconstructing material state.
    if (image.uri !== undefined) image.uri = colormapFileNameFor(packId);
  }
  return parsed;
}

function shipModels() {
  const modelFiles = new Map(); // output filename -> bytes
  for (const avatar of avatars) {
    const packId = packIdFor(avatar);
    const pack = packs[packId];
    const keep = [...new Set(Object.values(clipsFor(avatar)))];
    modelFiles.set(
      `${avatar.id}.glb`,
      repackGlb(loadForShipping(packId, pack.modelFile(avatar.id)), keep),
    );
    for (const extraFile of avatar.extraModelFiles ?? []) {
      // Props (the wheelchair) carry no animation we play; strip every clip.
      const propName = path.basename(extraFile);
      if (modelFiles.has(propName)) continue;
      modelFiles.set(propName, repackGlb(loadForShipping(packId, extraFile), []));
    }
  }
  // One colormap per pack, named after the pack so the two never collide in the flat dir.
  const colormapFiles = new Map();
  for (const [packId, pack] of Object.entries(packs)) {
    colormapFiles.set(
      colormapFileNameFor(packId),
      readFileSync(path.join(downloadsDir, packId, pack.colormapFile)),
    );
  }

  mkdirSync(modelsDir, { recursive: true });
  const expected = new Set([...modelFiles.keys(), ...colormapFiles.keys()]);
  let totalBytes = 0;
  for (const [fileName, bytes] of [...modelFiles, ...colormapFiles]) {
    writeFileSync(path.join(modelsDir, fileName), bytes);
    totalBytes += bytes.length;
  }
  for (const existing of readdirSync(modelsDir)) {
    if (!expected.has(existing)) {
      rmSync(path.join(modelsDir, existing));
      console.log(`removed stale model file ${existing}`);
    }
  }
  return { totalBytes, fileCount: expected.size, colormapFiles };
}

function dataUriBytes(dataUri) {
  return Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
}

assertPresetAccentsCovered();
assertDownloadsPresent();

// Models first: the sheet pass renders from the SHIPPED models, so a broken repack surfaces
// as a broken walk cycle in this same run instead of on a projector three weeks later.
const shipped = analyzeMode ? null : shipModels();

const jobAvatars = avatars.map((avatar) => {
  const packId = packIdFor(avatar);
  const pack = packs[packId];
  const clips = clipsFor(avatar);
  return {
    id: avatar.id,
    kind: avatar.kind,
    // Stills render from the raw pack file (the committed 216 sprites are pinned to it);
    // sheets render from what we ship.
    modelUrl: `/packs/${packId}/${pack.modelFile(avatar.id)}`,
    sheetModelUrl: `/models/${avatar.id}.glb`,
    extraModelUrls: (avatar.extraModelFiles ?? []).map((file) => `/packs/${packId}/${file}`),
    sheetExtraModelUrls: (avatar.extraModelFiles ?? []).map(
      (file) => `/models/${path.basename(file)}`,
    ),
    colormapUrl: `/packs/${packId}/${pack.colormapFile}`,
    recolorTargets: avatar.recolorTargets,
    tolerance: avatar.tolerance,
    walkClipName: clips.walk,
    idleClipName: clips.idle,
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
  sheet: {
    frames: SHEET_FRAMES,
    size: SHEET_FRAME_SIZE,
    quality: SHEET_QUALITY,
    enabled: !analyzeMode,
  },
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

// Write sprites and sheets with stable names; sweep stale files so renames can't leave
// orphans. Sheets are `{avatar}--walk.webp`, which cannot collide with a still's
// `{avatar}--{accent}.webp` because no accent is named "walk" (the accent-id shape is checked
// by the manifest gate).
mkdirSync(spritesDir, { recursive: true });
const expectedFiles = new Set();
let totalBytes = 0;
let sheetBytes = 0;
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
  const sheetFileName = `${avatar.id}--walk.webp`;
  const sheetFileBytes = dataUriBytes(result.sheets[avatar.id]);
  writeFileSync(path.join(spritesDir, sheetFileName), sheetFileBytes);
  expectedFiles.add(sheetFileName);
  sheetBytes += sheetFileBytes.length;

  manifestAvatars.push({
    id: avatar.id,
    kind: avatar.kind,
    displayName: avatar.displayName,
    sprites: spriteFiles,
    // The animated tier: one filmstrip, the avatar's own colors. `clip` records which clip
    // actually got rendered, so an avatar that fell back to idle for want of a walk cycle is
    // visible in the manifest rather than a silent surprise.
    sheet: { file: sheetFileName, clip: result.sheetClips[avatar.id] },
    // The live tier: the trimmed GLB plus everything the diorama needs to instance and
    // recolor it without hard-coding pack knowledge in shipped code.
    model: {
      file: `${avatar.id}.glb`,
      colormap: colormapFileNameFor(packIdFor(avatar)),
      props: (avatar.extraModelFiles ?? []).map((file) => path.basename(file)),
      clips: clipsFor(avatar),
      recolorTargets: avatar.recolorTargets,
      tolerance: avatar.tolerance ?? null,
    },
  });
}
for (const existing of readdirSync(spritesDir)) {
  if (existing.endsWith(".webp") && !expectedFiles.has(existing)) {
    rmSync(path.join(spritesDir, existing));
    console.log(`removed stale sprite ${existing}`);
  }
}

const manifest = {
  // Bump when the manifest shape changes; the loader in apps/web asserts on it. v2 added the
  // sprite-sheet and model tiers (docs/decisions/2026-08-14-avatars-in-motion.md).
  version: 2,
  spriteSize: SPRITE_SIZE,
  basePath: "/avatars/",
  modelPath: "/avatars/models/",
  sheet: { frames: SHEET_FRAMES, frameSize: SHEET_FRAME_SIZE },
  accents: accentPalette,
  avatars: manifestAvatars,
};
mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(
  `baked ${avatars.length} avatars x ${accentPalette.length} accents:\n` +
    `  stills ${(totalBytes / 1024).toFixed(0)} KB\n` +
    `  sheets ${(sheetBytes / 1024).toFixed(0)} KB (${SHEET_FRAMES} frames @ ${SHEET_FRAME_SIZE}px)\n` +
    `  models ${(shipped.totalBytes / 1024).toFixed(0)} KB (${shipped.fileCount} files)`,
);
const overBudget = [
  ["sprite", totalBytes, TOTAL_BUDGET_BYTES],
  ["sheet", sheetBytes, SHEET_BUDGET_BYTES],
  ["model", shipped.totalBytes, MODEL_BUDGET_BYTES],
].filter(([, actual, budget]) => actual > budget);
for (const [label, actual, budget] of overBudget) {
  console.error(
    `${label} total ${(actual / 1024).toFixed(0)} KB exceeds its ${(budget / 1024).toFixed(0)} KB ` +
      `budget - see tools/avatar-bake/README.md "size budget"`,
  );
}
if (overBudget.length > 0) process.exit(1);
