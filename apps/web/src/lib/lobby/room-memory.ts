// Which rooms THIS BROWSER has walked into, so the front door can offer to walk back in
// (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Rejoin memory").
//
// The boundary this lives inside (guiding principle 3, players never log in): this is a
// per-tab note-to-self, not an identity. It is sessionStorage, so it dies with the tab; it
// holds no token, no player id and no password (join-hand-off.ts owns the two secrets, under
// their own keys, for exactly one hop); and nothing is ever sent to a server from it except
// the room code the browser was already using. There is nothing here to sign in to and
// nothing here worth stealing - which is the test any future addition has to pass.
//
// Liveness is NOT stored. A remembered room is a claim about the past; whether it still exists
// is asked fresh every time (room-liveness.ts), because a room that ended during the coffee
// break must not be advertised on the front page.
//
// Pure list functions + a thin storage layer, in that order, so the interesting behavior is
// testable without a DOM.

/** One remembered arrival. `title` is "" when this browser never learned one (joined by code). */
export type RememberedRoom = {
  code: string;
  title: string;
  /** Which door this browser came through - the rejoin offer leads back to the same surface. */
  role: "player" | "host";
  /** Unix ms of the last arrival, for newest-first ordering. */
  at: number;
};

const storageKey = "jeopardy.rooms";

/**
 * How many arrivals a tab keeps. A quiz night is one or two rooms; a host testing a setup
 * might make five. Beyond that the list stops being a memory and starts being a history, which
 * is a different (and unwanted) product.
 */
export const rememberedRoomsMax = 6;

/** Newest first, one row per code. Re-entering a room moves it to the front, never duplicates it. */
export function rememberRoomIn(
  rooms: readonly RememberedRoom[],
  room: RememberedRoom,
): RememberedRoom[] {
  return [room, ...rooms.filter((existing) => existing.code !== room.code)].slice(
    0,
    rememberedRoomsMax,
  );
}

export function forgetRoomIn(rooms: readonly RememberedRoom[], code: string): RememberedRoom[] {
  return rooms.filter((room) => room.code !== code);
}

/**
 * Tolerant by design: this parses a string another version of this app wrote. A junk entry is
 * dropped silently rather than throwing, because the failure mode of a strict parse here is a
 * front door that cannot render - a far worse outcome than a forgotten room.
 */
export function parseRememberedRooms(raw: string | null): RememberedRoom[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is RememberedRoom => isRememberedRoom(entry))
    .map((entry) => ({
      code: entry.code,
      title: entry.title,
      role: entry.role,
      at: entry.at,
    }))
    .toSorted((left, right) => right.at - left.at)
    .slice(0, rememberedRoomsMax);
}

function isRememberedRoom(entry: unknown): entry is RememberedRoom {
  if (typeof entry !== "object" || entry === null) return false;
  const candidate = entry as Partial<RememberedRoom>;
  return (
    typeof candidate.code === "string" &&
    candidate.code !== "" &&
    typeof candidate.title === "string" &&
    (candidate.role === "player" || candidate.role === "host") &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at)
  );
}

// ---- storage (SSR-safe: every reader answers "nothing remembered" without a window) --------

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage as Storage | undefined;
  } catch {
    // Storage disabled by policy (private mode, embedded webview). No memory, no error.
    return undefined;
  }
}

export function readRememberedRooms(): RememberedRoom[] {
  const store = storage();
  if (store === undefined) return [];
  try {
    return parseRememberedRooms(store.getItem(storageKey));
  } catch {
    return [];
  }
}

export function writeRememberedRooms(rooms: readonly RememberedRoom[]): void {
  const store = storage();
  if (store === undefined) return;
  try {
    if (rooms.length === 0) {
      store.removeItem(storageKey);
      return;
    }
    store.setItem(storageKey, JSON.stringify(rooms));
  } catch {
    // A full or refused storage quota costs a rejoin offer and nothing else.
  }
}

/** Record an arrival. Called by the surface that sends someone INTO a room, not by the room. */
export function rememberRoom(room: RememberedRoom): void {
  writeRememberedRooms(rememberRoomIn(readRememberedRooms(), room));
}

/** Drop one, silently - what a dead room's rejoin offer does to itself. */
export function forgetRoom(code: string): void {
  writeRememberedRooms(forgetRoomIn(readRememberedRooms(), code));
}
