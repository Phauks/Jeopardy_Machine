// Font slots choose from a curated, self-hosted, OFL-licensed set - never arbitrary uploads
// or external URLs (docs/design/expansion-and-boundaries.md boundary 2.5: licensing hygiene,
// projector legibility floor, bundle size, CSP). Starting five per the theming decision
// (docs/decisions/2026-08-13-theming-as-feature.md); grows toward ~10-12 faces, each addition
// a minor bump of every format embedding a theme.
import { z } from "zod";

export const fontFaceSchema = z.enum(["anton", "oswald", "bitter", "six-caps", "alfa-slab-one"]);

export type FontFace = z.infer<typeof fontFaceSchema>;

// The four places type shows up on the board and chrome; defaults mirror the modern-flat
// preset direction (display slab for categories, condensed for values, readable serif clues).
export const fontSlotsSchema = z.strictObject({
  display: fontFaceSchema.default("anton"),
  values: fontFaceSchema.default("oswald"),
  clue: fontFaceSchema.default("bitter"),
  chrome: fontFaceSchema.default("oswald"),
});

export type FontSlots = z.infer<typeof fontSlotsSchema>;
