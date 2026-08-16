// How full a listed room is, as a lobby row needs to say it.
//
// FORWARD-COMPATIBILITY, deliberately: the room-controls work in progress
// (docs/decisions/2026-08-14-room-visibility-and-lobby.md's successor) is adding host-facing
// settings - spectator seats among them - to `roomSummarySchema` in
// packages/protocol/src/room/registry.ts. This module does not edit that schema and does not
// wait for it: it reads the new fields STRUCTURALLY and renders them only when the wire
// actually carries them. A listing from today's server produces a players-only row; a listing
// from tomorrow's produces a row with the spectator line, and no component changes in between.
//
// The cast is confined to this file on purpose. Everywhere else in the lobby UI the shapes
// below are ordinary typed values, so when the protocol grows the fields the only edit here is
// deleting the cast.
import type { RoomSummary } from "@jeopardy/protocol/room/registry";

/** The fields being added upstream. Optional here because today's wire has none of them. */
type PendingRoomSummaryFields = {
  spectatorCount?: number;
  spectatorCap?: number;
  spectatorsAllowed?: boolean;
};

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
  const pending = room as RoomSummary & PendingRoomSummaryFields;
  if (pending.spectatorsAllowed === false) return null;
  if (typeof pending.spectatorCount !== "number") return null;
  const cap = typeof pending.spectatorCap === "number" ? pending.spectatorCap : null;
  return seatCount(pending.spectatorCount, cap);
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
