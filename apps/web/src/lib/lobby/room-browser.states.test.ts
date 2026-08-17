// The room browser's four states, server-rendered (the repo's component-test pattern:
// svelte/server render, no browser mode - docs/DEVELOPMENT.md).
//
// The states are the point. "Rooms listed", "genuinely nobody hosting", and "the registry
// cannot answer" were once the same pixel on screen (owner report, 2026-08-14), and that is
// the failure this region was rebuilt around - so each one is asserted to say something
// different. The browser is now a REGION of the front door rather than the /lobby page
// (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md); the code box that used
// to be repeated above it is the front door's own, tested in front-door.states.test.ts.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import RoomBrowser from "#lib/lobby/room-browser.svelte";
import RoomCard from "#lib/lobby/room-card.svelte";
import { formatClockTime, formatRoomAge, formatRoomPhase } from "#lib/lobby/room-age.ts";
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
};

describe("room browser: rooms listed", () => {
  const { body } = render(RoomBrowser, {
    props: { listing: listingOf([lobbyRoom, playingRoom]), ...noopHandlers },
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
});

describe("room browser: the empty and unavailable states differ", () => {
  it("an empty lobby says so in one line, without a paragraph about why", () => {
    const { body } = render(RoomBrowser, {
      props: { listing: listingOf([]), ...noopHandlers },
    });
    expect(body).toContain("Nobody is hosting publicly right now");
    expect(body).not.toContain("Registry");
    // Owner copy deletion 2026-08-17: the empty state used to explain the listing model.
    expect(body).not.toContain("unlisted unless the host chooses");
  });

  it("a broken registry names the reason and the fix, and never says 'no rooms'", () => {
    const { body } = render(RoomBrowser, {
      props: {
        listing: {
          rooms: [],
          fetchedAt,
          registry: { status: "unavailable", reason: "no-table", detail: "no such table: rooms" },
        },
        ...noopHandlers,
      },
    });
    expect(body).toContain("Registry table missing");
    expect(body).toContain("wrangler d1 migrations apply");
    expect(body).toContain("joined by code");
    expect(body).not.toContain("Nobody is hosting publicly");
  });

  it("distinguishes 'not fetched yet' from 'no rooms'", () => {
    const { body } = render(RoomBrowser, {
      props: { listing: listingOf([]), loaded: false, ...noopHandlers },
    });
    expect(body).toContain("Looking for rooms");
    expect(body).not.toContain("Nobody is hosting publicly");
  });

  it("a failed fetch is reported without hiding the code box", () => {
    const { body } = render(RoomBrowser, {
      props: {
        listing: {
          rooms: [],
          fetchedAt,
          registry: { status: "unavailable", reason: "error", detail: "boom" },
        },
        listingError: "lobby responded 500",
        ...noopHandlers,
      },
    });
    expect(body).toContain("lobby responded 500");
    expect(body).toContain("joined by code");
  });
});

// Searching the list (owner request 2026-08-17). The filter itself is unit-tested in
// room-search.test.ts; what is asserted here is that the region WIRES it - the box exists in
// every state, a query narrows the rendered cards, and a query that matches nothing says so
// instead of looking like an empty lobby.
describe("room browser: searching the fetched list", () => {
  const searchable = [lobbyRoom, playingRoom];

  it("offers the box in every state, so it never appears and shoves the list", () => {
    for (const props of [
      { listing: listingOf(searchable) },
      { listing: listingOf([]) },
      { listing: listingOf([]), loaded: false },
    ]) {
      const { body } = render(RoomBrowser, { props: { ...props, ...noopHandlers } });
      expect(body).toContain('type="search"');
      expect(body).toContain("Search by room or host");
    }
  });

  it("keeps only the rooms whose title or host answers the query", () => {
    const byTitle = render(RoomBrowser, {
      props: { listing: listingOf(searchable), initialQuery: "environment", ...noopHandlers },
    }).body;
    expect(byTitle).toContain("Environment trivia");
    expect(byTitle).not.toContain("Pub quiz night");

    const byHost = render(RoomBrowser, {
      props: { listing: listingOf(searchable), initialQuery: "board game", ...noopHandlers },
    }).body;
    expect(byHost).toContain("Pub quiz night");
    expect(byHost).not.toContain("Environment trivia");
  });

  it("counts what survived beside the total, rather than silently showing fewer", () => {
    const { body } = render(RoomBrowser, {
      props: { listing: listingOf(searchable), initialQuery: "pub", ...noopHandlers },
    });
    expect(body).toContain("1");
    expect(body).toContain("of 2");
  });

  it("says a search found nothing - never reuses the 'nobody is hosting' state", () => {
    const { body } = render(RoomBrowser, {
      props: { listing: listingOf(searchable), initialQuery: "zzzz", ...noopHandlers },
    });
    expect(body).toContain("No room matches that search");
    expect(body).not.toContain("Nobody is hosting publicly");
    expect(body).toContain("Show all 2");
  });
});

describe("room browser: freshness is a clock time, not a phrase", () => {
  it("stamps the listing with the hour it was fetched", () => {
    const at = new Date(2026, 7, 17, 20, 14, 32).getTime();
    const { body } = render(RoomBrowser, {
      props: {
        listing: { rooms: [lobbyRoom], fetchedAt: at, registry: { status: "ok" } },
        ...noopHandlers,
      },
    });
    expect(body).toContain("Updated 20:14:32");
    // The relative phrasing is gone: it decays the moment it is painted (owner call).
    expect(body).not.toContain("Updated just now");
    expect(body).not.toContain("Updated 0m ago");
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

    // Real schema fields since the 2026-08-16 reconcile - the registry projects the room's
    // own spectator budget, so a card either has the facts or the server never reported them.
    const withSpectators = render(RoomCard, {
      props: {
        room: { ...lobbyRoom, spectatorCount: 3, spectatorCap: 20 },
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
    expect(spectatorSeats({ ...lobbyRoom, spectatorCount: 0 })).toEqual({
      count: 0,
      cap: null,
      fraction: null,
      full: false,
    });
  });

  it("hides spectators entirely when the host disallowed them", () => {
    const room: RoomSummary = { ...lobbyRoom, spectatorCount: 4, spectatorsAllowed: false };
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

  it("stamps a fetch with a zero-padded 24-hour clock, identically everywhere", () => {
    expect(formatClockTime(new Date(2026, 7, 17, 20, 14, 32).getTime())).toBe("20:14:32");
    // Zero padding on every field, and never a locale's 12-hour form with an AM/PM tail.
    expect(formatClockTime(new Date(2026, 7, 17, 9, 5, 4).getTime())).toBe("09:05:04");
    expect(formatClockTime(new Date(2026, 7, 17, 0, 0, 0).getTime())).toBe("00:00:00");
  });

  it("names the three phases in lobby vocabulary", () => {
    expect(formatRoomPhase("lobby")).toBe("In lobby");
    expect(formatRoomPhase("active")).toBe("Playing");
    expect(formatRoomPhase("ended")).toBe("Finished");
  });
});
