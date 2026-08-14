// Invariant gate for the baked avatar set: the manifest, the sprite files on disk, and the
// theme presets must agree, or a re-bake was botched/skipped. tools/avatar-bake writes the
// manifest + sprites together; this gate is what makes "commit them together" enforced
// rather than hoped for.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { avatarManifest, avatarSpriteUrl } from "#lib/avatars/avatar-manifest.ts";
import { themePresets } from "#lib/theme/theme-presets.ts";

const spritesDirectory = fileURLToPath(new URL("../../../static/avatars/", import.meta.url));
const spriteFilesOnDisk = new Set(
  readdirSync(spritesDirectory).filter((name) => name.endsWith(".webp")),
);

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
      avatarManifest.avatars.flatMap((avatar) => Object.values(avatar.sprites)),
    );
    for (const fileName of spriteFilesOnDisk) {
      expect(referenced, fileName).toContain(fileName);
    }
  });

  it("declares the served base path and the baked sprite size", () => {
    expect(avatarManifest.basePath).toBe("/avatars/");
    expect(avatarManifest.spriteSize).toBe(192);
  });

  it("throws on unknown accent lookups instead of emitting a 404 url", () => {
    const first = avatarManifest.avatars[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(() => avatarSpriteUrl(first, "no-such-accent")).toThrowError(/no sprite for accent/);
  });
});
