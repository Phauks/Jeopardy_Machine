// BOATS - the first staging theme, and the owner's brief verbatim: unassigned players are in
// the water, choosing a team puts you on that team's boat, the boat is the team's colour, the
// nameplate is the team's name, and switching teams is a visible swim across.
//
// Everything below is authored in station-local space: origin at the boat's centre on the
// waterline, +Z toward the camera, and one avatar stands 0.8 units tall (the height
// diorama-scene.ts normalises every pack to). The hull is deliberately wide and shallow - a
// deep hull hides the people standing in it, which is the entire thing this scene exists to
// show. Every dimension here was chosen against that 0.8: the gunwale reaches an avatar's
// knee, the mast clears their head, and the sail sits behind them rather than over them.
import type { StagingTheme } from "#lib/staging/staging-theme.ts";

const hullWidth = 1.75;
const hullDepth = 1.05;
const hullHeight = 0.3;

export const boatsStagingTheme: StagingTheme = {
  id: "boats",
  label: "Boats",
  blurb: "Waiting players tread water; picking a team puts you aboard that team's boat.",
  stationNoun: "boat",
  holdingAreaNoun: "the water",
  boardVerb: "board",
  // Half a hull of clear water between neighbours, so two boats never read as one catamaran.
  stationFootprint: { width: hullWidth + 0.55, depth: hullDepth + 0.7 },

  stationParts: [
    // Hull: the team's colour, and the largest single area on the station - the thing that
    // makes "which boat is mine" answerable from the back of a hall.
    {
      shape: { kind: "box", width: hullWidth, height: hullHeight, depth: hullDepth },
      position: [0, hullHeight / 2, 0],
      color: "team",
    },
    // Bow and stern: cones laid on their sides, so the hull ends in points instead of a brick.
    // Rotating a cylinder -90 degrees about X lays its axis along Z; the bow then tapers to +Z.
    {
      shape: {
        kind: "cylinder",
        radiusTop: 0,
        radiusBottom: hullHeight * 0.86,
        height: 0.5,
        segments: 6,
      },
      position: [0, hullHeight / 2, hullDepth / 2 + 0.24],
      rotation: [-Math.PI / 2, 0, 0],
      color: "team",
    },
    {
      shape: {
        kind: "cylinder",
        radiusTop: 0,
        radiusBottom: hullHeight * 0.7,
        height: 0.34,
        segments: 6,
      },
      position: [0, hullHeight / 2, -hullDepth / 2 - 0.16],
      rotation: [Math.PI / 2, 0, 0],
      color: "team-shade",
    },
    // Deck: lighter than the hull so the people standing on it separate from it.
    {
      shape: { kind: "plane", width: hullWidth - 0.12, depth: hullDepth - 0.1 },
      position: [0, hullHeight + 0.002, 0],
      rotation: [-Math.PI / 2, 0, 0],
      color: "team-light",
    },
    // Gunwales: two low rails, which is what makes the deck read as inside something.
    {
      shape: { kind: "box", width: 0.07, height: 0.16, depth: hullDepth },
      position: [-hullWidth / 2 + 0.035, hullHeight + 0.08, 0],
      color: "team-shade",
    },
    {
      shape: { kind: "box", width: 0.07, height: 0.16, depth: hullDepth },
      position: [hullWidth / 2 - 0.035, hullHeight + 0.08, 0],
      color: "team-shade",
    },
    // Mast, boom, and sail, all set BEHIND the seats (-Z): a sail over the crew would hide the
    // avatars from a camera that is deliberately low and close.
    {
      shape: { kind: "cylinder", radiusTop: 0.032, radiusBottom: 0.04, height: 1.5, segments: 6 },
      position: [0, hullHeight + 0.75, -hullDepth / 2 + 0.16],
      color: "structure",
    },
    {
      shape: { kind: "box", width: 0.9, height: 0.7, depth: 0.02 },
      position: [0, hullHeight + 0.95, -hullDepth / 2 + 0.14],
      color: "team-light",
    },
    // Pennant at the masthead: the one part wearing the ROOM's accent rather than the team's,
    // so a lobby of six colours still reads as one venue.
    {
      shape: { kind: "box", width: 0.26, height: 0.13, depth: 0.015 },
      position: [0.14, hullHeight + 1.44, -hullDepth / 2 + 0.15],
      color: "accent",
    },
  ],

  // Six standing spots: two rows of three, all facing the camera, front row first so a boat
  // with one person aboard shows them at the bow rather than hidden behind the mast.
  seatOffsets: [
    { x: -0.5, z: 0.24, heading: 0 },
    { x: 0, z: 0.3, heading: 0 },
    { x: 0.5, z: 0.24, heading: 0 },
    { x: -0.5, z: -0.14, heading: 0 },
    { x: 0, z: -0.18, heading: 0 },
    { x: 0.5, z: -0.14, heading: 0 },
  ],

  // Above the sail, clear of every avatar's head at any seat.
  nameplateOffset: [0, hullHeight + 1.75, -hullDepth / 2 + 0.15],

  holdingSurface: {
    // Wider and deeper than any pen: the water has to run past the edge of frame, or the
    // diorama looks like a puddle on a floor rather than an open bay.
    shape: { kind: "plane", width: 60, depth: 40 },
    y: 0.02,
    color: "holding",
    // Slightly transparent so the themed ground beneath tints it - a green-tokened theme gets
    // green-tinged water without the theme naming a water colour.
    opacity: 0.82,
  },
  holdingMotion: "bob",
};
