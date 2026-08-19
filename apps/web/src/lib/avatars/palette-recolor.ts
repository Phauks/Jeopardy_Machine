// THE palette recolor - the one implementation of "tint an avatar to a player accent".
//
// Two consumers, deliberately the same bytes of source:
//   1. tools/avatar-bake renders the committed sprites and sprite sheets with it (its render
//      page fetches THIS FILE, type-stripped by bake.mjs - see that tool's README, "shared
//      recolor"), so a baked sprite and a live model can never drift in color.
//   2. src/lib/diorama recolors each Kenney colormap at runtime, once per (avatar, accent),
//      before handing the canvas to three.js as a texture.
//
// Pure and DOM-free on purpose: it takes the RGBA bytes a caller already has (canvas
// getImageData in both consumers) and mutates them in place. That is what makes it both
// unit-testable in node and loadable in the bake's browser page.
//
// The mechanism (proven in the avatar bake, docs/decisions/2026-08-14-avatars-in-motion.md):
// Kenney packs share ONE small palette texture whose texels are flat color cells. Replacing
// the cells a model wears - within a small RGB distance, so each cell's shade variants come
// along - repaints exactly that garment/body and nothing else. The replacement keeps the
// source pixel's luminance RATIO against its target cell, so shading survives the swap.

/** An 8-bit RGB triple, the form both the tolerance test and the tint math work in. */
export type RgbColor = readonly [number, number, number];

/**
 * Default RGB distance within which a pixel counts as "the same palette cell".
 * 42 is the value the sprite bake was tuned to: wide enough to catch a cell's gradient
 * variants, tight enough that neighbouring cells (skin next to shirt) never bleed. Individual
 * roster entries override it downward when their target sits close to a cell they must not
 * touch (tools/avatar-bake/src/roster.mjs, male-d's tie vs his auburn hair).
 */
export const defaultRecolorTolerance = 42;

/** `#rrggbb` -> [r, g, b]. Throws rather than silently tinting toward black on a typo. */
export function parseHexColor(hex: string): RgbColor {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`not a #rrggbb color: ${hex}`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Rec. 601 luma - the perceptual weight the shade-preserving ratio is measured in. */
export function luminance(color: RgbColor): number {
  return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
}

/**
 * Recolor one pixel value toward `accent`, preserving how light or dark it was relative to
 * the palette cell it belongs to. Exported for the unit tests that pin the shade math; the
 * bulk path below inlines the same arithmetic to avoid allocating per pixel.
 */
export function tintTowardAccent(pixel: RgbColor, target: RgbColor, accent: RgbColor): RgbColor {
  // A pure-black target would divide by zero; treat it as "no shading information" (ratio 1).
  const ratio = luminance(pixel) / (luminance(target) || 1);
  return [
    Math.min(255, accent[0] * ratio),
    Math.min(255, accent[1] * ratio),
    Math.min(255, accent[2] * ratio),
  ];
}

/** Squared RGB distance - squared so the hot loop never calls Math.sqrt. */
function distanceSquared(red: number, green: number, blue: number, target: RgbColor): number {
  const deltaRed = red - target[0];
  const deltaGreen = green - target[1];
  const deltaBlue = blue - target[2];
  return deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue;
}

/**
 * Below this alpha a pixel's colour is not evidence of anything and must not be recoloured.
 *
 * Canvas stores pixels PREMULTIPLIED and `getImageData` hands them back un-premultiplied, so a
 * barely-visible edge pixel's RGB has been divided by a tiny alpha and is mostly rounding
 * error - and a fully transparent pixel's RGB is whatever the encoder happened to leave there,
 * frequently a flat colour that lands within tolerance of a palette cell. Painting the accent
 * into either is invisible on its own, and then very visible once the strip is re-encoded: the
 * accent sitting in the transparent gutter is real colour for the encoder to smear back across
 * the silhouette (owner report 2026-08-19, "strange color artifacting when selecting a player
 * avatar and color").
 *
 * 24 rather than 1: it also excludes the antialiased rim, where the un-premultiplied colour is
 * a blend of the character and the void behind it and tinting produces a coloured halo. The
 * rim is one pixel of a hard-edged sprite and reads as the outline it already is.
 */
export const minimumRecolorAlpha = 24;

/**
 * Recolor an RGBA byte array in place: every pixel within `tolerance` of one of the target
 * palette cells becomes the accent at that pixel's own luminance ratio. Alpha is untouched and,
 * below `minimumRecolorAlpha`, the pixel is skipped entirely.
 * Returns how many pixels changed - the bake asserts it is non-zero, which is what catches a
 * roster entry whose recolorTargets no longer exist after a pack update.
 */
export function recolorPixels(
  pixels: Uint8ClampedArray,
  targetHexes: readonly string[],
  accentHex: string,
  tolerance: number = defaultRecolorTolerance,
): number {
  const targets = targetHexes.map(parseHexColor);
  const accent = parseHexColor(accentHex);
  const toleranceSquared = tolerance * tolerance;
  const [accentRed, accentGreen, accentBlue] = accent;
  let changed = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if ((pixels[offset + 3] ?? 0) < minimumRecolorAlpha) continue;
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    for (const target of targets) {
      if (distanceSquared(red, green, blue, target) >= toleranceSquared) continue;
      const targetLuminance = luminance(target) || 1;
      const ratio = (0.299 * red + 0.587 * green + 0.114 * blue) / targetLuminance;
      pixels[offset] = Math.min(255, accentRed * ratio);
      pixels[offset + 1] = Math.min(255, accentGreen * ratio);
      pixels[offset + 2] = Math.min(255, accentBlue * ratio);
      changed += 1;
      // First matching cell wins: targets within tolerance of each other are the same
      // garment's shade variants, so re-tinting from the second one would double-apply.
      break;
    }
  }
  return changed;
}
