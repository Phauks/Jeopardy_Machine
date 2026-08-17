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
};

/** Where one occupant belongs right now. `stationId` null = waiting in the holding area. */
export type StagedTarget = {
  entityId: string;
  stationId: string | null;
  x: number;
  z: number;
  heading: number;
};

/**
 * Fraction of the pen's depth given to the holding area, measured from the camera edge. A
 * third: enough water for a dozen people to wait in without crowding, little enough that the
 * boats still dominate the frame - they are what the screen is asking about.
 */
const holdingDepthFraction = 1 / 3;

/** Columns the holding area lays waiting occupants out in, front rows first. */
const holdingColumns = 6;

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
 * Lay the stations out across the back band: as many per row as fit the theme's footprint,
 * then wrap. Rows run back to front, so a room with three teams puts them on the row nearest
 * the water rather than against the far wall.
 *
 * Order is the input order and nothing else. A team that already has a spot must keep it when
 * a new team is created, or every existing boat slides sideways the instant somebody presses
 * "new team" - which is exactly the class of bug the fixed spawn grid in wander.ts exists to
 * prevent for people.
 */
export function stationAnchors(
  stations: readonly StagingStation[],
  theme: StagingTheme,
  bounds: WanderBounds,
): StationAnchor[] {
  if (stations.length === 0) return [];
  const band = stagingBands(bounds).stations;
  const usableWidth = bounds.halfWidth * 2;
  const perRow = Math.max(
    1,
    Math.min(stations.length, Math.floor(usableWidth / theme.stationFootprint.width)),
  );
  const rows = Math.ceil(stations.length / perRow);
  // Rows are packed against the front of the station band and spread backward only as far as
  // they need, so two rows of boats do not leave a gap of empty floor behind them.
  const bandDepth = band.nearZ - band.farZ;
  const rowSpan = Math.min(theme.stationFootprint.depth, bandDepth / rows);

  return stations.map((station, index) => {
    const row = Math.floor(index / perRow);
    // The last row can be short; centring it under the full rows is what stops a lone seventh
    // boat from sitting hard against the left edge.
    const columnsInRow = Math.min(perRow, stations.length - row * perRow);
    const column = index % perRow;
    const columnSpan = usableWidth / columnsInRow;
    return {
      stationId: station.stationId,
      x: -bounds.halfWidth + columnSpan * (column + 0.5),
      z: band.nearZ - rowSpan * (row + 0.5),
      heading: 0,
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
  const rows = 3;
  const slots = holdingColumns * rows;
  const slot = ((slotIndex % slots) + slots) % slots;
  const column = slot % holdingColumns;
  const row = Math.floor(slot / holdingColumns);
  const spanX = (bounds.halfWidth * 2) / holdingColumns;
  const spanZ = (band.nearZ - band.farZ) / rows;
  const jitterX = random === null ? 0 : (random() - 0.5) * spanX * 0.5;
  const jitterZ = random === null ? 0 : (random() - 0.5) * spanZ * 0.4;
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
        // offset. When a theme fans them, this is the one place a rotation goes.
        x: anchor.x + seat.x,
        z: anchor.z + seat.z,
        heading: seat.heading + anchor.heading,
      });
    });
  }

  waitingIds.forEach((entityId, index) => {
    const spot = holdingPosition(index, bounds, random);
    targets.push({ entityId, stationId: null, x: spot.x, z: spot.z, heading: spot.heading });
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
