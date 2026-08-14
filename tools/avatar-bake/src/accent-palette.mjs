// THE single source of truth for the player-accent palette (documented in
// tools/avatar-bake/README.md and docs/design/theming.md). The web app never redefines these
// values: the bake writes them into the generated avatar manifest
// (apps/web/src/lib/avatars/avatar-manifest.json), which is the only copy shipped code reads.
//
// Design rule: the palette CONTAINS every theme preset's accentColor
// (apps/web/src/lib/theme/theme-presets.ts), so a player whose accent matches the active
// theme's accent always has an exact sprite. bake.mjs parses theme-presets.ts and fails the
// bake if a preset accent is missing here - adding a preset with a new accent therefore means:
// add the color below, re-bake, commit sprites + manifest together.
//
// Accepted trade-off: gold (#ffcc00, retro-tv) and amber (#f2b705, modern-flat) are close
// cousins because both preset accents must be present verbatim. The other six slots are spread
// across the hue wheel for player-vs-player distinguishability on roster chips.
export const accentPalette = [
  { id: "gold", hex: "#ffcc00" }, // retro-tv accent (also its value gold)
  { id: "amber", hex: "#f2b705" }, // modern-flat accent
  { id: "brick", hex: "#b0472e" }, // event-poster accent
  { id: "moss", hex: "#a3c968" }, // terra-verde accent
  { id: "azure", hex: "#2d6cdf" },
  { id: "teal", hex: "#2a9d8f" },
  { id: "violet", hex: "#8a5fc8" },
  { id: "blossom", hex: "#d9679f" },
];
