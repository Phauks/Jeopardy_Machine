// The browser-side recolor's contract, tested where it can be tested in node: the palette
// arithmetic it performs on real manifest data, and its refusal to pretend it can work in an
// environment with no canvas.
//
// The canvas path itself (fetch -> createImageBitmap -> getImageData) is browser-only and is
// covered by the component contract in avatar-animated.test.ts, which pins the thing that
// actually broke - which IMAGE gets painted. What is worth pinning here is that the recolor
// aimed at a given avatar genuinely moves that avatar's own cells, because the whole fix rests
// on the sheet and the baked stills being recoloured from identical inputs.
import { describe, expect, it } from "vitest";
import { canRecolorHere, recoloredImageUrl } from "#lib/avatars/sheet-recolor.ts";
import { recolorPixels } from "#lib/avatars/palette-recolor.ts";
import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";

function pixelsOf(...hexes: readonly string[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(hexes.length * 4);
  hexes.forEach((hex, index) => {
    data[index * 4] = Number.parseInt(hex.slice(1, 3), 16);
    data[index * 4 + 1] = Number.parseInt(hex.slice(3, 5), 16);
    data[index * 4 + 2] = Number.parseInt(hex.slice(5, 7), 16);
    data[index * 4 + 3] = 255;
  });
  return data;
}

describe("the recolor inputs the phone now carries", () => {
  it("moves every avatar's own accent cells, for every avatar", () => {
    // If any roster entry's targets stopped matching its own cells, the animated preview would
    // silently go back to pack colors - the bug, wearing a different hat.
    for (const avatar of avatarManifest.avatars) {
      const pixels = pixelsOf(...avatar.recolorTargets);
      const changed = recolorPixels(
        pixels,
        avatar.recolorTargets,
        "#2d6cdf",
        avatar.tolerance ?? undefined,
      );
      expect(changed, avatar.id).toBe(avatar.recolorTargets.length);
    }
  });

  it("moves the shared skin cells for a chosen tone", () => {
    const { targets, tolerance } = avatarManifest.skinRecolor;
    const pixels = pixelsOf(...targets);
    const tone = avatarManifest.skinTones[5];
    if (!tone) throw new Error("manifest has no skin tones");
    expect(recolorPixels(pixels, targets, tone.hex, tolerance)).toBe(targets.length);
  });

  it("leaves a human's garment alone when only the tone is applied", () => {
    // The invariant the two controls depend on, exercised rather than asserted about hexes:
    // running the skin pass over a garment cell must not touch it.
    const { targets, tolerance } = avatarManifest.skinRecolor;
    for (const avatar of avatarManifest.avatars.filter((entry) => entry.kind === "human")) {
      const pixels = pixelsOf(...avatar.recolorTargets);
      expect(recolorPixels(pixels, targets, "#5c3722", tolerance), avatar.id).toBe(0);
    }
  });

  it("leaves the skin cells alone when only an accent is applied", () => {
    const { targets } = avatarManifest.skinRecolor;
    for (const avatar of avatarManifest.avatars.filter((entry) => entry.kind === "human")) {
      const pixels = pixelsOf(...targets);
      const changed = recolorPixels(
        pixels,
        avatar.recolorTargets,
        "#ffcc00",
        avatar.tolerance ?? undefined,
      );
      expect(changed, avatar.id).toBe(0);
    }
  });
});

describe("environments without a canvas", () => {
  it("reports that it cannot recolor here (node has no document)", () => {
    expect(canRecolorHere()).toBe(false);
  });

  it("resolves to null rather than throwing, so callers keep the baked image", async () => {
    const avatar = avatarManifest.avatars[0];
    const accent = avatarManifest.accents[0];
    if (!avatar || !accent) throw new Error("manifest unexpectedly empty");
    await expect(
      recoloredImageUrl({
        avatar,
        sourceUrl: "/avatars/" + avatar.sheet.file,
        accentHex: accent.hex,
        toneHex: null,
      }),
    ).resolves.toBeNull();
  });
});
