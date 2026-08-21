// Every room THIS TAB created, and what became of it.
//
// Straight from an owner report (2026-08-14): "creating a room deletes a previously created
// room. I cannot tell if the rooms are actually created." The rooms were fine - the harness
// kept a single `createdRoom` slot and each create overwrote it, so the previous room
// vanished from the screen while living on in D1 and in its DO. The fix is this list, and the
// rule it encodes: a create ADDS, never replaces.
//
// It also answers the other half of that report. A room whose code is right there on screen
// but absent from the lobby listing is the visible form of "my public room never appeared" -
// so lobbyPresence() compares the two and names the discrepancy rather than leaving a gap.
//
// In-memory only, per tab: the host token is the room's strongest secret and a room lives at
// most a couple of hours, so persisting either would be storing a credential for a thing that
// will not exist by the time anyone reads it.
import type { LobbyListing, RegistryStatus } from "@jeopardy/protocol/room/registry";
import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";

export type SessionRoom = {
  code: string;
  // The room's live settings as this tab last saw them: the create echo, then whatever a
  // settings edit answered with. Title, listing and the entry axis all live here rather than
  // as loose fields, so a row can never show a listing the server has already changed.
  settings: RoomSettings;
  // The creation token: the harness's proof for joining as host, inspecting, and closing.
  hostToken: string;
  createdAt: number;
  expiresAt: number;
  // Whether the CREATE's registry write landed - "created; NOT listed because the registry
  // table is missing" is a sentence this row can say on its own.
  registry: RegistryStatus;
  // Set when this tab closed the room (or saw it closed); the row stays visible as history.
  closedAt: number | null;
};

// Enough to hold an evening of experiments without letting a stuck loop grow unbounded.
export const sessionRoomsMax = 25;

/** A create ADDS to the list. Same code twice (a reused expired code) replaces its own row. */
export function rememberSessionRoom(rooms: SessionRoom[], room: SessionRoom): SessionRoom[] {
  return [room, ...rooms.filter((existing) => existing.code !== room.code)].slice(
    0,
    sessionRoomsMax,
  );
}

/**
 * A settings edit landed: the row adopts the SERVER's answer, never what was typed into the
 * form - a cap the room refused to lower must not appear to have moved. This
 * tab's own copy of the shared secret (empty string = the room is open now), kept only so the
 * join field stays one click rather than a retype.
 */
export function updateSessionRoomSettings(
  rooms: SessionRoom[],
  code: string,
  change: { settings: RoomSettings },
): SessionRoom[] {
  return rooms.map((room) =>
    room.code === code
      ? {
          ...room,
          settings: change.settings,
        }
      : room,
  );
}

/** Drop a row from the panel. Deleting the ROOM is a separate act (DELETE /api/rooms/CODE). */
export function forgetSessionRoom(rooms: SessionRoom[], code: string): SessionRoom[] {
  return rooms.filter((room) => room.code !== code);
}

export function markSessionRoomClosed(
  rooms: SessionRoom[],
  code: string,
  at: number,
): SessionRoom[] {
  return rooms.map((room) => (room.code === code ? { ...room, closedAt: at } : room));
}

/**
 * Countdown to the room's idle-expiry deadline, coarse on purpose: "1h 58m", "45s", "expired".
 * The deadline moves every time the room sees activity, so precision here would be a lie.
 */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "expired";
  const totalMinutes = Math.floor(msRemaining / 60_000);
  if (totalMinutes < 1) return `${String(Math.floor(msRemaining / 1000))}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${String(minutes)}m` : `${String(hours)}h ${String(minutes)}m`;
}

// Where a session room stands relative to the public lobby. The whole point is that "not in
// the list" has several causes and only one of them is a bug.
export type LobbyPresence =
  | "closed" // this tab closed the room; absence is correct
  | "private-by-design" // a private room is never listed, however healthy the registry
  | "registry-down" // the lobby cannot answer, so absence proves nothing
  | "unknown" // no listing fetched yet
  | "listed" // found in the lobby, as it should be
  | "missing"; // public, live, registry healthy - and absent. THE bug shape.

export function lobbyPresence(room: SessionRoom, listing: LobbyListing | null): LobbyPresence {
  if (room.closedAt !== null) return "closed";
  if (room.settings.listing === "private") return "private-by-design";
  // A create whose registry write failed is already known-missing; no listing can absolve it.
  if (room.registry.status !== "ok") return "registry-down";
  if (listing === null) return "unknown";
  if (listing.registry.status !== "ok") return "registry-down";
  return listing.rooms.some((listed) => listed.code === room.code) ? "listed" : "missing";
}

/** Short label for the presence chip, in the harness's own voice. */
export function describeLobbyPresence(presence: LobbyPresence): string {
  if (presence === "listed") return "in lobby";
  if (presence === "missing") return "NOT in lobby";
  if (presence === "private-by-design") return "private (never listed)";
  if (presence === "registry-down") return "registry unavailable";
  if (presence === "closed") return "closed";
  return "lobby not checked";
}
