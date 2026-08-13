// Theme document -> CSS custom properties. This is THE mapping the M7 customizer implements
// against: a theme (today a preset object, later a validated `theme` document body from
// packages/protocol) becomes a flat record of the semantic tokens declared in tokens.css,
// applied to a subtree via an inline style attribute (or a generated <style> block for the
// display surface). Nothing else may translate theme fields to CSS - one mapping, one SSOT.
import type {
  ThemeFill,
  ThemeFontFace,
  ThemePreset,
  ThemeUsedCellTreatment,
} from "#lib/theme/theme-presets.ts";

/** Every custom property a theme controls. Kept as a value (not just a type) so tests can
 * gate that each preset emits the complete contract. */
export const themeTokenNames = [
  "--page-bg",
  "--board-bg",
  "--board-cell-bg",
  "--board-category-bg",
  "--board-value-color",
  "--clue-text-color",
  "--accent",
  "--board-cell-used-bg",
  "--board-cell-used-outline",
  "--board-cell-used-opacity",
  "--font-display",
  "--font-values",
  "--font-clue",
  "--font-chrome",
  "--surface-page",
  "--surface-raised",
  "--surface-text",
  "--surface-text-muted",
  "--surface-border",
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];

export type ThemeTokenRecord = Record<ThemeTokenName, string>;

// Family stacks per curated face id (faces: fonts.css). Fallbacks chosen to be metrically
// adjacent so font-display: swap flashes small.
const fontFamilyByFace: Record<ThemeFontFace, string> = {
  anton: '"Anton", "Arial Narrow", "Helvetica Neue", sans-serif',
  oswald: '"Oswald", "Arial Narrow", "Helvetica Neue", sans-serif',
  bitter: '"Bitter", Georgia, serif',
  "six-caps": '"Six Caps", "Arial Narrow", "Helvetica Neue", sans-serif',
  "alfa-slab-one": '"Alfa Slab One", Georgia, serif',
};

/** A fill renders to a background-shorthand-compatible value: a color, or a gradient image. */
export function fillToCss(fill: ThemeFill): string {
  if (fill.kind === "solid") return fill.color;
  return `linear-gradient(${String(fill.angleDeg)}deg, ${fill.from}, ${fill.to})`;
}

/** The base color of a fill - what derived chrome mixes from and what Tailwind's
 * background-color-only utilities get. For gradients: the `from` stop (the dominant top). */
function fillBaseColor(fill: ThemeFill): string {
  return fill.kind === "solid" ? fill.color : fill.from;
}

// usedCellTreatment enum -> the three used-cell tokens (tokens.css SYNC BLOCK). The board
// component renders used cells empty and applies exactly these three properties.
function usedCellTokens(
  treatment: ThemeUsedCellTreatment,
  cellBackground: ThemeFill,
  accentColor: string,
): Pick<
  ThemeTokenRecord,
  "--board-cell-used-bg" | "--board-cell-used-outline" | "--board-cell-used-opacity"
> {
  switch (treatment) {
    case "blank-dark":
      return {
        "--board-cell-used-bg": `color-mix(in srgb, ${fillBaseColor(cellBackground)} 26%, #000000)`,
        "--board-cell-used-outline": "none",
        "--board-cell-used-opacity": "1",
      };
    case "dimmed":
      return {
        "--board-cell-used-bg": fillToCss(cellBackground),
        "--board-cell-used-outline": "none",
        "--board-cell-used-opacity": "0.3",
      };
    case "outline":
      return {
        "--board-cell-used-bg": "transparent",
        "--board-cell-used-outline": `inset 0 0 0 2px color-mix(in srgb, ${accentColor} 55%, transparent)`,
        "--board-cell-used-opacity": "1",
      };
  }
}

/** Render a theme to its complete token record. Pure and total: every token name in
 * `themeTokenNames` is present for every valid theme - the contract gate test enforces it. */
export function themeToTokens(theme: ThemePreset): ThemeTokenRecord {
  const { tokens, fontSlots, background } = theme;
  const pageBase = fillBaseColor(background);
  const text = tokens.clueTextColor;
  return {
    "--page-bg": fillToCss(background),
    "--board-bg": fillToCss(tokens.boardBackground),
    "--board-cell-bg": fillToCss(tokens.cellBackground),
    "--board-category-bg": fillToCss(tokens.categoryBackground),
    "--board-value-color": tokens.valueColor,
    "--clue-text-color": tokens.clueTextColor,
    "--accent": tokens.accentColor,
    ...usedCellTokens(tokens.usedCellTreatment, tokens.cellBackground, tokens.accentColor),
    "--font-display": fontFamilyByFace[fontSlots.display],
    "--font-values": fontFamilyByFace[fontSlots.values],
    "--font-clue": fontFamilyByFace[fontSlots.clue],
    "--font-chrome": fontFamilyByFace[fontSlots.chrome],
    // Chrome surfaces derive from document fields (never document fields themselves - SYNC
    // BLOCK): mixing toward the text color lightens dark themes and darkens light ones, so
    // one formula serves retro-tv and event-poster alike.
    "--surface-page": pageBase,
    "--surface-raised": `color-mix(in srgb, ${pageBase} 90%, ${text})`,
    "--surface-text": text,
    "--surface-text-muted": `color-mix(in srgb, ${text} 62%, transparent)`,
    "--surface-border": `color-mix(in srgb, ${text} 20%, transparent)`,
  };
}

/** The token record as an inline style string - how a preset is applied to a subtree. The
 * effects level rides separately as a data-effects attribute (it selects token DERIVATIONS in
 * tokens.css, it is not itself a custom property). */
export function themeToStyleAttribute(theme: ThemePreset): string {
  return Object.entries(themeToTokens(theme))
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}
