// Rewrites the PURE-DATA fields of the generated avatar manifest from their sources, without
// rendering anything.
//
// WHY THIS IS NOT CHEATING THE "never edit the manifest by hand" RULE, AND WHEN TO USE IT:
// most of avatar-manifest.json describes pixels - filenames, sprite sizes, which clip a
// filmstrip actually caught - and none of that can be known without running the real bake.
// But some of it is roster data that merely travels in the manifest: the accent palette, the
// skin-tone palette, each avatar's recolorTargets and tolerance. Those come from .mjs files
// sitting next to this one, they do not depend on a single rendered pixel, and copying them
// forward cannot invalidate a committed sprite.
//
// So when a change touches ONLY those fields - which is what adding the browser-side recolor
// to the phone did (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md) - this
// script is the correct tool: it keeps the manifest generated-from-source rather than typed by
// hand, and it does not need the pack downloads or a browser, so it runs anywhere.
//
// It REFUSES to invent structure. Every avatar in the manifest must already exist in the
// roster and vice versa; anything about geometry, filenames or clips is left exactly as the
// last real bake wrote it. If you changed a recolor TARGET (not just added the field), the
// sprites baked from the old target are now stale and you must run the full `pnpm bake` - this
// script deliberately cannot tell, which is why the README says so out loud.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accentPalette } from "./accent-palette.mjs";
import { avatars } from "./roster.mjs";
import { skinTonePalette, skinToneTargets, skinToneTolerance } from "./skin-tone-palette.mjs";

const toolRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(toolRoot));
const manifestPath = path.join(
  repoRoot,
  "apps",
  "web",
  "src",
  "lib",
  "avatars",
  "avatar-manifest.json",
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const rosterById = new Map(avatars.map((avatar) => [avatar.id, avatar]));

const manifestIds = manifest.avatars.map((entry) => entry.id);
const rosterIds = avatars.map((avatar) => avatar.id);
if (manifestIds.join(",") !== rosterIds.join(",")) {
  console.error(
    "roster and manifest disagree on which avatars exist (or their order) - that is a real\n" +
      "bake, not a sync. Run `pnpm download && pnpm bake`.",
  );
  process.exit(1);
}

// Rebuilt key-for-key in bake.mjs's own order rather than assigned onto the parsed object -
// assignment appends new keys at the end, which would leave this script and a later real bake
// writing the same data as different bytes.
const synced = {
  version: 3,
  spriteSize: manifest.spriteSize,
  basePath: manifest.basePath,
  sheet: manifest.sheet,
  accents: accentPalette,
  skinTones: skinTonePalette,
  skinRecolor: { targets: skinToneTargets, tolerance: skinToneTolerance },
  avatars: manifest.avatars.map((entry) => {
    const rosterEntry = rosterById.get(entry.id);
    return {
      id: entry.id,
      kind: entry.kind,
      displayName: rosterEntry.displayName,
      sprites: entry.sprites,
      sheet: entry.sheet,
      recolorTargets: rosterEntry.recolorTargets,
      tolerance: rosterEntry.tolerance ?? null,
    };
  }),
};

const before = readFileSync(manifestPath, "utf8");
const after = JSON.stringify(synced, null, 2) + "\n";
writeFileSync(manifestPath, after);
console.log(
  after === before
    ? "avatar-manifest.json already in sync"
    : `avatar-manifest.json synced (${before.length} -> ${after.length} bytes, ` +
        `+${after.length - before.length})`,
);
