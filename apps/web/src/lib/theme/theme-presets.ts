// The four built-in theme presets (docs/decisions/2026-08-13-theming-as-feature.md): the three
// art directions from research round 1 plus the Terra Verde event variant. Shapes mirror the
// theme document BODY of docs/proposals/m1-protocol.md section 5 (the fields with a CSS
// mapping - see the SYNC BLOCK in tokens.css). When M1 lands the real zod schema in
// packages/protocol, these become validated `theme` documents and this file's local types are
// replaced by protocol imports; keeping the field names identical now is what makes that a
// mechanical swap.

import type { ThemeEnvironment, ThemeStaging } from "@jeopardy/protocol";

/** Curated face ids - must stay equal to the theme document's fontFace enum. */
export type ThemeFontFace = "anton" | "oswald" | "bitter" | "six-caps" | "alfa-slab-one";

export type ThemeFill =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angleDeg: number };

export type ThemeUsedCellTreatment = "blank-dark" | "dimmed" | "outline";

export type ThemeEffectsLevel = "flat" | "dimensional";

export type ThemePresetId = "retro-tv" | "modern-flat" | "event-poster" | "terra-verde";

export type ThemePreset = {
  id: ThemePresetId;
  /** Chrome-facing name; presets are documents, so this maps to document meta.title later. */
  label: string;
  tokens: {
    boardBackground: ThemeFill;
    cellBackground: ThemeFill;
    categoryBackground: ThemeFill;
    valueColor: string;
    clueTextColor: string;
    accentColor: string;
    usedCellTreatment: ThemeUsedCellTreatment;
  };
  fontSlots: {
    display: ThemeFontFace;
    values: ThemeFontFace;
    clue: ThemeFontFace;
    chrome: ThemeFontFace;
  };
  /** Page background behind and around the board. Document allows pattern/image too; those
   * render kinds arrive with the M7 customizer + media pipeline (tokens.css SYNC BLOCK). */
  background: ThemeFill;
  effectsLevel: ThemeEffectsLevel;
  /**
   * The theme document's two PRESENTATION slots, typed straight from the protocol enums
   * (packages/protocol/src/theme/theme.ts) rather than restated - these two arrived after the
   * schema, so there is nothing to keep in sync by hand. `environment` is the 3D scenery,
   * `staging` is the pre-game seating chart. Absent = the surface's own default, which is what
   * every preset but Terra Verde wants.
   */
  environment?: ThemeEnvironment;
  staging?: ThemeStaging;
};

/** Direction A - faithful-retro TV (research 05-ui-design.md section 2): the #060CE9-family
 * board blue, gold values with glow, thick near-black gutters, dimensional lighting. */
export const retroTvPreset: ThemePreset = {
  id: "retro-tv",
  label: "Retro TV",
  tokens: {
    boardBackground: { kind: "solid", color: "#06071a" },
    // Flat base color on purpose: the dimensional effects layer supplies the bevel/vignette,
    // proving depth is an effects-level concern, not a baked-in gradient.
    cellBackground: { kind: "solid", color: "#060ce9" },
    categoryBackground: { kind: "solid", color: "#0509c0" },
    valueColor: "#ffcc00",
    clueTextColor: "#ffffff",
    accentColor: "#ffcc00",
    usedCellTreatment: "blank-dark",
  },
  fontSlots: { display: "anton", values: "six-caps", clue: "bitter", chrome: "oswald" },
  background: { kind: "gradient", from: "#0a0b33", to: "#04041a", angleDeg: 180 },
  effectsLevel: "dimensional",
};

/** Direction B - modern flat reinterpretation: designed indigo-ink, hard rules, no bevels,
 * the blue/gold ratio kept but cooled down. */
export const modernFlatPreset: ThemePreset = {
  id: "modern-flat",
  label: "Modern Flat",
  tokens: {
    boardBackground: { kind: "solid", color: "#171a2e" },
    cellBackground: { kind: "solid", color: "#232858" },
    categoryBackground: { kind: "solid", color: "#1b1f3d" },
    valueColor: "#f2b705",
    clueTextColor: "#eef0ff",
    accentColor: "#f2b705",
    usedCellTreatment: "dimmed",
  },
  fontSlots: { display: "anton", values: "oswald", clue: "bitter", chrome: "oswald" },
  background: { kind: "solid", color: "#101223" },
  effectsLevel: "flat",
};

/** Direction C - playful event poster: riso/screenprint energy, ink blocks on paper. The
 * paper board background doubling as gutter color is the range proof for the gutter-is-
 * boardBackground rule. */
export const eventPosterPreset: ThemePreset = {
  id: "event-poster",
  label: "Event Poster",
  tokens: {
    boardBackground: { kind: "solid", color: "#f4efe3" },
    cellBackground: { kind: "solid", color: "#14428a" },
    categoryBackground: { kind: "solid", color: "#b0472e" },
    valueColor: "#e4a832",
    clueTextColor: "#f4efe3",
    accentColor: "#b0472e",
    usedCellTreatment: "outline",
  },
  fontSlots: {
    display: "alfa-slab-one",
    values: "alfa-slab-one",
    clue: "bitter",
    chrome: "oswald",
  },
  background: { kind: "solid", color: "#f4efe3" },
  effectsLevel: "flat",
};

/** Terra Verde - the first-event variant (Board Game Club x Environmental Law Society),
 * deliberately authored as a spread-override of retro-tv: this is exactly the "theme = small
 * diff over a base" story the M7 customizer will produce. */
export const terraVerdePreset: ThemePreset = {
  ...retroTvPreset,
  id: "terra-verde",
  label: "Terra Verde",
  tokens: {
    ...retroTvPreset.tokens,
    boardBackground: { kind: "solid", color: "#04140e" },
    cellBackground: { kind: "solid", color: "#0b3d2e" },
    categoryBackground: { kind: "solid", color: "#082f21" },
    valueColor: "#ffd45e",
    clueTextColor: "#f2f7ef",
    accentColor: "#a3c968",
  },
  background: { kind: "gradient", from: "#0a2019", to: "#04100b", angleDeg: 180 },
  // The event's own lobby, chosen by the DOCUMENT rather than by a query string: campfires in
  // a forest clearing (docs/decisions/2026-08-15-staged-lobby.md - campfires ships alongside
  // boats partly because it IS the Terra Verde lobby). The forest KIT is a later pass, so the
  // display resolves this scenery to the studio stage today and starts drawing trees the day
  // the models land - no screen changes either way (diorama-environment.ts).
  environment: "forest",
  staging: "campfires",
};

/** Stable render order for pickers; ids must match the settings preset enum in
 * docs/proposals/m1-protocol.md section 3. */
export const themePresets: readonly ThemePreset[] = [
  retroTvPreset,
  modernFlatPreset,
  eventPosterPreset,
  terraVerdePreset,
];
