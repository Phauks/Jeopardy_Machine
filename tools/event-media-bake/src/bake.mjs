// The event picture-round image pipeline: Wikimedia Commons originals in, committed web-sized
// files out, with the event pack rewritten to point at them.
//
// There is no source table here on purpose. The pack IS the source table: every image's file
// page, author, license and Commons sha1 already ride in
// apps/web/static/games/board-game-club-x-els/event-pack.pack.json under
// ext["com.jeopardy-machine.event.media-verification"], put there by the curation pass. A
// second copy in this directory would be one more thing to drift.
//
// What the run does, per image:
//   1. Ask the Commons API about the file page and CHECK the license short name and the file's
//      sha1 against what the pack recorded. A relicensed file, or an uploader who replaced the
//      bytes under the same name, fails the whole run - the pack's record would otherwise
//      describe a file that no longer exists.
//   2. Download the original and check its sha1 against the API's - a truncated download cannot
//      slip through as a valid image.
//   3. Downscale to at most 2560 px on the long edge (never upscale) and encode WebP.
//   4. Rewrite the pack: real bytes, real sha256, mime, and storage state `bundled` pointing at
//      the committed file. The ext record grows the acquisition facts (source sha256, committed
//      dimensions, re-verification date) and loses its placeholder apology.
//   5. Re-hash the formatted pack into the game's content.sha256, because the game links the
//      pack by the sha256 of its exact committed bytes.
//
// Run: pnpm -F @jeopardy/event-media-bake bake   (add --offline to reuse downloads/)
//
// The fetch loops are SEQUENTIAL on purpose - Commons rate-limits this kind of egress (the
// curation pass hit HTTP 429 with a 600 s retry-after), and eight images fetched politely one
// at a time is both faster in practice and better behaviour toward a donated CDN. Hence the
// file-level exemption below rather than a Promise.all.
/* oxlint-disable no-await-in-loop */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const repositoryRoot = new URL("../../../", import.meta.url);
const eventDirectory = new URL("apps/web/static/games/board-game-club-x-els/", repositoryRoot);
const packFile = new URL("event-pack.pack.json", eventDirectory);
const gameFile = new URL("event-game.game.json", eventDirectory);
const mediaDirectory = new URL("media/", eventDirectory);
const downloadsDirectory = new URL("../downloads/", import.meta.url);

const verificationKey = "com.jeopardy-machine.event.media-verification";

/**
 * Cap on the long edge. The worklist wants >=1920 px for a 1080p projector and prefers >=2560
 * so a crop still survives; going past 2560 buys nothing on any projector this game will meet
 * and costs megabytes in a repository and in an export zip.
 */
const maximumLongEdge = 2560;
/** Floor the bake refuses to go under - below this a picture clue stops reading from the back. */
const minimumLongEdge = 1920;
/**
 * WebP over JPEG: the repository already commits WebP for every avatar sprite, so the asset
 * story stays one format; it is 25-35% smaller than visually equivalent JPEG, which matters
 * against the 10 MiB per-image cap in @jeopardy/protocol/limits and in an export zip; and every
 * browser that can run this app (Web Audio, modern CSS, Safari 14+) decodes it.
 */
const webpQuality = 82;
const userAgent = "jeopardy-machine-event-media-bake/0.0 (repository tooling; contact via repo)";

function sha1(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Commons occasionally rate-limits this kind of egress (HTTP 429); back off rather than fail. */
async function fetchWithRetry(url, { attempts = 5 } = {}) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": userAgent } });
    if (response.ok) return response;
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  throw new Error(`${url} returned HTTP ${lastStatus}`);
}

async function readCommonsFile(filePage) {
  const title = decodeURIComponent(filePage.replace("https://commons.wikimedia.org/wiki/", ""));
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("prop", "imageinfo");
  endpoint.searchParams.set("iiprop", "url|size|mime|sha1|extmetadata");
  endpoint.searchParams.set("titles", title);
  const response = await fetchWithRetry(endpoint.toString());
  const payload = await response.json();
  const page = Object.values(payload.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`no imageinfo for ${title} - the file page may be gone`);
  return {
    title,
    // The API decorates the original URL with campaign parameters; the bare one is what the
    // pack recorded and what a human would copy off the file page.
    url: info.url.split("?")[0],
    width: info.width,
    height: info.height,
    bytes: info.size,
    mime: info.mime,
    sha1: info.sha1,
    license: info.extmetadata?.LicenseShortName?.value?.trim(),
    artist: info.extmetadata?.Artist?.value,
  };
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${args.join(" ")}):\n${result.stderr?.toString() ?? ""}`);
  }
}

function probeDimensions(file) {
  const result = spawnSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    file,
  ]);
  const [width, height] = result.stdout.toString().trim().split("x").map(Number);
  return { width, height };
}

function encodeWebp(sourceFile, targetFile, source) {
  const longEdge = Math.max(source.width, source.height);
  // Never upscale: an image already under the cap ships at its own size, because inventing
  // pixels adds bytes and no detail.
  const scale =
    longEdge > maximumLongEdge
      ? `scale=w=${maximumLongEdge}:h=${maximumLongEdge}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd`
      : "null";
  runFfmpeg([
    "-i",
    sourceFile,
    "-vf",
    scale,
    "-c:v",
    "libwebp",
    "-quality",
    String(webpQuality),
    "-compression_level",
    "6",
    "-preset",
    "photo",
    // No EXIF, no timestamps: two bakes of one input must be byte-identical.
    "-map_metadata",
    "-1",
    "-frames:v",
    "1",
    targetFile,
  ]);
}

function formatFiles(paths) {
  const formatter = new URL("node_modules/.bin/vp", repositoryRoot).pathname;
  if (!existsSync(formatter)) throw new Error("vp not installed - run pnpm install first");
  const result = spawnSync(formatter, ["fmt", ...paths], { cwd: repositoryRoot.pathname });
  if (result.status !== 0) {
    throw new Error(`vp fmt failed:\n${result.stderr?.toString() ?? ""}`);
  }
}

export async function bake({ offline = false, log = console.log } = {}) {
  mkdirSync(mediaDirectory, { recursive: true });
  mkdirSync(downloadsDirectory, { recursive: true });

  const pack = JSON.parse(readFileSync(packFile, "utf8"));
  const verification = pack.ext[verificationKey];
  const rows = [];

  for (const asset of pack.body.media) {
    const record = verification[asset.id];
    if (!record) throw new Error(`media ${asset.id} has no verification record in the pack ext`);
    const imageId = record.imageId;

    const commons = await readCommonsFile(record.filePage);
    if (commons.license !== record.license) {
      throw new Error(
        `${imageId}: Commons now says "${commons.license}", the pack recorded "${record.license}" - re-audition before bundling`,
      );
    }
    if (commons.sha1 !== record.commonsSha1) {
      throw new Error(
        `${imageId}: the file behind ${record.filePage} was replaced (sha1 changed) - re-verify the new upload`,
      );
    }

    const extension = commons.url.split(".").pop().toLowerCase();
    const sourceFile = new URL(`${imageId}.original.${extension}`, downloadsDirectory);
    let sourceBytes;
    if (offline && existsSync(sourceFile)) {
      sourceBytes = readFileSync(sourceFile);
    } else {
      const response = await fetchWithRetry(commons.url);
      sourceBytes = Buffer.from(await response.arrayBuffer());
      writeFileSync(sourceFile, sourceBytes);
    }
    if (sha1(sourceBytes) !== commons.sha1) {
      throw new Error(`${imageId}: downloaded bytes do not match the Commons sha1`);
    }

    const file = `${imageId}.webp`;
    const targetFile = new URL(file, mediaDirectory);
    encodeWebp(sourceFile.pathname, targetFile.pathname, commons);
    const outputBytes = readFileSync(targetFile);
    const dimensions = probeDimensions(targetFile.pathname);
    const longEdge = Math.max(dimensions.width, dimensions.height);
    if (longEdge > maximumLongEdge) throw new Error(`${imageId}: ${longEdge} px exceeds the cap`);
    if (longEdge < minimumLongEdge) {
      throw new Error(`${imageId}: ${longEdge} px is below the ${minimumLongEdge} px floor`);
    }

    asset.mime = "image/webp";
    asset.bytes = outputBytes.length;
    asset.sha256 = sha256(outputBytes);
    asset.storage = { state: "bundled", path: `media/${file}` };

    verification[asset.id] = {
      imageId,
      filePage: record.filePage,
      author: record.author,
      license: record.license,
      commonsSha1: commons.sha1,
      verified: new Date().toISOString().slice(0, 10),
      sourceUrl: commons.url,
      sourceBytes: sourceBytes.length,
      sourceSha256: sha256(sourceBytes),
      sourcePixels: `${commons.width}x${commons.height}`,
      committedPixels: `${dimensions.width}x${dimensions.height}`,
      note: record.note,
    };

    rows.push({
      imageId,
      file,
      license: record.license,
      author: record.author,
      filePage: record.filePage,
      sourcePixels: `${commons.width}x${commons.height}`,
      sourceBytes: sourceBytes.length,
      committedPixels: `${dimensions.width}x${dimensions.height}`,
      bytes: outputBytes.length,
    });
    log(
      `  ${imageId}  ${commons.width}x${commons.height} ${(sourceBytes.length / 1024 / 1024).toFixed(1)} MB` +
        ` -> ${dimensions.width}x${dimensions.height} ${(outputBytes.length / 1024).toFixed(0)} KiB webp`,
    );
  }

  const kept = new Set(rows.map((row) => row.file));
  for (const name of readdirSync(mediaDirectory)) {
    if (kept.has(name)) continue;
    rmSync(new URL(name, mediaDirectory));
    log(`  swept stale ${name}`);
  }

  // Write, format, THEN hash: the game links the pack by the sha256 of its exact committed
  // bytes, and the committed bytes are whatever the formatter last said they are.
  writeFileSync(packFile, `${JSON.stringify(pack, null, 2)}\n`);
  formatFiles([packFile.pathname]);
  const packSha256 = sha256(readFileSync(packFile));

  const game = JSON.parse(readFileSync(gameFile, "utf8"));
  game.body.content.sha256 = packSha256;
  writeFileSync(gameFile, `${JSON.stringify(game, null, 2)}\n`);
  formatFiles([gameFile.pathname]);

  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  log(
    `\n${rows.length} images, ${(total / 1024).toFixed(0)} KiB committed; pack sha256 ${packSha256.slice(0, 12)}... written into the game`,
  );
  return { rows, total, packSha256 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bake({ offline: process.argv.includes("--offline") });
}
