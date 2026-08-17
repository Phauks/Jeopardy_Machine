// Where the front door sends someone once they have picked a room, and how the two secrets
// travel with them (docs/decisions/2026-08-14-room-visibility-and-lobby.md, "The lobby
// browser"; docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md for creation).
//
// The front door hands off to the M4 join screen (A2 in docs/design/user-flows.md), or - when
// this browser just CREATED the room - to the host console with the creation token. The
// harness at /dev/rooms is a developer surface and never a destination for a real player.
//
// Neither secret EVER rides the URL. Room links are pasted into group chats, printed onto QR
// codes, and logged by every proxy in between; a secret in a query string would leak into
// history, referrers, and access logs. Both ride sessionStorage (per tab, cleared with it) and
// are handed over in the messages they belong to: the password in `join`, the host token in
// the host connection's own handshake.
import { normalizeRoomCode } from "#lib/realtime/room-url.ts";

const passwordStorageKey = "jeopardy.room-password";
const hostTokenStorageKey = "jeopardy.host-token";

/** The destination for "join this room": the player join screen. */
export function joinUrlForRoom(rawCode: string): string {
  return `/room/${normalizeRoomCode(rawCode)}`;
}

/** The destination for "you made this room": the host console. */
export function hostUrlForRoom(rawCode: string): string {
  return `/room/${normalizeRoomCode(rawCode)}/host`;
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

/**
 * Stash the creation token for the host console the front door is about to navigate to.
 *
 * This is the room's STRONGEST secret - it closes the room and edits its settings - so the
 * storage choice is deliberate rather than convenient. sessionStorage is per tab and dies with
 * it; the token is worthless within hours (a room expires); and the alternative, a token in
 * the URL of the page a host puts on a projector, is the failure this file exists to avoid.
 * Anything longer-lived (localStorage, a cookie) would be storing a credential for a thing
 * that will not exist by the time anyone reads it - and would be the first step toward the
 * accounts this product does not have.
 */
export function rememberHostToken(rawCode: string, hostToken: string): void {
  const code = normalizeRoomCode(rawCode);
  const storage = globalThis.sessionStorage as Storage | undefined;
  if (storage === undefined) return;
  try {
    if (hostToken === "") {
      storage.removeItem(`${hostTokenStorageKey}.${code}`);
      return;
    }
    storage.setItem(`${hostTokenStorageKey}.${code}`, hostToken);
  } catch {
    // No storage = the host console will have to be handed the token another way; it is not
    // worth failing a room creation over.
  }
}

/** What the host console reads back. Empty string = this tab did not create this room. */
export function recallHostToken(rawCode: string): string {
  const storage = globalThis.sessionStorage as Storage | undefined;
  if (storage === undefined) return "";
  try {
    return storage.getItem(`${hostTokenStorageKey}.${normalizeRoomCode(rawCode)}`) ?? "";
  } catch {
    return "";
  }
}
