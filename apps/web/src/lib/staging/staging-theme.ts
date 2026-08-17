// THE STAGING-THEME INTERFACE - what it takes to give the pre-game lobby a new look.
//
// A staging theme answers five questions, and nothing else:
//   1. what the holding area looks like   (holdingSurface + holdingAreaNoun)
//   2. what a team's station looks like   (stationParts, in local space)
//   3. where its colour goes              (each part names a StagingColorRole)
//   4. where members stand on it          (seatOffsets, and where the nameplate floats)
//   5. how an unassigned occupant behaves (holdingMotion)
//
// It answers all five as DATA, not as code, and that is the load-bearing decision. Themes
// carry no three.js: a station is a short list of primitives with positions and colour roles,
// which diorama-scene.ts (still the only module in apps/web that imports three) instantiates.
// Three consequences, all of them the point:
//
// - A theme is unit-testable. Its geometry, seats, and colour roles are plain objects, so the
//   placement tests below run in node with no GPU, and a theme that seats nobody or paints
//   nothing fails a gate rather than looking subtly wrong on a projector.
// - RECOLOUR IS THE CHEAP VARIANT, as required. A station's colour is not in the theme at all;
//   the theme says which parts wear the team's colour and which wear structure, and the scene
//   resolves those roles per station. A red boat and a green boat share one geometry
//   description and differ by two material colours - no second theme, no second mesh list.
// - A new theme is a new file next to boats.ts, added to staging-theme-registry.ts. No edit to
//   the scene, the layout, the 2D fallback, or any screen.
//
// The 2D degradation reads the same object: stationNoun, holdingAreaNoun, and the colour roles
// are what let a WebGL-less browser render "boats on water" as CSS layout rather than nothing.

/**
 * Which colour a part paints itself. The station roles resolve against the TEAM's colour, so
 * a recolour is a per-station material swap; the scene roles resolve against the active theme
 * document's tokens, so a staging theme never names a hex of its own.
 */
export type StagingColorRole =
  /** The team's colour, full strength: the hull, the tent, the thing you point at. */
  | "team"
  /** The team's colour, darkened: structure that must not compete with the hull. */
  | "team-shade"
  /** The team's colour, lightened: decks, trim, the parts that catch the light. */
  | "team-light"
  /** Neutral structure that is the same on every station: masts, stones, rope. */
  | "structure"
  /** The holding area's own surface (water, grass). */
  | "holding"
  /** The room theme's accent - flags, embers. One touch of the venue on every station. */
  | "accent";

/**
 * The primitive vocabulary. Three shapes cover every station drawn so far, and the constraint
 * is deliberate: a theme that needs a fourth is a theme that wants a mesh file, which is the
 * M7 world-kit conversation rather than a shape added here in passing. A cone is a cylinder
 * with radiusTop 0, so it is not its own case.
 */
export type StagingShape =
  | { kind: "box"; width: number; height: number; depth: number }
  | {
      kind: "cylinder";
      radiusTop: number;
      radiusBottom: number;
      height: number;
      /** Low on purpose - the avatars are low-poly and a smooth cylinder looks foreign. */
      segments: number;
    }
  | { kind: "plane"; width: number; depth: number };

export type Vector3Tuple = readonly [x: number, y: number, z: number];

export type StagingPart = {
  shape: StagingShape;
  /** Local space: origin at the station's centre, on the floor, +Z toward the camera. */
  position: Vector3Tuple;
  /** Euler radians, applied XYZ. Omitted means unrotated. */
  rotation?: Vector3Tuple;
  color: StagingColorRole;
};

/** Where one member stands on a station, in the station's local space. */
export type StagingSeat = {
  x: number;
  z: number;
  /** Facing in radians the way three rotates about Y: 0 faces +Z, toward the camera. */
  heading: number;
};

/** A rim around the holding surface: the thing that makes it a PLACE rather than a colour. */
export type HoldingEdge = {
  /** How far the rim stands above the surface. */
  height: number;
  /** How thick the rim is, looking down. */
  thickness: number;
  color: StagingColorRole;
};

/**
 * The holding area's own surface, when the theme draws one (water does, a clearing may not).
 *
 * The surface is sized to the HOLDING BAND (staging-layout.ts) plus `margin`, not to the whole
 * stage. That is a 2026-08-16 reversal of the boats theme's original 60x40 plane: a surface
 * that ran past every edge of the frame made the water indistinguishable from the floor, which
 * is the mechanical half of the owner's "I don't understand still in the water" - there was no
 * boundary, so there was no place to be in. The words are the other half (staging-copy.ts).
 */
export type HoldingSurface = {
  /** How far past the holding band the surface runs, in world units. */
  margin: number;
  /** Height above the floor - water sits a hair above it so it z-fights nothing. */
  y: number;
  color: StagingColorRole;
  /** Slight transparency reads as water without needing a shader. 1 = opaque. */
  opacity: number;
  /** Null draws an unbounded surface; every theme that draws one should bound it. */
  edge: HoldingEdge | null;
};

export type StagingTheme = {
  id: string;
  label: string;
  /** One line for the theme picker and the dev page. */
  blurb: string;
  /** Singular noun for a station: "boat", "campfire". Reaches copy and the 2D fallback. */
  stationNoun: string;
  /** What the holding area is called: "the water", "the clearing". */
  holdingAreaNoun: string;
  /** Verb for the move onto a station, used in the 2D fallback's copy: "board", "join". */
  boardVerb: string;
  /** Space one station occupies, so the layout can pack stations without overlapping them. */
  stationFootprint: { width: number; depth: number };
  stationParts: readonly StagingPart[];
  /** Members are seated in order; more members than seats wrap and are nudged apart. */
  seatOffsets: readonly StagingSeat[];
  /** Local point the team's nameplate floats at. */
  nameplateOffset: Vector3Tuple;
  /**
   * Local point the CREW PLATE sits at - the list of who is aboard (owner, 2026-08-16: "names
   * beneath the boats on the display"). In front of and below the station, so it never covers
   * the people it names and the room reads it as belonging to that station.
   */
  crewPlateOffset: Vector3Tuple;
  holdingSurface: HoldingSurface | null;
  /**
   * What waiting looks like. "bob" rides an unassigned occupant gently up and down (treading
   * water); "mill" leaves them flat on the floor. Both stand perfectly still under
   * prefers-reduced-motion - the freeze is not the theme's choice to make.
   */
  holdingMotion: "bob" | "mill";
};

/** Seat for the nth member of a station, wrapping past the theme's seat count. */
export function seatForMember(theme: StagingTheme, memberIndex: number): StagingSeat {
  const seats = theme.seatOffsets;
  if (seats.length === 0) return { x: 0, z: 0, heading: 0 };
  const seat = seats[memberIndex % seats.length];
  if (seat === undefined) return { x: 0, z: 0, heading: 0 };
  // Past the seat count, members share a seat rather than being dropped: a crowded boat should
  // look crowded. The nudge alternates sides so two sharers never stand in the same spot.
  const wrap = Math.floor(memberIndex / seats.length);
  if (wrap === 0) return seat;
  const side = wrap % 2 === 1 ? 1 : -1;
  // ...but the nudge is CLAMPED to the station's own footprint, because the layout guarantees
  // clearance between FOOTPRINTS (staging-layout.ts) and an unbounded nudge would walk the
  // twentieth member of a team off their boat and onto the neighbouring one. A seat the theme
  // itself authored further out than the footprint (a stool at the very edge of a campfire
  // ring) is never pulled in - it is the theme's own geometry, and only the drift is bounded.
  return {
    ...seat,
    x: clampToFootprint(
      seat.x + side * 0.12 * Math.ceil(wrap / 2),
      seat.x,
      footprintLimit(theme.stationFootprint.width),
    ),
    z: clampToFootprint(seat.z - 0.08 * wrap, seat.z, footprintLimit(theme.stationFootprint.depth)),
  };
}

/** Half a footprint, less the width of a shoulder, so a seated avatar is inside its station. */
function footprintLimit(extent: number): number {
  return Math.max(0, extent / 2 - 0.1);
}

function clampToFootprint(value: number, authored: number, limit: number): number {
  const bound = Math.max(limit, Math.abs(authored));
  return Math.min(bound, Math.max(-bound, value));
}
