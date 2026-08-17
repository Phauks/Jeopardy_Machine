// THE single source of truth for the skin-tone axis on the Mini Characters, written verbatim
// into the generated avatar manifest exactly as accent-palette.mjs is (that file explains the
// pattern). Shipped code never redefines these values.
//
// WHY THIS EXISTS, AND THE RULES IT FOLLOWS
// (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Skin tones for the
// human models"): a curated set, offered as an EXPLICIT choice, never inferred, and never
// defaulted from anything but a neutral.
//
//   - "Neutral" here means the pack's OWN colors: a player who has not chosen carries
//     skinToneId = null and their model renders exactly as Kenney authored it. There is no
//     "default tone" that some faces get and others do not, because any such default would be
//     an inference about the player.
//   - The ids and labels are deliberately numeric. Every alternative naming scheme available -
//     food, wood, geography, "light/medium/dark" - either ranks people or names them after
//     objects, and this is the one control in the product where getting that wrong is worse
//     than being dull. A number is honest about what it is: slot N of a ramp.
//   - The ramp is EVEN and it is the whole range. A set that crowds the light end and offers
//     one dark option is the standard failure of this feature, so the six entries below step
//     roughly evenly in luminance from the pack's palest cell to well below its darkest.
//
// HUMANS ONLY. Pets have no skin cells - the recolor would find nothing and the control would
// be a lie - so the surfaces show it only for a `kind: "human"` avatar
// (apps/web/src/lib/avatars/avatar-tone.ts holds that rule as one exported predicate).
export const skinTonePalette = [
  { id: "tone-1", label: "Tone 1", hex: "#f8ddc4" },
  { id: "tone-2", label: "Tone 2", hex: "#eec8a2" },
  { id: "tone-3", label: "Tone 3", hex: "#dda878" },
  { id: "tone-4", label: "Tone 4", hex: "#bc8055" },
  { id: "tone-5", label: "Tone 5", hex: "#8d5836" },
  { id: "tone-6", label: "Tone 6", hex: "#5c3722" },
];

// The Mini Characters colormap cells the tone replaces - the skin ramp Kenney authored, which
// the 12 shipped humans draw their faces and hands from. Curated and committed explicitly for
// the same reason roster.mjs commits its accent targets by hand: explicit hexes are reviewable,
// and a pack update that shifts the colormap shows up as an unchanged face in review rather
// than silently retargeting a garment.
//
// Derived from the committed colormap itself (apps/web/static/avatars/models/
// mini-characters-colormap.png is a 512x512 sheet of 8x4 flat 64x128 cells): these are the four
// cells in the skin hue band, three across the bottom row and the palest at row 2 column 0.
// Kenney's humans do not all share one skin cell, so all four are targeted together - that is
// what makes ONE tone list correct for all twelve, whichever cell a given model was authored
// against.
//
// The invariant that keeps this safe is asserted, not trusted: no cell here may appear in any
// avatar's accent recolorTargets (tools/avatar-bake/src/roster.mjs), or the two controls would
// fight over the same pixels and the last one applied would win. The manifest gate holds it
// (apps/web/src/lib/avatars/avatar-manifest.gate.test.ts).
export const skinToneTargets = ["#fde4c7", "#f2bf99", "#f1976c", "#b06041"];

// Tighter than palette-recolor.ts's default 42, and the numbers are why. The nearest thing the
// skin band must NOT catch is #ff7e44, the orange tee two columns over, 49 away in RGB from
// #f1976c - so the default 42 leaves only 7 of headroom on a cell whose own shading variants
// need room. At 24 each skin cell still gathers its gradient (the ramp's own steps are ~60
// apart, so neighbours never merge either) and the tee, Preston's tie at 81, and Milo's amber
// are all comfortably out of reach.
export const skinToneTolerance = 24;
