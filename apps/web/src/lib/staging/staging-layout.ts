// Where every station stands, and where every person stands - in plain numbers, with no
// three.js anywhere near it.
//
// Same division of labour wander.ts already established for the free-roaming diorama: this
// module DECIDES, diorama-scene.ts only copies the decision onto Object3Ds. That is what makes
// the interesting parts - a full room packing without overlap, a team switch producing a real
// move, an unassigned player never standing inside a station - testable in node.
//
// The stage splits along Z. Stations occupy the BACK band and the holding area the FRONT one,
// nearest the camera, because the people who have not chosen yet are the ones the screen is
// asking a question of. Nothing crosses the divide: an unassigned occupant is always in the
// holding band, a seated one always on their station.
import { maxDioramaAvatars } from "#lib/diorama/wander.ts";
import { seatForMember } from "#lib/staging/staging-theme.ts";
import type { StagingTheme } from "#lib/staging/staging-theme.ts";
import type { RandomSource, WanderBounds } from "#lib/diorama/wander.ts";

/** One team, as the staging layer needs it: an id, a label, a colour, and who is aboard. */
export type StagingStation = {
  stationId: string;
  /** The nameplate text - the team's name. */
  label: string;
  /** Resolved hex for this station's team-role parts. The recolour, and the whole of it. */
  colorHex: string;
  /** Entity ids aboard, in a stable order (join order); seat index follows this array. */
  memberIds: readonly string[];
};

/** A station's spot on the stage, in world units. */
export type StationAnchor = {
  stationId: string;
  x: number;
  z: number;
  /** Stations all face the camera; the field exists so a future theme can fan them. */
  heading: number;
  /**
   * Uniform scale the whole station (and its crew) wears, 0 < scale <= 1. THE thing that makes
   * "no two stations overlap" true at every team count rather than only at small ones - see
   * `stationGrid`.
   */
  scale: number;
};

/** Where one occupant belongs right now. `stationId` null = waiting in the holding area. */
export type StagedTarget = {
  entityId: string;
  stationId: string | null;
  x: number;
  z: number;
  heading: number;
  /** The station's scale, so an occupant aboard a shrunken station shrinks with it. 1 waiting. */
  scale: number;
};

/**
 * Fraction of the pen's depth given to the holding area, measured from the camera edge. A
 * third: enough water for a dozen people to wait in without crowding, little enough that the
 * boats still dominate the frame - they are what the screen is asking about.
 */
const holdingDepthFraction = 1 / 3;

/** Columns the holding area lays waiting occupants out in, front rows first. */
const holdingColumns = 6;

/**
 * Rows the holding grid has, derived from the crowd the diorama will ever draw rather than
 * picked. It used to be a hard 3, which gave 18 slots for a stage that animates up to
 * `maxDioramaAvatars` (24) - so the 19th waiting player stood EXACTLY on top of the 1st, since
 * the slot index wraps. A capacity-derived row count is the fix that cannot drift: raise the
 * avatar cap and the water gains rows to hold them.
 */
const holdingRows = Math.ceil(maxDioramaAvatars / holdingColumns);

/**
 * The floor an avatar needs to itself, in world units. Every avatar is normalised to 0.8 units
 * tall (diorama-scene.ts) and a Kenney figure is roughly half as wide as it is tall, so 0.4 is
 * "shoulders do not intersect". The holding grid and its jitter are both measured against it,
 * which is what makes "nobody stands inside anybody" an assertion rather than a hope.
 */
export const occupantSpacing = 0.4;

/** How the stations are arranged, and how big they had to become to fit. */
export type StationGrid = {
  columns: number;
  rows: number;
  /** Uniform scale every station wears, 0 < scale <= 1 (1 = the theme's authored size). */
  scale: number;
  /** The cell each station owns. Its footprint at `scale` fits inside this by construction. */
  cellWidth: number;
  cellDepth: number;
};

/**
 * Choose the arrangement for `count` stations: how many columns, how many rows, and how much
 * the stations have to shrink to make that fit.
 *
 * THIS IS THE OVERLAP FIX (owner report, 2026-08-16: "boats overlap each other"). The old
 * packing filled rows greedily at the theme's authored size and then spread the rows over
 * whatever depth was left - so from five teams up, the row spacing was smaller than a boat is
 * long and the hulls sat inside each other. Two teams looked fine, which is exactly why it
 * survived review.
 *
 * The rule now: a station never draws outside the cell it was given, so non-overlap is a
 * property of the GRID rather than of the count. The search tries every column count and keeps
 * the one that lets the stations stay biggest - which naturally picks 3x2 for six boats and
 * 4x3 for twelve, without either being written down anywhere. Ties go to the shallower grid,
 * because a row further back is a row the front row partly hides.
 */
export function stationGrid(count: number, theme: StagingTheme, bounds: WanderBounds): StationGrid {
  const band = stagingBands(bounds).stations;
  const usableWidth = bounds.halfWidth * 2;
  const bandDepth = band.nearZ - band.farZ;
  const empty: StationGrid = {
    columns: 0,
    rows: 0,
    scale: 1,
    cellWidth: usableWidth,
    cellDepth: bandDepth,
  };
  if (count <= 0) return empty;

  let best: StationGrid | null = null;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellWidth = usableWidth / columns;
    const cellDepth = bandDepth / rows;
    const scale = Math.min(
      1,
      cellWidth / theme.stationFootprint.width,
      cellDepth / theme.stationFootprint.depth,
    );
    const candidate: StationGrid = { columns, rows, scale, cellWidth, cellDepth };
    if (best === null) {
      best = candidate;
      continue;
    }
    // Float comparison with a tolerance, so "the same scale" really is a tie and the row
    // count decides rather than the last bit of a division.
    if (scale > best.scale + 1e-9) best = candidate;
    else if (Math.abs(scale - best.scale) <= 1e-9 && rows < best.rows) best = candidate;
  }
  return best ?? empty;
}

/** The two Z bands, derived from the pen so a resize moves both together. */
export function stagingBands(bounds: WanderBounds): {
  holding: { nearZ: number; farZ: number };
  stations: { nearZ: number; farZ: number };
} {
  const divide = bounds.halfDepth - bounds.halfDepth * 2 * holdingDepthFraction;
  return {
    holding: { nearZ: bounds.halfDepth, farZ: divide },
    stations: { nearZ: divide, farZ: -bounds.halfDepth },
  };
}

/**
 * Lay the stations out on the grid `stationGrid` chose. Rows run front to back, so a room with
 * three teams puts them on the row nearest the water rather than against the far wall, and the
 * order is the input order and nothing else.
 *
 * Rows are packed tight against the front of the band (one scaled footprint apart) rather than
 * spread over the whole depth: the boats belong near the water, where they are biggest, and a
 * second row of boats should not leave a strip of empty floor behind it.
 *
 * REVERSAL, 2026-08-16. Until now a station kept its exact spot when a new team was created,
 * and that was gate-tested. It cannot survive the overlap fix: a grid that guarantees clearance
 * for N stations is not the grid for N+1, so creating a team re-packs the stage. The promise
 * that replaces it is that nothing JUMPS - diorama-scene.ts eases each station to its new
 * anchor (staging-motion.ts, `easeStationPosition`), so the harbour visibly makes room for the
 * new boat instead of teleporting around it.
 */
export function stationAnchors(
  stations: readonly StagingStation[],
  theme: StagingTheme,
  bounds: WanderBounds,
): StationAnchor[] {
  if (stations.length === 0) return [];
  const band = stagingBands(bounds).stations;
  const usableWidth = bounds.halfWidth * 2;
  const grid = stationGrid(stations.length, theme, bounds);
  const rowSpan = theme.stationFootprint.depth * grid.scale;

  return stations.map((station, index) => {
    const row = Math.floor(index / grid.columns);
    // The last row can be short; centring it under the full rows is what stops a lone seventh
    // boat from sitting hard against the left edge. A short row only ever spreads its stations
    // FURTHER apart than a full one, so the clearance guarantee is untouched.
    const columnsInRow = Math.min(grid.columns, stations.length - row * grid.columns);
    const column = index % grid.columns;
    const columnSpan = usableWidth / columnsInRow;
    return {
      stationId: station.stationId,
      x: -bounds.halfWidth + columnSpan * (column + 0.5),
      z: band.nearZ - rowSpan * (row + 0.5),
      heading: 0,
      scale: grid.scale,
    };
  });
}

/**
 * A waiting occupant's spot in the holding area. Fixed grid, front rows first, for the same
 * reason wander.ts spawns on one: a grid sized to the current crowd would shuffle everybody
 * still waiting every time one person picked a team.
 */
export function holdingPosition(
  slotIndex: number,
  bounds: WanderBounds,
  random: RandomSource | null = null,
): { x: number; z: number; heading: number } {
  const band = stagingBands(bounds).holding;
  const slots = holdingColumns * holdingRows;
  const slot = ((slotIndex % slots) + slots) % slots;
  const column = slot % holdingColumns;
  const row = Math.floor(slot / holdingColumns);
  const spanX = (bounds.halfWidth * 2) / holdingColumns;
  const spanZ = (band.nearZ - band.farZ) / holdingRows;
  // The jitter is what stops a crowd looking mechanically spaced - and it is the reason the
  // water looked crowded even before the slots ran out, because it used to be a fraction of
  // the cell and could close most of the gap between two neighbours. It is now whatever is
  // LEFT OVER once everybody has their personal space, so the grid's separation guarantee
  // survives the scatter: two neighbours can never end up closer than `occupantSpacing`.
  const jitterX = random === null ? 0 : (random() - 0.5) * Math.max(0, spanX - occupantSpacing);
  const jitterZ = random === null ? 0 : (random() - 0.5) * Math.max(0, spanZ - occupantSpacing);
  return {
    x: -bounds.halfWidth + spanX * (column + 0.5) + jitterX,
    z: band.nearZ - spanZ * (row + 0.5) + jitterZ,
    // Waiting occupants face the camera - the screen is asking them a question.
    heading: 0,
  };
}

/**
 * The whole stage's target positions: everyone aboard a station on their seat, everyone else
 * spread through the holding area.
 *
 * `waitingIds` is ordered, and the order is what pins a waiting occupant to a slot. Callers
 * pass join order, so somebody who has been treading water since the doors opened keeps their
 * spot while people around them board.
 */
export function placeStaging(
  stations: readonly StagingStation[],
  waitingIds: readonly string[],
  theme: StagingTheme,
  bounds: WanderBounds,
  random: RandomSource | null = null,
): StagedTarget[] {
  const anchors = new Map(stationAnchors(stations, theme, bounds).map((a) => [a.stationId, a]));
  const targets: StagedTarget[] = [];

  for (const station of stations) {
    const anchor = anchors.get(station.stationId);
    if (anchor === undefined) continue;
    station.memberIds.forEach((entityId, memberIndex) => {
      const seat = seatForMember(theme, memberIndex);
      targets.push({
        entityId,
        stationId: station.stationId,
        // Stations only ever face the camera today, so a seat's local offset is its world
        // offset. When a theme fans them, this is the one place a rotation goes. The seat
        // scales with the station: a crew standing at authored spacing on a boat packed down
        // to 60% would be standing in the water either side of it.
        x: anchor.x + seat.x * anchor.scale,
        z: anchor.z + seat.z * anchor.scale,
        heading: seat.heading + anchor.heading,
        scale: anchor.scale,
      });
    });
  }

  waitingIds.forEach((entityId, index) => {
    const spot = holdingPosition(index, bounds, random);
    // Full size in the water, always: the holding area is sized for the whole room and the
    // people in it are the ones the screen is asking a question of.
    targets.push({
      entityId,
      stationId: null,
      x: spot.x,
      z: spot.z,
      heading: spot.heading,
      scale: 1,
    });
  });

  return targets;
}

/**
 * Split a roster into the two things placeStaging wants. Kept here rather than in a component
 * so "who is waiting" has exactly one definition: anybody with no station, in join order.
 */
export function partitionForStaging<T extends { entityId: string; stationId: string | null }>(
  occupants: readonly T[],
  stationIds: readonly string[],
): { members: Map<string, string[]>; waiting: string[] } {
  const members = new Map<string, string[]>(stationIds.map((id) => [id, []]));
  const waiting: string[] = [];
  for (const occupant of occupants) {
    const seatList = occupant.stationId === null ? undefined : members.get(occupant.stationId);
    // A station id the roster names but the station list does not (a team deleted between two
    // renders) leaves its members waiting rather than dropping them off the stage.
    if (seatList === undefined) waiting.push(occupant.entityId);
    else seatList.push(occupant.entityId);
  }
  return { members, waiting };
}
