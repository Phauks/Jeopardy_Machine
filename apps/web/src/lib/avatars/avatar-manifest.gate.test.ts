// Invariant gate for the baked avatar set: the manifest, the files on disk, and the theme
// presets must agree, or a re-bake was botched/skipped. tools/avatar-bake writes all three
// tiers together - stills, walk sheets, models (docs/decisions/2026-08-14-avatars-in-motion.md)
// - and this gate is what makes "commit them together" enforced rather than hoped for.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  avatarManifest,
  avatarSheetUrl,
  avatarSpriteUrl,
  avatarTakesSkinTone,
  skinToneById,
} from "#lib/avatars/avatar-manifest.ts";
import {
  avatarModelById,
  avatarModelManifest,
  avatarModelUrl,
} from "#lib/avatars/avatar-models.ts";
import { defaultRecolorTolerance, luminance, parseHexColor } from "#lib/avatars/palette-recolor.ts";
import { themePresets } from "#lib/theme/theme-presets.ts";

const spritesDirectory = fileURLToPath(new URL("../../../static/avatars/", import.meta.url));
const modelsDirectory = path.join(spritesDirectory, "models");
const spriteFilesOnDisk = new Set(
  readdirSync(spritesDirectory).filter((name) => name.endsWith(".webp")),
);
const modelFilesOnDisk = new Set(readdirSync(modelsDirectory));

function totalBytes(directory: string, names: Iterable<string>): number {
  let bytes = 0;
  for (const name of names) bytes += statSync(path.join(directory, name)).size;
  return bytes;
}

describe("avatar manifest integrity", () => {
  it("holds the full roster: 15 pets + 12 humans, unique kebab-case ids, display names", () => {
    const pets = avatarManifest.avatars.filter((avatar) => avatar.kind === "pet");
    const humans = avatarManifest.avatars.filter((avatar) => avatar.kind === "human");
    expect(pets.length).toBe(15);
    expect(humans.length).toBe(12);
    const ids = avatarManifest.avatars.map((avatar) => avatar.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const avatar of avatarManifest.avatars) {
      expect(avatar.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(avatar.displayName.length).toBeGreaterThan(0);
    }
  });

  it("carries the 8-accent player palette with unique ids and hex colors", () => {
    expect(avatarManifest.accents.length).toBe(8);
    const ids = avatarManifest.accents.map((accent) => accent.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const accent of avatarManifest.accents) {
      expect(accent.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(accent.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("contains every theme preset accentColor (a preset accent always has an exact sprite)", () => {
    const paletteHexes = new Set(avatarManifest.accents.map((accent) => accent.hex));
    for (const preset of themePresets) {
      expect(paletteHexes, `preset ${preset.id}`).toContain(
        preset.tokens.accentColor.toLowerCase(),
      );
    }
  });

  it("has a sprite for every avatar x accent, and the file exists on disk", () => {
    for (const avatar of avatarManifest.avatars) {
      for (const accent of avatarManifest.accents) {
        const expectedFileName = `${avatar.id}--${accent.id}.webp`;
        expect(avatar.sprites[accent.id], `${avatar.id}/${accent.id}`).toBe(expectedFileName);
        expect(spriteFilesOnDisk, expectedFileName).toContain(expectedFileName);
        expect(avatarSpriteUrl(avatar, accent.id)).toBe(
          `${avatarManifest.basePath}${expectedFileName}`,
        );
      }
      expect(Object.keys(avatar.sprites).length).toBe(avatarManifest.accents.length);
    }
  });

  it("has no orphan sprite files on disk (stale bakes get swept, not shipped)", () => {
    const referenced = new Set(
      avatarManifest.avatars.flatMap((avatar) => [
        ...Object.values(avatar.sprites),
        avatar.sheet.file,
      ]),
    );
    for (const fileName of spriteFilesOnDisk) {
      expect(referenced, fileName).toContain(fileName);
    }
  });

  it("declares the served base path and the baked sprite size", () => {
    expect(avatarManifest.basePath).toBe("/avatars/");
    expect(avatarManifest.spriteSize).toBe(192);
  });
});

describe("the recolor inputs the sprite manifest carries (v3)", () => {
  it("gives every avatar the targets and tolerance the browser recolor needs", () => {
    for (const avatar of avatarManifest.avatars) {
      expect(avatar.recolorTargets.length, avatar.id).toBeGreaterThan(0);
      for (const target of avatar.recolorTargets) {
        expect(target, avatar.id).toMatch(/^#[0-9a-f]{6}$/);
      }
      if (avatar.tolerance !== null) expect(avatar.tolerance, avatar.id).toBeGreaterThan(0);
    }
  });

  it("agrees EXACTLY with the display tier's copy - both come from one roster entry", () => {
    // The duplication is deliberate (the model manifest is kept out of every phone's bundle),
    // so this is the assertion that keeps it from becoming a fork. A sheet recoloured from
    // targets the stills were not baked from would put two different colours of the same
    // avatar on one screen.
    for (const avatar of avatarManifest.avatars) {
      const model = avatarModelById(avatar.id);
      expect(model?.recolorTargets, avatar.id).toEqual(avatar.recolorTargets);
      expect(model?.tolerance, avatar.id).toBe(avatar.tolerance);
    }
  });
});

describe("the skin-tone axis", () => {
  it("offers a curated set with unique ids, player-facing labels, and hex colors", () => {
    expect(avatarManifest.skinTones.length).toBeGreaterThanOrEqual(4);
    const ids = avatarManifest.skinTones.map((tone) => tone.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tone of avatarManifest.skinTones) {
      expect(tone.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(tone.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(tone.label.length).toBeGreaterThan(0);
    }
  });

  it("spans a real range rather than crowding the light end", () => {
    // The standard failure of this feature is six pale options and one dark one. The ramp is
    // required to reach genuinely deep and to step monotonically, so no tone is a token.
    const luminances = avatarManifest.skinTones.map((tone) => luminance(parseHexColor(tone.hex)));
    const lightest = luminances[0];
    const darkest = luminances[luminances.length - 1];
    expect(lightest).toBeDefined();
    expect(darkest).toBeDefined();
    expect(lightest ?? 0).toBeGreaterThan(190);
    expect(darkest ?? 255).toBeLessThan(90);
    for (let index = 1; index < luminances.length; index += 1) {
      expect(luminances[index] ?? 0, `tone ${String(index + 1)}`).toBeLessThan(
        luminances[index - 1] ?? 0,
      );
    }
  });

  it("names the shared Mini Characters skin cells and a tolerance to match them by", () => {
    expect(avatarManifest.skinRecolor.targets.length).toBeGreaterThan(0);
    for (const target of avatarManifest.skinRecolor.targets) {
      expect(target).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(avatarManifest.skinRecolor.tolerance).toBeGreaterThan(0);
  });

  it("NEVER shares a cell with a human's accent target - the two controls cannot fight", () => {
    // The safety property the whole feature rests on. Accent and tone run as two passes over
    // the same pixels; a cell both could claim would be repainted twice and the player would
    // watch their shirt change when they picked a face. Held by distance, not by equality, so
    // "close enough for either tolerance to catch it" also fails.
    const { targets: skinCells, tolerance: skinTolerance } = avatarManifest.skinRecolor;
    for (const avatar of avatarManifest.avatars.filter((entry) => entry.kind === "human")) {
      const accentTolerance = avatar.tolerance ?? defaultRecolorTolerance;
      const guard = Math.max(skinTolerance, accentTolerance);
      for (const garment of avatar.recolorTargets) {
        for (const skin of skinCells) {
          const [red, green, blue] = parseHexColor(garment);
          const [skinRed, skinGreen, skinBlue] = parseHexColor(skin);
          const distance = Math.hypot(red - skinRed, green - skinGreen, blue - skinBlue);
          expect(distance, `${avatar.id}: ${garment} vs skin ${skin}`).toBeGreaterThan(guard);
        }
      }
    }
  });

  it("is offered for the twelve humans and withheld from the fifteen pets", () => {
    const humans = avatarManifest.avatars.filter((entry) => avatarTakesSkinTone(entry));
    expect(humans.length).toBe(12);
    for (const pet of avatarManifest.avatars.filter((entry) => entry.kind === "pet")) {
      expect(avatarTakesSkinTone(pet), pet.id).toBe(false);
    }
  });

  it("resolves a chosen tone, and resolves 'not chosen' to null rather than a default", () => {
    const first = avatarManifest.skinTones[0];
    if (!first) throw new Error("manifest has no skin tones");
    expect(skinToneById(first.id)?.hex).toBe(first.hex);
    expect(skinToneById(null)).toBeNull();
    expect(skinToneById("no-such-tone")).toBeNull();
  });
});

describe("avatar walk sheets (the animated tier)", () => {
  it("declares a sane, uniform sheet geometry", () => {
    // 8-12 frames is the documented window (tools/avatar-bake/src/bake.mjs explains the 10);
    // outside it a walk either stutters or costs bytes nobody sees.
    expect(avatarManifest.sheet.frames).toBeGreaterThanOrEqual(8);
    expect(avatarManifest.sheet.frames).toBeLessThanOrEqual(12);
    // The sheet is the phone's animated tier - a frame larger than the still would be a
    // strictly worse trade, since the strip multiplies it by the frame count.
    expect(avatarManifest.sheet.frameSize).toBeLessThan(avatarManifest.spriteSize);
  });

  it("gives every avatar exactly one sheet that exists on disk, naming the clip rendered", () => {
    for (const avatar of avatarManifest.avatars) {
      expect(avatar.sheet.file, avatar.id).toBe(`${avatar.id}--walk.webp`);
      expect(spriteFilesOnDisk, avatar.sheet.file).toContain(avatar.sheet.file);
      expect(avatarSheetUrl(avatar)).toBe(`${avatarManifest.basePath}${avatar.sheet.file}`);
      // Either the avatar's own walk clip, or the documented idle fallback for a pack lacking
      // one - never an empty string, which would mean the bake silently found nothing.
      expect(avatar.sheet.clip.length, avatar.id).toBeGreaterThan(0);
      const model = avatarModelById(avatar.id);
      expect(model, avatar.id).not.toBeNull();
      expect([model?.clips.walk, model?.clips.idle], avatar.id).toContain(avatar.sheet.clip);
    }
  });

  it("keeps the whole sheet set inside its committed-bytes budget", () => {
    const sheetBytes = totalBytes(
      spritesDirectory,
      avatarManifest.avatars.map((avatar) => avatar.sheet.file),
    );
    // One sheet per avatar, not per accent: the measured per-accent alternative was ~4.6 MB
    // (tools/avatar-bake/src/bake.mjs). A regression to per-accent would blow straight past
    // this line.
    expect(sheetBytes).toBeLessThan(1024 * 1024);
  });
});

describe("avatar models (the display-diorama tier)", () => {
  it("covers exactly the manifest roster - no avatar without a model, no model without one", () => {
    expect(avatarModelManifest.avatars.map((model) => model.id)).toEqual(
      avatarManifest.avatars.map((avatar) => avatar.id),
    );
  });

  it("gives every avatar a model, a colormap, and the three clip roles", () => {
    for (const model of avatarModelManifest.avatars) {
      expect(model.file, model.id).toBe(`${model.id}.glb`);
      expect(modelFilesOnDisk, model.file).toContain(model.file);
      expect(modelFilesOnDisk, model.colormap).toContain(model.colormap);
      expect(avatarModelUrl(model.file)).toBe(`${avatarModelManifest.modelPath}${model.file}`);
      for (const role of ["idle", "walk", "celebrate"] as const) {
        expect(model.clips[role].length, `${model.id}/${role}`).toBeGreaterThan(0);
      }
      for (const prop of model.props) {
        expect(modelFilesOnDisk, prop).toContain(prop);
      }
    }
  });

  it("carries the recolor inputs the runtime needs (same targets the sprites were baked from)", () => {
    for (const model of avatarModelManifest.avatars) {
      expect(model.recolorTargets.length, model.id).toBeGreaterThan(0);
      for (const target of model.recolorTargets) {
        expect(target, model.id).toMatch(/^#[0-9a-f]{6}$/);
      }
      if (model.tolerance !== null) {
        expect(model.tolerance).toBeGreaterThan(0);
      }
    }
  });

  it("has no orphan model files and stays inside the model budget", () => {
    const referenced = new Set(
      avatarModelManifest.avatars.flatMap((model) => [model.file, model.colormap, ...model.props]),
    );
    for (const fileName of modelFilesOnDisk) {
      expect(referenced, fileName).toContain(fileName);
    }
    // Raw pack GLBs total 4.97 MB; glb-repack.mjs trims them to ~2.3 MB. This ceiling catches
    // a repack that quietly stopped trimming (a dropped clip filter, a skipped attribute).
    expect(totalBytes(modelsDirectory, modelFilesOnDisk)).toBeLessThan(3 * 1024 * 1024);
  });

  it("declares the model path only the display route ever resolves", () => {
    expect(avatarModelManifest.modelPath).toBe("/avatars/models/");
  });

  it("throws on unknown accent lookups instead of emitting a 404 url", () => {
    const first = avatarManifest.avatars[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(() => avatarSpriteUrl(first, "no-such-accent")).toThrowError(/no sprite for accent/);
  });
});
