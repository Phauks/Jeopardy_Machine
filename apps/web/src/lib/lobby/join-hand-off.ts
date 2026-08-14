// Where the lobby sends someone once they have picked a room, and how the password travels
// with them (docs/decisions/2026-08-14-room-visibility-and-lobby.md, "The lobby browser").
//
// ONE reconcile point on purpose: the M4 join screen replaces the destination below and
// nothing else about the lobby changes. Until it lands, a picked room opens in the room
// harness - the only surface that currently speaks the room protocol in a browser.
//
// The password NEVER rides the URL. Room links are pasted into group chats, printed onto QR
// codes, and logged by every proxy in between; a shared secret in a query string would leak
// into history, referrers, and access logs. It rides sessionStorage (per tab, cleared with
// it) and is handed to the room in the `join` message, which is the only place it belongs.
import { normalizeRoomCode } from "#lib/realtime/room-url.ts";

const passwordStorageKey = "jeopardy.room-password";

/** The destination for "join this room". M4's join screen swaps this line. */
export function joinUrlForRoom(rawCode: string): string {
  return `/dev/echo?code=${normalizeRoomCode(rawCode)}`;
}

/** Stash the room password for the next surface. No password = clear any stale one. */
export function rememberRoomPassword(rawCode: string, password: string): void {
  const code = normalizeRoomCode(rawCode);
  const storage = globalThis.sessionStorage as Storage | undefined;
  if (storage === undefined) return;
  if (password === "") {
    storage.removeItem(`${passwordStorageKey}.${code}`);
    return;
  }
  storage.setItem(`${passwordStorageKey}.${code}`, password);
}

/** What the join surface reads back. Empty string = the room needs no password (yet). */
export function recallRoomPassword(rawCode: string): string {
  const storage = globalThis.sessionStorage as Storage | undefined;
  if (storage === undefined) return "";
  try {
    return storage.getItem(`${passwordStorageKey}.${normalizeRoomCode(rawCode)}`) ?? "";
  } catch {
    // An unparseable code has no stored password by definition.
    return "";
  }
}
