// The model behind the harness's "rooms this tab created" panel. Written directly against
// the owner's 2026-08-14 report - "creating a room deletes a previously created room" and "I
// cannot tell if the rooms are actually created" - because both complaints were about this
// list not existing, not about anything the server did.
import { describe, expect, it } from "vitest";
import {
  describeLobbyPresence,
  forgetSessionRoom,
  formatCountdown,
  lobbyPresence,
  markSessionRoomClosed,
  rememberSessionRoom,
  sessionRoomsMax,
} from "./session-rooms.ts";
import type { SessionRoom } from "./session-rooms.ts";
import type { LobbyListing } from "@jeopardy/protocol/room/registry";

function room(code: string, overrides: Partial<SessionRoom> = {}): SessionRoom {
  return {
    code,
    title: `Room ${code}`,
    hostLabel: "Harness",
    visibility: "public",
    hasPassword: false,
    hostToken: "0".repeat(32),
    password: "",
    createdAt: 1_760_000_000_000,
    expiresAt: 1_760_007_200_000,
    registry: { status: "ok" },
    closedAt: null,
    ...overrides,
  };
}

function listing(codes: string[], registry: LobbyListing["registry"] = { status: "ok" }) {
  return {
    fetchedAt: 1_760_000_100_000,
    registry,
    rooms: codes.map((code) => ({
      code,
      title: `Room ${code}`,
      hostLabel: "",
      visibility: "public" as const,
      hasPassword: false,
      phase: "lobby" as const,
      playerCount: 0,
      playerCap: 100,
      createdAt: 1_760_000_000_000,
      lastSeenAt: 1_760_000_000_000,
    })),
  };
}

describe("remembering rooms this tab created", () => {
  it("ADDS - the second create never evicts the first (the reported bug)", () => {
    const rooms = rememberSessionRoom(rememberSessionRoom([], room("AAAAA")), room("BBBBB"));
    expect(rooms.map((entry) => entry.code)).toEqual(["BBBBB", "AAAAA"]);
  });

  it("replaces only a row for the SAME code (an expired code can be drawn again)", () => {
    const rooms = rememberSessionRoom(
      rememberSessionRoom([], room("AAAAA", { title: "first" })),
      room("AAAAA", { title: "second" }),
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.title).toBe("second");
  });

  it("bounds the list so a stuck loop cannot grow it forever", () => {
    let rooms: SessionRoom[] = [];
    for (let index = 0; index < sessionRoomsMax + 10; index += 1) {
      rooms = rememberSessionRoom(rooms, room(`C${String(index).padStart(4, "0")}`.slice(0, 5)));
    }
    expect(rooms).toHaveLength(sessionRoomsMax);
  });

  it("forgets a row and marks a room closed without losing the rest", () => {
    const rooms = rememberSessionRoom(rememberSessionRoom([], room("AAAAA")), room("BBBBB"));
    expect(forgetSessionRoom(rooms, "AAAAA").map((entry) => entry.code)).toEqual(["BBBBB"]);
    const closed = markSessionRoomClosed(rooms, "BBBBB", 1_760_000_500_000);
    expect(closed.find((entry) => entry.code === "BBBBB")?.closedAt).toBe(1_760_000_500_000);
    expect(closed.find((entry) => entry.code === "AAAAA")?.closedAt).toBeNull();
  });
});

describe("is this room actually in the lobby?", () => {
  it("says listed when the lobby has it and MISSING when it does not", () => {
    expect(lobbyPresence(room("AAAAA"), listing(["AAAAA"]))).toBe("listed");
    // Public, live, registry healthy, absent from the list: the shape of a real bug.
    expect(lobbyPresence(room("AAAAA"), listing(["BBBBB"]))).toBe("missing");
  });

  it("never calls an unlisted room missing - it has no row by design", () => {
    expect(lobbyPresence(room("AAAAA", { visibility: "unlisted" }), listing([]))).toBe(
      "unlisted-by-design",
    );
  });

  it("blames the registry, not the room, when the registry cannot answer", () => {
    const brokenCreate = room("AAAAA", {
      registry: { status: "unavailable", reason: "no-table" },
    });
    expect(lobbyPresence(brokenCreate, listing(["AAAAA"]))).toBe("registry-down");
    expect(
      lobbyPresence(room("AAAAA"), listing([], { status: "unavailable", reason: "no-table" })),
    ).toBe("registry-down");
  });

  it("withholds judgement before any listing has been fetched, and after a close", () => {
    expect(lobbyPresence(room("AAAAA"), null)).toBe("unknown");
    expect(lobbyPresence(room("AAAAA", { closedAt: 1 }), listing([]))).toBe("closed");
  });

  it("has a phrase for each presence, and only the bug shape shouts", () => {
    expect(describeLobbyPresence("missing")).toBe("NOT in lobby");
    expect(describeLobbyPresence("listed")).toBe("in lobby");
    expect(describeLobbyPresence("unknown")).toBe("lobby not checked");
  });
});

describe("the expiry countdown", () => {
  it("reads coarsely, the way a room's shifting deadline deserves", () => {
    expect(formatCountdown(2 * 60 * 60 * 1000)).toBe("2h 0m");
    expect(formatCountdown(45 * 60 * 1000 + 30_000)).toBe("45m");
    expect(formatCountdown(45_000)).toBe("45s");
    expect(formatCountdown(0)).toBe("expired");
    expect(formatCountdown(-5000)).toBe("expired");
  });
});
