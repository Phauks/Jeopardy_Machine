// The room browser's four states, server-rendered (the repo's component-test pattern:
// svelte/server render, no browser mode - docs/DEVELOPMENT.md).
//
// The states are the point. "Rooms listed", "genuinely nobody hosting", and "the registry
// cannot answer" were once the same pixel on screen (owner report, 2026-08-14), and that is
// the failure this screen was rebuilt around - so each one is asserted to say something
// different, and the code box is asserted to survive all of them.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import LobbyScreen from "#lib/lobby/lobby-screen.svelte";
import RoomCard from "#lib/lobby/room-card.svelte";
import { formatRoomAge, formatRoomPhase } from "#lib/lobby/room-age.ts";
import { playerSeats, roomUnavailableReason, spectatorSeats } from "#lib/lobby/room-capacity.ts";
import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

const fetchedAt = 1_760_000_600_000;

const lobbyRoom: RoomSummary = {
  code: "PQZ21",
  title: "Pub quiz night",
  hostLabel: "Board Game Club",
  listing: "public",
  hasPassword: true,
  phase: "lobby",
  playerCount: 7,
  playerCap: 100,
  createdAt: fetchedAt - 12 * 60_000,
  lastSeenAt: fetchedAt,
};

const playingRoom: RoomSummary = {
  code: "MJ4TW",
  title: "Environment trivia",
  hostLabel: "",
  listing: "public",
  hasPassword: false,
  phase: "active",
  playerCount: 24,
  playerCap: 100,
  createdAt: fetchedAt - 90 * 60_000,
  lastSeenAt: fetchedAt,
};

function listingOf(rooms: RoomSummary[]): LobbyListing {
  return { rooms, fetchedAt, registry: { status: "ok" } };
}

const noopHandlers = {
  onJoinRoom: () => undefined,
  onJoinCode: () => undefined,
};

describe("lobby screen: rooms listed", () => {
  const { body } = render(LobbyScreen, {
    props: { listing: listingOf([lobbyRoom, playingRoom]), now: fetchedAt, ...noopHandlers },
  });

  it("gives the title and the host label as different facts", () => {
    expect(body).toContain("Pub quiz night");
    expect(body).toContain("Board Game Club");
    // The host label is a separate element with its own class, not a grey tail on the title.
    expect(body).toMatch(/class="[^"]*host-label[^"]*"[^>]*>Board Game Club/);
  });

  it("says so when the host did not name themselves, instead of leaving a gap", () => {
    expect(body).toContain("Host did not say who they are");
  });

  it("shows capacity, phase badge, and age per room", () => {
    expect(body).toContain("7<span");
    expect(body).toContain("/100");
    expect(body).toContain(formatRoomPhase("lobby"));
    expect(body).toContain(formatRoomPhase("active"));
    expect(body).toContain(`opened ${formatRoomAge(lobbyRoom.createdAt, fetchedAt)} ago`);
  });

  it("marks exactly the password room with a lock", () => {
    expect((body.match(/Password required\./g) ?? []).length).toBe(1);
  });

  it("never renders a room code - a browsable list is not a code directory", () => {
    expect(body).not.toContain("PQZ21");
    expect(body).not.toContain("MJ4TW");
  });

  it("keeps the code box, which is the path that always works", () => {
    expect(body).toContain("Have a code?");
  });
});

describe("lobby screen: the empty and unavailable states differ", () => {
  it("an empty lobby explains that unlisted is the default", () => {
    const { body } = render(LobbyScreen, {
      props: { listing: listingOf([]), now: fetchedAt, ...noopHandlers },
    });
    expect(body).toContain("Nobody is hosting publicly right now");
    expect(body).toContain("unlisted unless the host chooses");
    expect(body).not.toContain("Registry");
  });

  it("a broken registry names the reason and the fix, and never says 'no rooms'", () => {
    const { body } = render(LobbyScreen, {
      props: {
        listing: {
          rooms: [],
          fetchedAt,
          registry: { status: "unavailable", reason: "no-table", detail: "no such table: rooms" },
        },
        now: fetchedAt,
        ...noopHandlers,
      },
    });
    expect(body).toContain("Registry table missing");
    expect(body).toContain("wrangler d1 migrations apply");
    expect(body).toContain("joined by code");
    expect(body).not.toContain("Nobody is hosting publicly");
  });

  it("distinguishes 'not fetched yet' from 'no rooms'", () => {
    const { body } = render(LobbyScreen, {
      props: { listing: listingOf([]), loaded: false, now: fetchedAt, ...noopHandlers },
    });
    expect(body).toContain("Looking for rooms");
    expect(body).not.toContain("Nobody is hosting publicly");
  });

  it("a failed fetch is reported without hiding the code box", () => {
    const { body } = render(LobbyScreen, {
      props: {
        listing: {
          rooms: [],
          fetchedAt,
          registry: { status: "unavailable", reason: "error", detail: "boom" },
        },
        listingError: "lobby responded 500",
        now: fetchedAt,
        ...noopHandlers,
      },
    });
    expect(body).toContain("lobby responded 500");
    expect(body).toContain("Have a code?");
  });
});

describe("room card", () => {
  const cardProps = {
    fetchedAt,
    onSelect: () => undefined,
    onExpand: () => undefined,
    onCollapse: () => undefined,
  };

  it("asks for the password inside the card it belongs to, only when expanded", () => {
    const collapsed = render(RoomCard, { props: { room: lobbyRoom, ...cardProps } });
    expect(collapsed.body).not.toContain("Password for");

    const expanded = render(RoomCard, { props: { room: lobbyRoom, expanded: true, ...cardProps } });
    expect(expanded.body).toContain("Password for Pub quiz night");
    expect(expanded.body).toContain('type="password"');
  });

  it("never offers a password field for a room that has no password", () => {
    const { body } = render(RoomCard, {
      props: { room: playingRoom, expanded: true, ...cardProps },
    });
    expect(body).not.toContain('type="password"');
  });

  it("disables the card while a typed code wins", () => {
    const { body } = render(RoomCard, { props: { room: lobbyRoom, dimmed: true, ...cardProps } });
    expect(body).toContain("disabled");
  });

  it("says why a full room cannot be entered, and disables it", () => {
    const full: RoomSummary = { ...lobbyRoom, playerCount: 100 };
    const { body } = render(RoomCard, { props: { room: full, ...cardProps } });
    expect(body).toContain("Room is full");
    expect(body).toContain("disabled");
  });

  it("renders the spectator line only when the wire carries one", () => {
    const withoutSpectators = render(RoomCard, { props: { room: lobbyRoom, ...cardProps } });
    expect(withoutSpectators.body).not.toContain("watching");

    // The shape the room-controls work is adding upstream; read structurally, not by schema.
    const withSpectators = render(RoomCard, {
      props: {
        room: { ...lobbyRoom, spectatorCount: 3, spectatorCap: 20 } as RoomSummary,
        ...cardProps,
      },
    });
    expect(withSpectators.body).toContain("watching");
    expect(withSpectators.body).toContain("/20");
  });
});

describe("capacity readers", () => {
  it("reports players against the cap with a clamped meter fraction", () => {
    expect(playerSeats(lobbyRoom)).toEqual({ count: 7, cap: 100, fraction: 0.07, full: false });
    const overfull = playerSeats({ ...lobbyRoom, playerCount: 140 });
    expect(overfull.fraction).toBe(1);
    expect(overfull.full).toBe(true);
  });

  it("treats an absent spectator count as 'unknown', never as zero", () => {
    expect(spectatorSeats(lobbyRoom)).toBeNull();
    expect(spectatorSeats({ ...lobbyRoom, spectatorCount: 0 } as RoomSummary)).toEqual({
      count: 0,
      cap: null,
      fraction: null,
      full: false,
    });
  });

  it("hides spectators entirely when the host disallowed them", () => {
    const room = { ...lobbyRoom, spectatorCount: 4, spectatorsAllowed: false } as RoomSummary;
    expect(spectatorSeats(room)).toBeNull();
  });

  it("refuses ended and full rooms, but never a room merely in progress", () => {
    expect(roomUnavailableReason(lobbyRoom)).toBeNull();
    expect(roomUnavailableReason(playingRoom)).toBeNull();
    expect(roomUnavailableReason({ ...lobbyRoom, phase: "ended" })).toBe("This game has finished");
    expect(roomUnavailableReason({ ...lobbyRoom, playerCount: 100 })).toBe("Room is full");
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
