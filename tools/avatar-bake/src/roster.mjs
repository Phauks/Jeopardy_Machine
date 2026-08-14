// The 27-avatar roster: all 15 Cube Pets + all 12 Mini Characters (owner decision,
// docs/research/00-user-directives.md "Avatars: Kenney 3D only"). female-a is the pack's
// integrated wheelchair user (authored seated; composited with the pack's wheelchair model)
// and male-a wears integrated glasses - both deliberately included, the owner values the
// representation.
//
// recolorTargets: the shared-colormap palette cells replaced by the player accent (base +
// shade cells; the render page's deltaRGB<42 tolerance also catches each cell's gradient
// variants). Pets recolor their BODY; humans recolor a signature GARMENT - skin, hair, and
// face cells are never targeted, so identity survives every accent. Values are curated from
// the --analyze pass (UV-area-weighted dominant-cell dump per model) plus visual review, and
// committed explicitly rather than recomputed at bake time: explicit hexes are reviewable,
// and a pack update that shifts the colormap shows up as an unchanged sprite in review
// instead of silently retargeting the wrong cells.
//
// displayName: picker label + sprite alt text. Pets go by species; humans get invented
// friendly names (no real-person references) - freely renameable here, then re-bake.
//
// clips: the THREE animation roles the shipped models expose, mapped to each pack's own clip
// names (docs/decisions/2026-08-14-avatars-in-motion.md). Shipped code - the sprite-sheet
// bake and the display diorama - names roles, never Kenney clip names, so a pack that renames
// its animations is a one-line change here. Only these clips survive the GLB repack, which is
// most of why the models fit their budget.
export const clipRoles = ["idle", "walk", "celebrate"];

/** Per-kind defaults; a roster entry may override any role (female-a does - see below). */
const defaultClips = {
  pet: { idle: "idle", walk: "walk", celebrate: "dance" },
  human: { idle: "idle", walk: "walk", celebrate: "jump" },
};

export const avatars = [
  // --- Cube Pets: body base + shade cells from the pets colormap ---
  { id: "bunny", kind: "pet", displayName: "Bunny", recolorTargets: ["#cc7854", "#d47f59"] },
  { id: "cat", kind: "pet", displayName: "Cat", recolorTargets: ["#717388", "#76798e"] },
  {
    id: "caterpillar",
    kind: "pet",
    displayName: "Caterpillar",
    recolorTargets: ["#38a177", "#42ab7c"],
  },
  { id: "chick", kind: "pet", displayName: "Chick", recolorTargets: ["#ffc255", "#ffc659"] },
  { id: "cow", kind: "pet", displayName: "Cow", recolorTargets: ["#d8d8e6", "#e1e1ec"] },
  { id: "dog", kind: "pet", displayName: "Dog", recolorTargets: ["#cc7854", "#d47f59"] },
  {
    id: "elephant",
    kind: "pet",
    displayName: "Elephant",
    recolorTargets: ["#989fbe", "#a2aacc"],
  },
  { id: "fish", kind: "pet", displayName: "Fish", recolorTargets: ["#e48846", "#e78f48"] },
  { id: "giraffe", kind: "pet", displayName: "Giraffe", recolorTargets: ["#ffaf45", "#ffb84d"] },
  { id: "hog", kind: "pet", displayName: "Boar", recolorTargets: ["#cc7854", "#d47f59"] },
  { id: "lion", kind: "pet", displayName: "Lion", recolorTargets: ["#ffaf45", "#ffb84d"] },
  { id: "monkey", kind: "pet", displayName: "Monkey", recolorTargets: ["#cc7854", "#d47f59"] },
  { id: "parrot", kind: "pet", displayName: "Parrot", recolorTargets: ["#e45e48", "#ea6246"] },
  { id: "pig", kind: "pet", displayName: "Pig", recolorTargets: ["#e28aae", "#e58fb7"] },
  { id: "tiger", kind: "pet", displayName: "Tiger", recolorTargets: ["#e48846", "#e78f48"] },
  // --- Mini Characters: signature-garment cells from the characters colormap ---
  {
    id: "female-a",
    kind: "human",
    displayName: "Ada",
    // Purple top; the composited wheelchair keeps its own pack colors.
    recolorTargets: ["#8a5fd5"],
    extraModelFiles: ["Models/GLB format/wheelchair.glb"],
    // She is the pack's wheelchair user - so she gets the pack's own wheelchair locomotion
    // rather than a standing walk cycle. Ada moves in her chair; making her model foot-walk
    // in the diorama would be both wrong and worse-looking. Her `idle` stays the shared clip
    // (the committed still sprite proves it reads correctly seated) and `celebrate` is a nod
    // rather than the standing jump.
    clips: { walk: "wheelchair-move-forward", celebrate: "emote-yes" },
  },
  {
    id: "female-b",
    kind: "human",
    displayName: "Poppy",
    // Yellow top + hairband/pigtail ties; pants stay purple, #ffab42 stays - that's her hair.
    recolorTargets: ["#ffd061"],
  },
  { id: "female-c", kind: "human", displayName: "Nova", recolorTargets: ["#6794d9"] },
  { id: "female-d", kind: "human", displayName: "Wren", recolorTargets: ["#71778e"] },
  {
    id: "female-e",
    kind: "human",
    displayName: "Vera",
    // White lab coat (base + shaded-white cell).
    recolorTargets: ["#ffffff", "#d0e8ff"],
  },
  {
    id: "female-f",
    kind: "human",
    displayName: "Juno",
    // Blue jeans + orange straps; her black jacket is untargeted (near-black cells double as
    // face/eye pixels across the pack - recoloring them would tint eyes).
    recolorTargets: ["#5b66c4", "#ffab42"],
  },
  {
    id: "male-a",
    kind: "human",
    displayName: "Theo",
    // Tee body + its brighter collar/trim cell.
    recolorTargets: ["#319a74", "#5ac487"],
  },
  {
    id: "male-b",
    kind: "human",
    displayName: "Otis",
    // Shorts, not the tee: the tee's orange family overlaps his beard's gradient cells.
    recolorTargets: ["#6794d9"],
  },
  { id: "male-c", kind: "human", displayName: "Sarge", recolorTargets: ["#6794d9"] },
  {
    id: "male-d",
    kind: "human",
    displayName: "Preston",
    // Suit stays black (see female-f note); his red tie carries the accent instead. Tight
    // tolerance: at the default 42 the tie target also caught his auburn hair cells.
    recolorTargets: ["#cf534f"],
    tolerance: 28,
  },
  {
    id: "male-e",
    kind: "human",
    displayName: "Milo",
    recolorTargets: ["#ffab42", "#ffc053"],
  },
  { id: "male-f", kind: "human", displayName: "Bruno", recolorTargets: ["#319a74", "#61cb8b"] },
];

/** Which pack a roster entry renders from. */
export function packIdFor(avatar) {
  return avatar.kind === "pet" ? "cube-pets" : "mini-characters";
}

/** Resolved role -> pack clip name for one roster entry (per-kind defaults + entry override). */
export function clipsFor(avatar) {
  return { ...defaultClips[avatar.kind], ...avatar.clips };
}
