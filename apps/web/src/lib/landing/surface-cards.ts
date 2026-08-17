// The developer index: every meaningful surface in the suite, with a sentence saying what it
// is for.
//
// OWNER RULE, still in force: every new meaningful surface gets a card here, in the same PR
// that ships it. It used to BE the front page; on 2026-08-15 it moved into a closed drawer,
// and the 2026-08-16 front-door rebuild kept it there - demoted, never deleted, at the bottom
// of the page behind one tap. (The creator Library, user-flows B1, is what eventually replaces
// it.) It lives in a data module rather than inside the page so that adding a surface is a
// one-line edit in an obvious file.
export type SurfaceCard = { href: string; title: string; note: string };

export const devSurfaces: readonly SurfaceCard[] = [
  {
    href: "/dev/hotseat",
    title: "Hotseat game",
    note: "Play a full two-round game + final, keyboard-driven, no server (M2 engine). S starts, A arms, 1-8 buzz, C/W/N judge, U undo.",
  },
  {
    href: "/dev/theme",
    title: "Theme gallery",
    note: "Four presets on the live token contract - board, type, swatches, emblems, effects toggle (M4 phase 1).",
  },
  {
    href: "/dev/rooms",
    title: "Room instrument panel",
    note: "Three-column room console: create/delete rooms and see every one this tab made, connect and join through the single origin with a live DO inspector, watch the auto-refreshing public lobby with the registry's health stated out loud, and run the refusal probes in the test area.",
  },
  {
    href: "/dev/diorama",
    title: "Avatar diorama",
    note: "The live 3D scene with fake players: free-wander mode and the staged lobby (boats and campfires), switch themes, fire a buzz beat, flip to the winner scene - without hosting a game.",
  },
  {
    href: "/room/DUMYX",
    title: "Player room",
    note: "The pre-game journey on a phone: character selector (A2), team joining, A3 lobby with the staged view, then the A4 buzzer (the DUMYX demo room simulates a full 30-player lobby in this tab alone; ?theme=modern-flat previews presets).",
  },
  {
    href: "/room/DUMYX/display",
    title: "Display screen",
    note: "Projector board: title screen + QR, category reveal, clue card, winner screen - with the staged 3D lobby on lobby and winner phases. Works on a phone too.",
  },
  {
    href: "/room/DUMYX/host",
    title: "Host console",
    note: "C4 console incl. mirror mode (?mirror) and the dev sim panel driving fake players.",
  },
  {
    href: "/api/rooms",
    title: "/api/rooms",
    note: "The public room listing as JSON: live public rooms, newest first, capped and briefly cached. POST creates a room - which the front page now does for you.",
  },
  {
    href: "/api/rooms/DUMYX/live",
    title: "/api/rooms/CODE/live",
    note: "Does that code still name a room? One boolean from the registry, no host token - what the front page's rejoin offer asks before advertising a room you were in.",
  },
  {
    href: "/api/version",
    title: "/api/version",
    note: "Deployment identity as JSON: commit, build time, wire protocol version, and the registry's own health probe.",
  },
];
