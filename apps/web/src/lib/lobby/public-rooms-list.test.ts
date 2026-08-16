// Server-render test of the lobby list (same approach as board-display.test.ts: SSR through
// svelte/server, no browser mode - docs/DEVELOPMENT.md). What matters here is what a stranger
// can see: room facts yes, secrets never.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import PublicRoomsList from "#lib/lobby/public-rooms-list.svelte";
import { formatRoomAge, formatRoomPhase } from "#lib/lobby/room-age.ts";
import type { RoomSummary } from "@jeopardy/protocol/room/registry";

const fetchedAt = 1_760_000_600_000;

const rooms: RoomSummary[] = [
  {
    code: "BQKX7",
    title: "Pub quiz night",
    hostLabel: "Board Game Club",
    listing: "public",
    hasPassword: true,
    phase: "lobby",
    playerCount: 7,
    playerCap: 100,
    createdAt: fetchedAt - 12 * 60_000,
    lastSeenAt: fetchedAt,
  },
  {
    code: "MJ4TZ",
    title: "Environment trivia",
    hostLabel: "",
    listing: "public",
    hasPassword: false,
    phase: "active",
    playerCount: 24,
    playerCap: 100,
    createdAt: fetchedAt - 90 * 60_000,
    lastSeenAt: fetchedAt,
  },
];

describe("public rooms list", () => {
  const { body } = render(PublicRoomsList, {
    props: { rooms, fetchedAt, onSelect: () => undefined },
  });

  it("renders a row per room with title, capacity, phase and age", () => {
    expect(body).toContain("Pub quiz night");
    expect(body).toContain("Environment trivia");
    expect(body).toContain("7/100");
    expect(body).toContain("24/100");
    expect(body).toContain("In lobby");
    expect(body).toContain("Playing");
    expect(body).toContain("12m");
    expect(body).toContain("1h");
  });

  it("marks the password room and only that one", () => {
    expect((body.match(/password required/g) ?? []).length).toBe(1);
  });

  it("shows a byline only when the host gave one", () => {
    expect(body).toContain("hosted by Board Game Club");
    expect(body).not.toContain("hosted by  ");
  });

  it("never renders a room code, a token, or anything about the password itself", () => {
    // Codes are for people who were given one; a browsable list is not a code directory.
    expect(body).not.toContain("BQKX7");
    expect(body).not.toContain("MJ4TZ");
  });

  it("explains an empty lobby instead of showing nothing (private is the default)", () => {
    const empty = render(PublicRoomsList, {
      props: { rooms: [], fetchedAt, onSelect: () => undefined },
    });
    expect(empty.body).toContain("No public rooms right now");
    expect(empty.body).toContain("private by default");
  });

  it("steps back when a typed code wins: every row is disabled", () => {
    const dimmed = render(PublicRoomsList, {
      props: { rooms, fetchedAt, dimmed: true, onSelect: () => undefined },
    });
    expect((dimmed.body.match(/disabled/g) ?? []).length).toBe(rooms.length);
  });
});

describe("row helpers", () => {
  it("ages rooms coarsely, the way a server browser does", () => {
    expect(formatRoomAge(fetchedAt, fetchedAt)).toBe("new");
    expect(formatRoomAge(fetchedAt - 59_000, fetchedAt)).toBe("new");
    expect(formatRoomAge(fetchedAt - 5 * 60_000, fetchedAt)).toBe("5m");
    expect(formatRoomAge(fetchedAt - 3 * 3_600_000, fetchedAt)).toBe("3h");
    // A clock skew must never render as a negative age.
    expect(formatRoomAge(fetchedAt + 10_000, fetchedAt)).toBe("new");
  });

  it("names the three phases in lobby vocabulary", () => {
    expect(formatRoomPhase("lobby")).toBe("In lobby");
    expect(formatRoomPhase("active")).toBe("Playing");
    expect(formatRoomPhase("ended")).toBe("Finished");
  });
});
