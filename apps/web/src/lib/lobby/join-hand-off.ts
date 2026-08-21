// Where the front door sends someone once they have picked a room, and how the two secrets
// travel with them (docs/decisions/2026-08-14-room-visibility-and-lobby.md, "The lobby
// browser"; docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md for creation).
//
// The front door hands off to the M4 join screen (A2 in docs/design/user-flows.md), or - when
// this browser just CREATED the room - to the host console with the creation token. The
// harness at /dev/rooms is a developer surface and never a destination for a real player.
//
// No secret EVER rides the URL. Room links are pasted into group chats, printed onto QR codes,
// and logged by every proxy in between; a secret in a query string would leak into history,
// referrers, and access logs. Each is handed over in the message it belongs to: the host token
// in the host connection's own handshake, the session token on resume. The host token rides
// localStorage with an expiry, because a host whose tab dies must not lose the room (see
// rememberHostToken); the session token rides sessionStorage, because a seat is per-tab.
//
// A third pair lived here until 2026-08-20 - rememberRoomPassword / recallRoomPassword, the
// shared room secret stashed beside the code so a join screen reached from the lobby could
// offer it without asking twice. Rooms have no password now (@jeopardy/protocol
// room/visibility.ts); the code IS the secret, and it travels in the URL by design.
import { limits } from "@jeopardy/protocol/limits";
import { normalizeRoomCode } from "#lib/realtime/room-url.ts";

const hostTokenStorageKey = "jeopardy.host-token";
const sessionTokenStorageKey = "jeopardy.session-token";

/** The destination for "join this room": the player join screen. */
export function joinUrlForRoom(rawCode: string): string {
  return `/room/${normalizeRoomCode(rawCode)}`;
}

/** The destination for "you made this room": the host console. */
export function hostUrlForRoom(rawCode: string): string {
  return `/room/${normalizeRoomCode(rawCode)}/host`;
}

/**
 * Stash the creation token for the host console the front door is about to navigate to.
 *
 * This is the room's STRONGEST secret - it closes the room and edits its settings - so the
 * storage choice is deliberate rather than convenient. The token never rides a URL: the page a
 * host puts on a projector is exactly the page whose address gets photographed, and that is the
 * failure this file exists to avoid.
 *
 * REVERSED 2026-08-19: localStorage, not sessionStorage, with an expiry stamped on the record.
 *
 * The old note argued that anything longer-lived "would be storing a credential for a thing
 * that will not exist by the time anyone reads it - and would be the first step toward the
 * accounts this product does not have". The first half is answered by writing the expiry down
 * (below) rather than by throwing the token away sooner than the room. The second half was
 * simply wrong about the risk it was weighing, because of what per-tab storage costs: a host
 * whose TAB dies - a crashed browser, a laptop asleep too long, a closed window at the worst
 * moment - lost the room. Not their console: the room. Nobody else could ever host it, the
 * players stayed connected to a game with no driver, and the console's own honest screen told
 * them to go and make a new one. That is M6's "resume a crashed game", and it was one storage
 * call wide.
 *
 * It is still nothing like an account. The record is scoped to one room code, it lives only in
 * the browser that created that room, it names its own death, and it is swept on the next read
 * after it. Rooms expire in hours (`limits.room.idleExpiryMs`); so does this.
 */
type StoredHostToken = { token: string; expiresAt: number };

/** How long a stored host token stays useful: the room's own idle life, plus a little slack. */
const hostTokenTtlMs = limits.room.idleExpiryMs + 60 * 60 * 1000;

function hostTokenStorage(): Storage | undefined {
  return globalThis.localStorage as Storage | undefined;
}

export function rememberHostToken(rawCode: string, hostToken: string, now = Date.now()): void {
  const code = normalizeRoomCode(rawCode);
  const storage = hostTokenStorage();
  if (storage === undefined) return;
  try {
    if (hostToken === "") {
      storage.removeItem(`${hostTokenStorageKey}.${code}`);
      return;
    }
    const record: StoredHostToken = { token: hostToken, expiresAt: now + hostTokenTtlMs };
    storage.setItem(`${hostTokenStorageKey}.${code}`, JSON.stringify(record));
  } catch {
    // No storage = the host console will have to be handed the token another way; it is not
    // worth failing a room creation over.
  }
}

/**
 * What the host console reads back. Empty string = this browser did not create this room, or
 * the room it created is long gone.
 *
 * An expired record is DELETED on the way past rather than merely ignored, so a browser that
 * hosts a quiz a month never accumulates a drawer of dead credentials.
 */
export function recallHostToken(rawCode: string, now = Date.now()): string {
  const storage = hostTokenStorage();
  if (storage === undefined) return "";
  let key: string;
  let raw: string | null;
  try {
    key = `${hostTokenStorageKey}.${normalizeRoomCode(rawCode)}`;
    raw = storage.getItem(key);
  } catch {
    // An unparseable code has no stored token by definition, and there is no key to clean up.
    return "";
  }
  if (raw === null) return "";

  // Anything unreadable is treated as absent AND removed - including a record that fails to
  // parse at all. A malformed record can only come from a version of this app that no longer
  // exists (the no-legacy directive), so there is nothing to preserve and no reason to leave a
  // dead key behind. The removal has to sit outside the parse's own catch, or the throw skips
  // exactly the cleanup this promises.
  let record: Partial<StoredHostToken> | null = null;
  try {
    record = JSON.parse(raw) as Partial<StoredHostToken>;
  } catch {
    record = null;
  }
  const usable =
    record !== null && typeof record.token === "string" && typeof record.expiresAt === "number";
  if (!usable || (record?.expiresAt ?? 0) <= now) {
    try {
      storage.removeItem(key);
    } catch {
      // A storage that refuses writes still answered the read; the caller gets "" either way.
    }
    return "";
  }
  return record?.token ?? "";
}

/**
 * The player's resume credential, minted by the room on join and handed back on reconnect
 * (user-flows A5: "the phone reconnects and lands on the same screen it left").
 *
 * sessionStorage for the same reasons as the two secrets above, plus one of its own: a seat is
 * a per-TAB thing. Two tabs on one phone are two players as far as the room is concerned, and
 * localStorage would quietly make them fight over one seat. Empty string clears it - which is
 * what a room does when it tells this device the token is no longer a seat.
 */
export function rememberSessionToken(rawCode: string, sessionToken: string): void {
  const code = normalizeRoomCode(rawCode);
  const storage = globalThis.sessionStorage as Storage | undefined;
  if (storage === undefined) return;
  try {
    if (sessionToken === "") {
      storage.removeItem(`${sessionTokenStorageKey}.${code}`);
      return;
    }
    storage.setItem(`${sessionTokenStorageKey}.${code}`, sessionToken);
  } catch {
    // No storage = no resume; the phone joins again as a new seat, which still works.
  }
}

/** What the play surface offers the room on connect. Empty string = this tab has no seat. */
export function recallSessionToken(rawCode: string): string {
  const storage = globalThis.sessionStorage as Storage | undefined;
  if (storage === undefined) return "";
  try {
    return storage.getItem(`${sessionTokenStorageKey}.${normalizeRoomCode(rawCode)}`) ?? "";
  } catch {
    return "";
  }
}
