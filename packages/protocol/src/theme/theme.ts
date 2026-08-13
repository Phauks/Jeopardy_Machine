// The theme document (proposal section 5; docs/decisions/2026-08-13-theming-as-feature.md):
// a portable look - tokens, font slots, background, effects level, optional curated sound
// set. Filename convention: <name>.theme.json. WCAG contrast checking is the customizer's
// job (warn, never block) and lives in app code - a theme failing contrast is still a valid
// document, so shared themes never break on import.
import { z } from "zod";
import { mediaAssetSchema } from "../content/media-ref.ts";
import { documentSchema } from "../envelope/document.ts";
import { themeBackgroundSchema } from "./background.ts";
import { fontSlotsSchema } from "./fonts.ts";
import { themeTokensSchema } from "./tokens.ts";

export const themeBodySchema = z.strictObject({
  tokens: themeTokensSchema,
  fontSlots: fontSlotsSchema.prefault({}),
  background: themeBackgroundSchema,
  // The real structural difference between the retro-tv and modern-flat directions:
  // dimensional turns on bevels, glows, and vignettes; flat is exactly that.
  effectsLevel: z.enum(["flat", "dimensional"]).default("flat"),
  // Boundary 2.10's deliberate bend: a slot for choosing among OUR curated system-cue sound
  // sets. Optional now (minor-bump-free reservation), populated when M7 ships the sets.
  soundSet: z.enum(["classic-original", "minimal-beeps"]).optional(),
  // Background-image bytes ride like pack media (content/media-ref.ts indirection).
  media: z.array(mediaAssetSchema).max(4).default([]),
});

export const themeSchema = documentSchema("theme", themeBodySchema);
export const themeSchemaVersion = "1.0.0";

export type ThemeBody = z.infer<typeof themeBodySchema>;
export type Theme = z.infer<typeof themeSchema>;

// The built-in presets every deploy ships (theming decision: the three art directions plus
// the event variant). Game definitions reference these by id; the actual token values live
// in the web app's asset layer, not the protocol - the schema only pins the vocabulary.
export const themePresetIdSchema = z.enum([
  "retro-tv",
  "modern-flat",
  "event-poster",
  "terra-verde",
]);

export type ThemePresetId = z.infer<typeof themePresetIdSchema>;
