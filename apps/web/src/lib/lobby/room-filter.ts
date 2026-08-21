// What the front door's ONE field means, as data rather than as template conditionals.
//
// The counter (docs/decisions/2026-08-18-front-door-architecture.md) merges the code box and
// the list's search box into a single control, which is only safe because a room code is
// DECIDABLE: exactly `limits.room.roomCodeLength` characters of [A-Z0-9] is a code, anything
// else is a search. That is the property Jitsi's "type a name to join or create" lacks, and
// the reason its field has to guess where ours does not (docs/research/06-join-flow-patterns.md).
//
// Everything here is pure: reading the field, filtering the list, and the sentence the counter
// says about the current state. The screen renders the answers and owns none of the rules.
import { limits } from "@jeopardy/protocol/limits";
import type { RoomSummary } from "@jeopardy/protocol/room/registry";

/** What is in the field, once. A code reading never depends on the list - a private room is
 * joinable by a code the list has never heard of, which is the common case. */
export type CounterReading =
  | { kind: "empty" }
  | { kind: "search"; query: string }
  | { kind: "code"; code: string };

/** Strip everything a room code cannot contain. Lowercase and spaces are what people type off
 * a table tent, so they are normalized away rather than refused. */
export function codeCharacters(raw: string): string {
  return raw.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

export function readCounter(raw: string): CounterReading {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  const code = codeCharacters(trimmed);
  // A five-character word IS read as a code, deliberately: the field is code-first, the cost
  // is that a five-letter search also arms Join, and the list stays filtered underneath so the
  // person searching still sees their results (docs/research/06-join-flow-patterns.md, "what
  // applies to us"). Auto-submitting here would turn that collision into a navigation, which
  // is why the person still has to press Join.
  if (code.length === limits.room.roomCodeLength && code === trimmed.toUpperCase()) {
    return { kind: "code", code };
  }
  return { kind: "search", query: trimmed };
}

export type RoomFilter = {
  /** Raw field text. Filters titles, host labels and codes alike. */
  query: string;
};

/**
 * The rooms a filter leaves on screen, in the listing's own order (newest first, decided by
 * the registry query - a browse list that re-sorts under your finger is worse than an unsorted
 * one).
 */
export function applyRoomFilter(
  rooms: readonly RoomSummary[],
  filter: RoomFilter,
): readonly RoomSummary[] {
  const needle = filter.query.trim().toLowerCase();
  const codeNeedle = codeCharacters(filter.query);
  return rooms.filter((room) => {
    if (needle === "") return true;
    if (room.title.toLowerCase().includes(needle)) return true;
    if (room.hostLabel.toLowerCase().includes(needle)) return true;
    // Codes are matched but never RENDERED by the list (room-browser.svelte): a browsable list
    // is not a code directory, yet someone typing the code they were given should still see
    // the room it names when that room happens to be listed.
    return codeNeedle !== "" && room.code.includes(codeNeedle);
  });
}

/** The listed room a typed code names, when the list can see one. Null covers both "no such
 * public room" (the ordinary private case) and "the registry could not answer". */
export function listedRoomForCode(rooms: readonly RoomSummary[], code: string): RoomSummary | null {
  return rooms.find((room) => room.code === codeCharacters(code)) ?? null;
}

/**
 * What the list shows for a given field, and whether anything is narrowing it.
 *
 * The rule that is not obvious: a COMPLETE code the list cannot see does NOT filter the list
 * to nothing. Most rooms are private, so an unlisted code is the ordinary case, and answering
 * it with an empty list reads as "your code is wrong" when the truth is "that room was never
 * listed". The list steps back (dimmed) with everything still on it; the counter's own
 * sentence carries the news. A code the list CAN see filters to exactly that room, which is
 * the exact match becoming the thing on screen.
 */
export function roomsForCounter(
  rooms: readonly RoomSummary[],
  reading: CounterReading,
): { rooms: readonly RoomSummary[]; filterActive: boolean } {
  if (reading.kind === "code") {
    const match = listedRoomForCode(rooms, reading.code);
    if (match !== null) return { rooms: [match], filterActive: true };
    return { rooms, filterActive: false };
  }
  const query = reading.kind === "search" ? reading.query : "";
  return { rooms: applyRoomFilter(rooms, { query }), filterActive: query !== "" };
}

export type CounterVerdict = {
  line: string;
  /** True when the typed code is what happens next, so the list steps back. */
  codeWins: boolean;
  tone: "hint" | "code" | "warning";
};

export type CounterState = {
  reading: CounterReading;
  /** The listed room the code names, if any. */
  match: RoomSummary | null;
  /** Rooms the filter leaves visible, and rooms the listing holds. */
  shown: number;
  total: number;
  /** The listing fetch failed outright. Never fatal - a code still works. */
  listingError: string | null;
  /** False when the registry itself could not answer; the list region says why. */
  registryAnswering: boolean;
};

/**
 * One sentence for every state of the counter.
 *
 * It also decided whether a password box came with it until 2026-08-20, when passwords were
 * removed outright (@jeopardy/protocol room/visibility.ts): the code is what admits people, so
 * a code that names a room is the whole story and there is no second thing to ask for.
 */
export function describeCounter(state: CounterState): CounterVerdict {
  const { reading } = state;
  if (reading.kind === "code") {
    const match = state.match;
    if (match === null) {
      return {
        line: `${reading.code} is not on the public list - that is normal, most rooms are private.`,
        codeWins: true,
        tone: "code",
      };
    }
    return {
      line: `${reading.code} is ${match.title}.`,
      codeWins: true,
      tone: "code",
    };
  }

  if (state.listingError !== null) {
    return {
      line: `The public list is unavailable right now (${state.listingError}). A room code still works.`,
      codeWins: false,
      tone: "warning",
    };
  }

  if (reading.kind === "search") {
    if (state.shown === 0) {
      return {
        line: `No public room matches "${reading.query}". A room code is not a search - type all ${String(limits.room.roomCodeLength)} characters to join by code.`,
        codeWins: false,
        tone: "hint",
      };
    }
    return {
      line: `Showing ${String(state.shown)} of ${String(state.total)} public rooms.`,
      codeWins: false,
      tone: "hint",
    };
  }

  if (!state.registryAnswering) {
    return {
      line: "The public list cannot answer right now. A room code still works.",
      codeWins: false,
      tone: "warning",
    };
  }

  return {
    line: `Type the ${String(limits.room.roomCodeLength)}-character code from the big screen, or search what is on below.`,
    codeWins: false,
    tone: "hint",
  };
}
