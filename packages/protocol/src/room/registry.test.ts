// The lobby projection contract (docs/decisions/2026-08-14-room-visibility-and-lobby.md).
// What matters here is what the shape REFUSES: anything that would turn a browse surface
// into an oracle or a directory of people.
import { describe, expect, it } from "vitest";
import { limits } from "../limits.ts";
import { lobbyListingSchema, registryStatusSchema, roomSummarySchema } from "./registry.ts";

const ok = { status: "ok" } as const;

const summary = {
  code: "BQKX7",
  title: "Pub quiz night",
  hostLabel: "Board Game Club",
  visibility: "public",
  hasPassword: true,
  phase: "lobby",
  playerCount: 7,
  playerCap: limits.room.playerSoftCap,
  createdAt: 1_760_000_000_000,
  lastSeenAt: 1_760_000_060_000,
};

describe("room summary (the lobby row)", () => {
  it("parses a full public row, lock included", () => {
    expect(roomSummarySchema.parse(summary)).toEqual(summary);
  });

  it("allows an unnamed host (no byline) but never an unnamed room", () => {
    expect(roomSummarySchema.safeParse({ ...summary, hostLabel: "" }).success).toBe(true);
    expect(roomSummarySchema.safeParse({ ...summary, title: "" }).success).toBe(false);
  });

  it("never carries the password itself, a hash, or any player identity", () => {
    for (const leak of [
      { password: "hunter2!" },
      { passwordHash: "a".repeat(64) },
      { players: ["Lorax"] },
      { hostToken: "0".repeat(32) },
    ]) {
      expect(roomSummarySchema.safeParse({ ...summary, ...leak }).success).toBe(false);
    }
  });

  it("holds the room-code shape and the room phase vocabulary", () => {
    expect(roomSummarySchema.safeParse({ ...summary, code: "bqkx7" }).success).toBe(false);
    expect(roomSummarySchema.safeParse({ ...summary, phase: "playing" }).success).toBe(false);
    expect(roomSummarySchema.safeParse({ ...summary, phase: "active" }).success).toBe(true);
  });
});

describe("lobby listing", () => {
  it("caps a listing at the operational limit (pagination is deliberately deferred)", () => {
    const rooms = Array.from({ length: limits.lobby.listingMax }, (_unused, index) => ({
      ...summary,
      code: `T${String(index).padStart(4, "0")}`.slice(0, limits.room.roomCodeLength),
    }));
    expect(
      lobbyListingSchema.safeParse({ rooms, fetchedAt: Date.now(), registry: ok }).success,
    ).toBe(true);
    expect(
      lobbyListingSchema.safeParse({
        rooms: [...rooms, summary],
        fetchedAt: Date.now(),
        registry: ok,
      }).success,
    ).toBe(false);
  });

  it("parses an empty lobby (the common case on a quiet night)", () => {
    expect(lobbyListingSchema.parse({ rooms: [], fetchedAt: 1, registry: ok })).toEqual({
      rooms: [],
      fetchedAt: 1,
      registry: ok,
    });
  });

  it("REQUIRES a registry status - an empty list must always say why it is empty", () => {
    // The owner-reported bug in schema form: before this field, "the migration is missing"
    // and "nobody is hosting tonight" were the same response body.
    expect(lobbyListingSchema.safeParse({ rooms: [], fetchedAt: 1 }).success).toBe(false);
  });
});

describe("registry status", () => {
  it("separates a working-but-quiet registry from a broken one", () => {
    expect(registryStatusSchema.parse(ok)).toEqual(ok);
    expect(
      registryStatusSchema.parse({
        status: "unavailable",
        reason: "no-table",
        detail: "D1_ERROR: no such table: rooms",
      }),
    ).toMatchObject({ reason: "no-table" });
  });

  it("names only the three reasons a caller can act on, and never carries rows when broken", () => {
    expect(registryStatusSchema.safeParse({ status: "unavailable", reason: "oops" }).success).toBe(
      false,
    );
    expect(registryStatusSchema.safeParse({ status: "ok", reason: "no-table" }).success).toBe(
      false,
    );
  });
});
