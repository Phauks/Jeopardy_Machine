// CAMPFIRES - the second staging theme, and the reason the interface is shaped the way it is.
//
// It exists to prove the claim in staging-theme.ts rather than to assert it: a theme with a
// different holding area (an open clearing with no drawn surface), a different station shape
// (a ring you sit AROUND rather than a hull you stand IN), different seating (four stools
// facing inward, not six spots facing the camera), and different waiting behaviour (milling
// about, not bobbing) is a single data file. Not one line of the scene, the layout, the 2D
// fallback, or any screen changes to add it.
//
// It also happens to be the theme the first event wants: Terra Verde's forest lobby is pets
// around campfires in a clearing (docs/research/00-user-directives.md, "3D environments").
import type { StagingTheme } from "#lib/staging/staging-theme.ts";

const ringRadius = 0.62;

export const campfiresStagingTheme: StagingTheme = {
  id: "campfires",
  label: "Campfires",
  blurb: "Waiting players wander the clearing; picking a team sits you at that team's fire.",
  stationNoun: "campfire",
  holdingAreaNoun: "the clearing",
  boardVerb: "join",
  stationFootprint: { width: ringRadius * 2 + 0.75, depth: ringRadius * 2 + 0.75 },

  stationParts: [
    // The fire ring itself wears the team colour - a low disc of banked earth, which is the
    // largest flat area and therefore the one that answers "whose fire is that".
    {
      shape: {
        kind: "cylinder",
        radiusTop: ringRadius,
        radiusBottom: ringRadius + 0.06,
        height: 0.09,
        segments: 10,
      },
      position: [0, 0.045, 0],
      color: "team",
    },
    // Logs stacked into a cone, in the darkened team colour so the ring still dominates.
    {
      shape: { kind: "cylinder", radiusTop: 0.05, radiusBottom: 0.2, height: 0.3, segments: 7 },
      position: [0, 0.24, 0],
      color: "team-shade",
    },
    // The flame is the room's accent, so a clearing of six fires shares one venue colour the
    // way the boats share one pennant.
    {
      shape: { kind: "cylinder", radiusTop: 0, radiusBottom: 0.15, height: 0.42, segments: 6 },
      position: [0, 0.5, 0],
      color: "accent",
    },
    // Four stools, one per seat, in neutral structure so they read as furniture rather than
    // as more team colour.
    {
      shape: { kind: "cylinder", radiusTop: 0.13, radiusBottom: 0.13, height: 0.16, segments: 6 },
      position: [0, 0.08, ringRadius + 0.34],
      color: "structure",
    },
    {
      shape: { kind: "cylinder", radiusTop: 0.13, radiusBottom: 0.13, height: 0.16, segments: 6 },
      position: [ringRadius + 0.34, 0.08, 0],
      color: "structure",
    },
    {
      shape: { kind: "cylinder", radiusTop: 0.13, radiusBottom: 0.13, height: 0.16, segments: 6 },
      position: [0, 0.08, -ringRadius - 0.34],
      color: "structure",
    },
    {
      shape: { kind: "cylinder", radiusTop: 0.13, radiusBottom: 0.13, height: 0.16, segments: 6 },
      position: [-ringRadius - 0.34, 0.08, 0],
      color: "structure",
    },
  ],

  // Four places around the fire, each FACING IT: heading points back at the origin, which is
  // the opposite convention from the boats' everyone-faces-the-camera row, and the layout code
  // needs no special case for either.
  seatOffsets: [
    { x: 0, z: ringRadius + 0.34, heading: Math.PI },
    { x: ringRadius + 0.34, z: 0, heading: -Math.PI / 2 },
    { x: 0, z: -ringRadius - 0.34, heading: 0 },
    { x: -ringRadius - 0.34, z: 0, heading: Math.PI / 2 },
  ],

  nameplateOffset: [0, 1.25, 0],
  // Outside the ring of stools, on the near side: the plate belongs to the fire without
  // standing between the camera and the people sitting at it.
  crewPlateOffset: [0, 0.1, ringRadius + 0.72],

  // No drawn surface: the clearing IS the themed ground the diorama already paints, which is
  // the "holdingSurface: null" case the boats theme does not exercise.
  holdingSurface: null,
  holdingMotion: "mill",
};
