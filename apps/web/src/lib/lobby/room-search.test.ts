// Searching the public list (owner request 2026-08-17: "public rooms must be searchable").
// Pure, so the behaviour that matters - what narrows, what does not, and what a query can
// never do - is asserted without a DOM. The wiring is asserted in room-browser.states.test.ts.
import { describe, expect, it } from "vitest";
import { filterRooms, roomMatchesTerms, searchTerms } from "#lib/lobby/room-search.ts";
import type { RoomSummary } from "@jeopardy/protocol/room/registry";

const fetchedAt = 1_760_000_600_000;

function roomOf(overrides: Partial<RoomSummary>): RoomSummary {
  return {
    code: "PQZ21",
    title: "Pub quiz night",
    hostLabel: "Board Game Club",
    listing: "public",
    hasPassword: false,
    phase: "lobby",
    playerCount: 3,
    playerCap: 100,
    createdAt: fetchedAt - 60_000,
    lastSeenAt: fetchedAt,
    ...overrides,
  };
}

const rooms: RoomSummary[] = [
  roomOf({}),
  roomOf({ code: "MJ4TW", title: "Environment trivia", hostLabel: "Law Society" }),
  roomOf({ code: "TTK93", title: "Film night", hostLabel: "" }),
];

describe("search terms", () => {
  it("lowercases and splits, and treats whitespace-only as no query at all", () => {
    expect(searchTerms("Pub Quiz")).toEqual(["pub", "quiz"]);
    expect(searchTerms("  spaced   out  ")).toEqual(["spaced", "out"]);
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms("")).toEqual([]);
  });
});

describe("matching one room", () => {
  it("finds a room by what the game is called", () => {
    expect(roomMatchesTerms(rooms[0]!, ["quiz"])).toBe(true);
  });

  it("finds a room by who is running it - the reason both facts share one haystack", () => {
    expect(roomMatchesTerms(rooms[0]!, ["board", "club"])).toBe(true);
  });

  it("narrows with every added term rather than widening", () => {
    expect(roomMatchesTerms(rooms[0]!, ["pub"])).toBe(true);
    expect(roomMatchesTerms(rooms[0]!, ["pub", "trivia"])).toBe(false);
  });

  it("matches case-insensitively, because nobody types a room's capitalisation", () => {
    // Through searchTerms, which is the only way a query reaches this function: the terms
    // arrive already lowercased, so the per-room work is one lowercase, not two.
    expect(roomMatchesTerms(rooms[1]!, searchTerms("ENVIRONMENT"))).toBe(true);
    expect(roomMatchesTerms(rooms[1]!, searchTerms("Law Society"))).toBe(true);
    expect(filterRooms(rooms, "LAW")).toHaveLength(1);
  });

  it("keeps every room when there is no query - an empty box is not a filter", () => {
    expect(roomMatchesTerms(rooms[2]!, [])).toBe(true);
  });

  it("never matches on the room CODE - the code box is the thing that takes codes", () => {
    expect(roomMatchesTerms(rooms[0]!, ["pqz21"])).toBe(false);
  });
});

describe("filtering the list", () => {
  it("returns everything for an empty or whitespace query", () => {
    expect(filterRooms(rooms, "")).toHaveLength(3);
    expect(filterRooms(rooms, "   ")).toHaveLength(3);
  });

  it("keeps the server's order (newest first) among whatever survives", () => {
    const found = filterRooms(rooms, "i");
    expect(found.map((room) => room.code)).toEqual(["PQZ21", "MJ4TW", "TTK93"]);
  });

  it("answers with nothing rather than with everything when a query matches no room", () => {
    expect(filterRooms(rooms, "quidditch")).toEqual([]);
  });

  it("copes with a room whose host never said who they are", () => {
    expect(filterRooms(rooms, "film").map((room) => room.code)).toEqual(["TTK93"]);
  });
});
