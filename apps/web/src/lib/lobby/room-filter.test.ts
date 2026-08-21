// The counter's rules, tested as data (docs/decisions/2026-08-18-front-door-architecture.md).
// The front door merges the code box and the list's search box into ONE field, and the whole
// safety of that merge rests on the reading being DECIDABLE rather than guessed - so the
// decision lives here, in a pure function, instead of inside a template.
import { describe, expect, it } from "vitest";
import {
  applyRoomFilter,
  codeCharacters,
  describeCounter,
  listedRoomForCode,
  readCounter,
  roomsForCounter,
} from "#lib/lobby/room-filter.ts";
import { limits } from "@jeopardy/protocol/limits";
import type { CounterState } from "#lib/lobby/room-filter.ts";
import type { RoomSummary } from "@jeopardy/protocol/room/registry";

const fetchedAt = 1_760_000_600_000;

const openRoom: RoomSummary = {
  code: "BQKX7",
  title: "Pub quiz night",
  hostLabel: "Board Game Club",
  listing: "public",
  hasPassword: false,
  phase: "lobby",
  playerCount: 7,
  playerCap: 100,
  createdAt: fetchedAt - 60_000,
  lastSeenAt: fetchedAt,
};

const lockedRoom: RoomSummary = {
  ...openRoom,
  code: "MJ4TW",
  title: "Environment trivia",
  hostLabel: "Environmental Law Society",
  hasPassword: true,
};

function stateOf(overrides: Partial<CounterState> = {}): CounterState {
  return {
    reading: readCounter(""),
    match: null,
    shown: 2,
    total: 2,
    listingError: null,
    registryAnswering: true,
    ...overrides,
  };
}

describe("reading the field", () => {
  it("treats exactly one code's worth of letters and digits as a code", () => {
    expect(readCounter("bqkx7")).toEqual({ kind: "code", code: "BQKX7" });
    expect(readCounter("  BQKX7 ")).toEqual({ kind: "code", code: "BQKX7" });
    expect(limits.room.roomCodeLength).toBe(5);
  });

  it("treats anything shorter, longer or punctuated as a search", () => {
    expect(readCounter("BQKX")).toEqual({ kind: "search", query: "BQKX" });
    expect(readCounter("BQKX77")).toEqual({ kind: "search", query: "BQKX77" });
    // The separator is what makes this a phrase rather than a code, which is exactly the
    // ambiguity Jitsi's single field cannot resolve (docs/research/06-join-flow-patterns.md).
    expect(readCounter("pub quiz")).toEqual({ kind: "search", query: "pub quiz" });
  });

  it("has nothing to say about an empty field", () => {
    expect(readCounter("")).toEqual({ kind: "empty" });
    expect(readCounter("   ")).toEqual({ kind: "empty" });
  });

  it("normalizes the way people type off a table tent", () => {
    expect(codeCharacters(" bq-kx7 ")).toBe("BQKX7");
  });
});

describe("filtering the list", () => {
  const rooms = [openRoom, lockedRoom];

  it("keeps the listing's own order, which is the registry's newest-first", () => {
    expect(applyRoomFilter(rooms, { query: "", openOnly: false })).toEqual(rooms);
  });

  it("matches the title and the host label, case-insensitively", () => {
    expect(applyRoomFilter(rooms, { query: "quiz", openOnly: false })).toEqual([openRoom]);
    expect(applyRoomFilter(rooms, { query: "law society", openOnly: false })).toEqual([lockedRoom]);
  });

  it("matches a code the list happens to carry, without the list ever printing one", () => {
    expect(applyRoomFilter(rooms, { query: "mj4tw", openOnly: false })).toEqual([lockedRoom]);
  });

  it("drops locked rooms when open-only is on, whatever else is typed", () => {
    expect(applyRoomFilter(rooms, { query: "", openOnly: true })).toEqual([openRoom]);
    expect(applyRoomFilter(rooms, { query: "environment", openOnly: true })).toEqual([]);
  });

  it("finds the listed room a typed code names, and says null for one it cannot see", () => {
    expect(listedRoomForCode(rooms, "bqkx7")).toEqual(openRoom);
    expect(listedRoomForCode(rooms, "ZZZZZ")).toBeNull();
  });

  it("does not empty the list for a code it cannot see - that is the private case, not an error", () => {
    const shown = roomsForCounter(rooms, readCounter("ZZZZZ"), false);
    expect(shown.rooms).toEqual(rooms);
    expect(shown.filterActive).toBe(false);
  });

  it("narrows to exactly the room a listed code names", () => {
    const shown = roomsForCounter(rooms, readCounter("mj4tw"), false);
    expect(shown.rooms).toEqual([lockedRoom]);
    expect(shown.filterActive).toBe(true);
  });

  it("lets an exact code beat the open-only toggle, because a code is a stronger intent", () => {
    expect(roomsForCounter(rooms, readCounter("MJ4TW"), true).rooms).toEqual([lockedRoom]);
  });

  it("passes a search straight through to the filter", () => {
    expect(roomsForCounter(rooms, readCounter("quiz"), false)).toEqual({
      rooms: [openRoom],
      filterActive: true,
    });
    expect(roomsForCounter(rooms, readCounter(""), false)).toEqual({
      rooms,
      filterActive: false,
    });
  });
});

describe("what the counter says", () => {
  it("asks for a code, and mentions the second job, when the field is empty", () => {
    const verdict = describeCounter(stateOf());
    expect(verdict.line).toContain("5-character code");
    expect(verdict.line).toContain("search");
    expect(verdict.codeWins).toBe(false);
    expect(verdict.password).toBe("hidden");
  });

  it("treats an unlisted code as ordinary, not as an error", () => {
    const verdict = describeCounter(stateOf({ reading: readCounter("ZZZZZ") }));
    expect(verdict.line).toContain("not on the public list");
    expect(verdict.line).toContain("most rooms are private");
    expect(verdict.codeWins).toBe(true);
    // Unknowable from here, so the box is offered rather than demanded.
    expect(verdict.password).toBe("optional");
  });

  it("names a listed open room and asks for no password at all", () => {
    const verdict = describeCounter(stateOf({ reading: readCounter("BQKX7"), match: openRoom }));
    expect(verdict.line).toContain("Pub quiz night");
    expect(verdict.password).toBe("hidden");
    expect(verdict.codeWins).toBe(true);
  });

  it("demands the password for a listed locked room", () => {
    const verdict = describeCounter(stateOf({ reading: readCounter("MJ4TW"), match: lockedRoom }));
    expect(verdict.line).toContain("needs the room password");
    expect(verdict.password).toBe("required");
  });

  it("counts what a search left on screen", () => {
    const verdict = describeCounter(stateOf({ reading: readCounter("quiz"), shown: 1, total: 2 }));
    expect(verdict.line).toBe("Showing 1 of 2 public rooms.");
    expect(verdict.codeWins).toBe(false);
  });

  it("says a search found nothing without implying the code path is broken", () => {
    const verdict = describeCounter(stateOf({ reading: readCounter("banana"), shown: 0 }));
    expect(verdict.line).toContain("No public room matches");
    expect(verdict.line).toContain("join by code");
  });

  it("reports a failed listing as a warning, never as a reason not to type a code", () => {
    const verdict = describeCounter(stateOf({ listingError: "listing responded 500" }));
    expect(verdict.tone).toBe("warning");
    expect(verdict.line).toContain("A room code still works");
  });

  it("keeps the code winning even while the listing is broken", () => {
    const verdict = describeCounter(
      stateOf({ reading: readCounter("ZZZZZ"), listingError: "offline", registryAnswering: false }),
    );
    expect(verdict.codeWins).toBe(true);
    expect(verdict.line).toContain("ZZZZZ");
  });

  it("never claims a count when the registry could not answer", () => {
    const verdict = describeCounter(stateOf({ registryAnswering: false, shown: 0, total: 0 }));
    expect(verdict.line).toContain("cannot answer");
    expect(verdict.line).not.toContain("0 of 0");
  });
});
