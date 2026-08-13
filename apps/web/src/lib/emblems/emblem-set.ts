// Curated emblem set - the player-identity direction replacing free emoji (owner is
// emoji-skeptical: docs/research/00-user-directives.md, "UI gallery feedback round 1").
// Design rules that make these work where emoji do not:
//   1. Single-color marks that tint via currentColor - so they inherit team/accent colors
//      from the token contract and render identically on every platform (no emoji-font
//      lottery between Android vendors and iOS).
//   2. One 24x24 grid, comparable stroke weight and optical size - a designed SET, not a
//      grab bag.
//   3. Motifs match the product's worlds: nature (first-event flavor), gaming, and neutral
//      geometric marks.
// This is the working set for gallery review; the FINAL set is owner-curated (marks get
// added/cut/redrawn on owner feedback before player identity ships in M4 phase 2/M5).
// Emblem ids will then become a protocol enum (player/team identity fields, M3 modeling).

export type EmblemCategory = "nature" | "gaming" | "geometric";

export type Emblem = {
  id: string;
  label: string;
  category: EmblemCategory;
  /** SVG inner markup for a 24x24 viewBox; fill comes from currentColor on the <svg>. */
  markup: string;
};

export const emblems: readonly Emblem[] = [
  // --- Nature ---
  {
    id: "leaf",
    label: "Leaf",
    category: "nature",
    markup:
      '<path d="M20 4C12 4 5 8 4 16c-.2 1.8.4 3.4 1.2 4 .3-5 3.6-9.6 9.3-12-4.8 3-7.6 7.2-7.9 12.4 1 .4 2.3.6 3.7.6C17 21.5 20.5 14 20 4Z"/>',
  },
  {
    id: "pine",
    label: "Pine",
    category: "nature",
    markup:
      '<path d="M12 1.5 17 9h-2.6l4.1 6H15l4.5 6.5H13V22h-2v-.5H4.5L9 15H5.5l4.1-6H7l5-7.5Z"/>',
  },
  {
    id: "mountain",
    label: "Mountain",
    category: "nature",
    markup: '<path d="M3 20 10 6l3.6 7.1L16 9l5 11H3Zm7-9.7L8.2 14h3.6L10 10.3Z"/>',
  },
  {
    id: "wave",
    label: "Wave",
    category: "nature",
    markup:
      '<path d="M2 16.5c2.6-5.6 6-6.6 9-3.6 2.4 2.4 4.7 2.2 7-1l2 1.4c-3 4.6-6.9 5-9.9 2-2.2-2.2-4-1.6-5.6 2.4L2 16.5Z"/>',
  },
  {
    id: "sun",
    label: "Sun",
    category: "nature",
    markup:
      '<circle cx="12" cy="12" r="4.4"/><path d="M11 2h2v3.2h-2Zm0 16.8h2V22h-2ZM2 11h3.2v2H2Zm16.8 0H22v2h-3.2ZM4.6 6 6 4.6l2.3 2.3-1.4 1.4Zm11.1 11.1 1.4-1.4 2.3 2.3-1.4 1.4Zm-8.8 1L4.6 18l2.3-2.3 1.4 1.4ZM18 4.6 19.4 6l-2.3 2.3-1.4-1.4Z"/>',
  },
  {
    id: "acorn",
    label: "Acorn",
    category: "nature",
    markup:
      '<path d="M11 2.5h2c.6 0 1 .4 1 1V4h-4v-.5c0-.6.4-1 1-1ZM6 9.5C6 6.5 8.7 5 12 5s6 1.5 6 4.5v.9H6v-.9Z"/><path d="M7 12h10c0 4.8-2.9 7.6-5 9-2.1-1.4-5-4.2-5-9Z"/>',
  },
  {
    id: "mushroom",
    label: "Mushroom",
    category: "nature",
    markup:
      '<path d="M12 2.8c5.4 0 9 4.1 9 8 0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6 0-3.9 3.6-8 9-8Z"/><path d="M8.8 14h6.4l-.6 5.5c-.1 1-1 1.8-2 1.8h-1.2c-1 0-1.9-.8-2-1.8L8.8 14Z"/>',
  },
  {
    id: "clover",
    label: "Clover",
    category: "nature",
    markup:
      '<circle cx="8.3" cy="8.5" r="4.1"/><circle cx="15.7" cy="8.5" r="4.1"/><circle cx="12" cy="13.6" r="4.1"/><path d="M11 15.5h2c0 2.6.9 4.5 2.6 6.5H8.4c1.7-2 2.6-3.9 2.6-6.5Z"/>',
  },
  // --- Gaming ---
  {
    id: "d20",
    label: "D20",
    category: "gaming",
    markup:
      '<path fill-rule="evenodd" d="M12 1.4 21.4 7v10L12 22.6 2.6 17V7L12 1.4ZM12 6l-5.5 9.4h11L12 6Z"/>',
  },
  {
    id: "die-five",
    label: "Die",
    category: "gaming",
    markup:
      '<path fill-rule="evenodd" d="M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3Zm2.6 3.3a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm7.8 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm-3.9 3.9a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm-3.9 3.9a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm7.8 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z"/>',
  },
  {
    id: "meeple",
    label: "Meeple",
    category: "gaming",
    markup:
      '<path d="M12 2.6c1.8 0 3.1 1.3 3.1 3 0 .8-.3 1.5-.8 2.1 2.3.6 4.8 2 6.4 3.7.6.7.2 2-.8 2h-3.4c.6 1.8 2 3.8 3.5 5.3.7.8.2 2.5-.9 2.5h-4.6c-.9 0-1.7-.7-1.9-1.6L12 17.3l-.6 2.3c-.2.9-1 1.6-1.9 1.6H4.9c-1.1 0-1.6-1.7-.9-2.5 1.5-1.5 2.9-3.5 3.5-5.3H4.1c-1 0-1.4-1.3-.8-2C4.9 9.7 7.4 8.3 9.7 7.7c-.5-.6-.8-1.3-.8-2.1 0-1.7 1.3-3 3.1-3Z"/>',
  },
  {
    id: "trophy",
    label: "Trophy",
    category: "gaming",
    markup:
      '<path fill-rule="evenodd" d="M7 2.5h10V4h4v2.5c0 2.9-2.1 5.3-4.9 5.7-.8 1.5-2.1 2.7-3.6 3.1v2.9h2.4l1 3.3H8.1l1-3.3h2.4v-2.9c-1.5-.4-2.8-1.6-3.6-3.1C5.1 11.8 3 9.4 3 6.5V4h4V2.5ZM5 6v.5c0 1.6 1 3 2.3 3.6A9.8 9.8 0 0 1 7 8V6H5Zm14 0h-2v2c0 .7-.1 1.4-.3 2.1C18 9.5 19 8.1 19 6.5V6Z"/>',
  },
  {
    id: "chess-pawn",
    label: "Pawn",
    category: "gaming",
    markup:
      '<path d="M12 2.8a3.4 3.4 0 0 1 1.9 6.2c.4 2.4 1.2 4.6 2.6 6.5h-9c1.4-1.9 2.2-4.1 2.6-6.5A3.4 3.4 0 0 1 12 2.8ZM6.5 17h11l1.4 3.1c.3.7-.2 1.4-.9 1.4H6c-.7 0-1.2-.7-.9-1.4L6.5 17Z"/>',
  },
  // --- Geometric ---
  {
    id: "crown",
    label: "Crown",
    category: "geometric",
    markup:
      '<path d="m3 7.5 4.4 3.8L12 4.8l4.6 6.5L21 7.5l-1.4 9.7H4.4L3 7.5Zm1.6 11.2h14.8v2.5H4.6Z"/>',
  },
  {
    id: "target",
    label: "Target",
    category: "geometric",
    markup:
      '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"/>',
  },
  {
    id: "bolt",
    label: "Bolt",
    category: "geometric",
    markup: '<path d="M13.2 2 4.5 13.6h5.4L8.6 22l8.9-11.9h-5.5L13.2 2Z"/>',
  },
  {
    id: "star",
    label: "Star",
    category: "geometric",
    markup:
      '<path d="m12 1.8 3 6.7 7.2.7-5.4 4.9 1.5 7.1L12 17.5l-6.3 3.7 1.5-7.1-5.4-4.9 7.2-.7 3-6.7Z"/>',
  },
  {
    id: "hex",
    label: "Hex",
    category: "geometric",
    markup:
      '<path fill-rule="evenodd" d="M12 1.8 20.8 7v10L12 22.2 3.2 17V7L12 1.8Zm0 3.4L6.2 8.6v6.8l5.8 3.4 5.8-3.4V8.6L12 5.2Z"/>',
  },
];
