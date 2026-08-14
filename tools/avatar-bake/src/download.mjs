// Downloads + verifies + unzips the two Kenney packs into downloads/ (gitignored - CC0 assets
// are fetched, only their BAKED derivatives are committed). Safe to re-run; skips packs whose
// zip already verifies. Requires `unzip` on PATH.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packs } from "./packs.mjs";

const toolRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const downloadsDir = path.join(toolRoot, "downloads");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// node's fetch (undici) ignores HTTPS_PROXY; curl honors it. Try fetch first (the plain
// no-proxy case), fall back to curl so proxied environments work too.
async function fetchBytes(url) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.warn(`fetch failed (${error.message ?? error}); retrying via curl`);
    return execFileSync("curl", ["-fsSL", url], { maxBuffer: 512 * 1024 * 1024 });
  }
}

for (const [packId, pack] of Object.entries(packs)) {
  const zipPath = path.join(downloadsDir, `${packId}.zip`);
  const extractDir = path.join(downloadsDir, packId);
  mkdirSync(downloadsDir, { recursive: true });

  let bytes = null;
  if (existsSync(zipPath)) {
    bytes = readFileSync(zipPath);
    if (sha256(bytes) !== pack.sha256) {
      console.warn(`${packId}: cached zip hash mismatch, re-downloading`);
      bytes = null;
    }
  }
  if (bytes === null) {
    console.log(`${packId}: downloading ${pack.zipUrl}`);
    // eslint-disable-next-line no-await-in-loop -- two packs, downloaded sequentially on purpose
    bytes = await fetchBytes(pack.zipUrl);
    writeFileSync(zipPath, bytes);
  }

  const digest = sha256(bytes);
  if (digest !== pack.sha256) {
    console.error(
      `${packId}: sha256 mismatch\n  expected ${pack.sha256}\n  actual   ${digest}\n` +
        `If kenney.nl republished the pack, verify its License.txt still says CC0, update ` +
        `zipUrl+sha256 in src/packs.mjs, and re-bake.`,
    );
    process.exit(1);
  }

  rmSync(extractDir, { recursive: true, force: true });
  execFileSync("unzip", ["-q", zipPath, "-d", extractDir]);
  const licenseText = readFileSync(path.join(extractDir, "License.txt"), "utf8");
  if (!licenseText.includes("Creative Commons Zero, CC0")) {
    console.error(`${packId}: License.txt no longer states CC0 - stop and re-verify licensing.`);
    process.exit(1);
  }
  console.log(`${packId}: ok (sha256 ${digest.slice(0, 12)}..., License.txt confirms CC0)`);
}
