// How full a listed room is, as a lobby row needs to say it.
//
// The spectator fields were read structurally through a local cast while the room-controls
// half of this milestone was still adding them to `roomSummarySchema`; they landed at the
// 2026-08-16 reconcile and the cast is gone. What survives the cast is the RULE it existed to
// protect: the wire's spectator fields are OPTIONAL, absent means "this server does not report
// spectators", and absent is NOT zero. A row with no audience renders no line at all; a row
// with `spectatorCount: 0` renders "0" - a room nobody is watching is a fact, and pretending
// every server reports one would invent an empty audience for rooms that never mentioned it.
import type { RoomSummary } from "@jeopardy/protocol/room/registry";

export type SeatCount = {
  count: number;
  /** null = the wire named a count but no ceiling; the row then shows the count alone. */
  cap: number | null;
  /** 0..1 for the meter. A capless seat class has no meter, so this is null with the cap. */
  fraction: number | null;
  full: boolean;
};

function seatCount(count: number, cap: number | null): SeatCount {
  if (cap === null || cap <= 0) return { count, cap: null, fraction: null, full: false };
  // Clamped: a stale registry row can outlive a kick and briefly claim 41/40, and a meter
  // that overflows its track looks like a rendering bug rather than a stale cache.
  const fraction = Math.min(1, Math.max(0, count / cap));
  return { count, cap, fraction, full: count >= cap };
}

/** Players seated against the room's cap - always present, the row's primary number. */
export function playerSeats(room: RoomSummary): SeatCount {
  return seatCount(room.playerCount, room.playerCap);
}

/**
 * Spectators, when this server reports them at all. `null` means "the wire said nothing",
 * which is different from "zero watching" and must render as nothing rather than as "0".
 */
export function spectatorSeats(room: RoomSummary): SeatCount | null {
  if (room.spectatorsAllowed === false) return null;
  if (room.spectatorCount === undefined) return null;
  return seatCount(room.spectatorCount, room.spectatorCap ?? null);
}

/**
 * Why this room cannot be entered right now, in the lobby's own words - or null when it can.
 *
 * The list is NEVER the authority (the registry is a cache; the DO refuses dead rooms on
 * connect regardless of what a row claims), so this is a courtesy that saves a tap, not a
 * gate. "Playing" deliberately is NOT a reason: whether a running room takes an arrival is the
 * late-join setting's business, answered by the room itself.
 */
export function roomUnavailableReason(room: RoomSummary): string | null {
  if (room.phase === "ended") return "This game has finished";
  if (playerSeats(room).full) return "Room is full";
  return null;
}
