// The front door, server-rendered. What is asserted here is the SHAPE the decision doc asked
// for (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Landing and
// lobby"): one screen where rejoining, joining by code, browsing and creating are all present
// at once, in that order of priority, with the code box still winning when a code is complete.
// If a future change re-splits any of that onto its own page, this test is what says so.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import FrontDoor from "#lib/landing/front-door.svelte";
import { blankCreateForm } from "#lib/landing/create-room-request.ts";
import { devSurfaces } from "#lib/landing/surface-cards.ts";
import type { CreateState } from "#lib/landing/create-room-panel.svelte";
import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";
import type { RejoinCandidate } from "#lib/landing/rejoin-panel.svelte";

const fetchedAt = 1_760_000_600_000;

const room: RoomSummary = {
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

function listingOf(rooms: RoomSummary[]): LobbyListing {
  return { rooms, fetchedAt, registry: { status: "ok" } };
}

type Overrides = {
  listing?: LobbyListing;
  listingError?: string | null;
  listingLoaded?: boolean;
  rejoins?: RejoinCandidate[];
  initialCode?: string;
  createState?: CreateState;
};

function renderFrontDoor(overrides: Overrides = {}): string {
  return render(FrontDoor, {
    props: {
      listing: listingOf([room]),
      now: fetchedAt,
      surfaces: devSurfaces,
      createForm: blankCreateForm(),
      createState: { status: "idle" },
      onJoin: () => undefined,
      onJoinRoom: () => undefined,
      onRejoin: () => undefined,
      onCreate: () => undefined,
      onContinueCreate: () => undefined,
      ...overrides,
    },
  }).body;
}

describe("one front door", () => {
  const body = renderFrontDoor();

  it("puts joining, browsing and creating on the same screen", () => {
    expect(body).toContain("Room code");
    // The password field is present from the start rather than behind a "my room has one"
    // toggle: the decision doc asks for the code box, the password and the list at once.
    expect(body).toContain('type="password"');
    expect(body).toContain("Create a room");
    expect(body).toContain("Public rooms");
    expect(body).toContain("Pub quiz night");
  });

  it("orders the page by priority: join, then create, then the list", () => {
    expect(body.indexOf("Join a room")).toBeLessThan(body.indexOf("Create a room"));
    expect(body.indexOf("Create a room")).toBeLessThan(body.indexOf("Public rooms"));
  });

  it("never links to the deleted /lobby route from anywhere on the page", () => {
    expect(body).not.toContain('href="/lobby"');
  });

  it("keeps the no-accounts promise a stranger reads first", () => {
    expect(body).toContain("Players never log in");
    expect(body).toContain("No app, no account");
  });

  it("says the password field is a password field and nothing more", () => {
    // Owner copy fix: the helper prose ("shouted across the hall, not emailed") is gone.
    expect(body).toContain(">Password<");
    expect(body).not.toContain("Shouted across the hall");
  });

  it("breaks the hero into a short lead and a supporting line, not one long sentence", () => {
    const lead = /class="lead[^"]*">([^<]+)</.exec(body)?.[1]?.trim() ?? "";
    expect(lead).toBe("Quiz night, on everyone's phone.");
    // Short enough to survive the narrowest column without a ragged block (owner report).
    expect(lead.length).toBeLessThan(40);
    expect(body).toContain("You run the board on the big screen");
  });
});

describe("the code box still wins", () => {
  it("holds the list back and says why when a complete code is typed", () => {
    const body = renderFrontDoor({ initialCode: "BQKX7" });
    expect(body).toContain("the list is on hold");
    // The room card itself steps back rather than competing for the tap.
    expect(body).toContain("disabled");
  });

  it("leaves the list live while the box is incomplete", () => {
    const body = renderFrontDoor({ initialCode: "BQK" });
    expect(body).not.toContain("the list is on hold");
  });
});

describe("the live listing states", () => {
  it("counts the rooms it can actually see", () => {
    expect(renderFrontDoor()).toContain("1 live");
    expect(renderFrontDoor({ listing: listingOf([]) })).toContain("none listed");
  });

  it("never claims a count when the registry could not answer", () => {
    const body = renderFrontDoor({
      listing: {
        rooms: [],
        fetchedAt,
        registry: { status: "unavailable", reason: "no-table", detail: "no such table: rooms" },
      },
    });
    expect(body).not.toContain("none listed");
    expect(body).toContain("Registry table missing");
    expect(body).toContain("wrangler d1 migrations apply");
  });

  it("reports a failed fetch beside the code box, which still works", () => {
    const body = renderFrontDoor({ listingError: "listing responded 500" });
    expect(body).toContain("listing responded 500");
    expect(body).toContain("A room code still works");
    expect(body).toContain("Room code");
  });

  it("distinguishes 'not fetched yet' from 'nobody is hosting'", () => {
    const body = renderFrontDoor({ listing: listingOf([]), listingLoaded: false });
    expect(body).toContain("Looking for rooms");
    expect(body).not.toContain("Nobody is hosting publicly");
  });
});

describe("rejoin memory", () => {
  it("offers nothing at all - not even an empty box - when this tab remembers nothing", () => {
    const body = renderFrontDoor({ rejoins: [] });
    expect(body).not.toContain("Rejoin");
    expect(body).not.toContain("Rooms this tab was in");
  });

  it("leads with the room this tab was in, by name, above everything else", () => {
    const body = renderFrontDoor({
      rejoins: [
        { code: "BQKX7", title: "Pub quiz night", role: "player", at: fetchedAt, verdict: "live" },
      ],
    });
    expect(body).toContain("Rejoin");
    expect(body).toContain("Pub quiz night");
    expect(body).toContain("still live");
    expect(body.indexOf("Rejoin")).toBeLessThan(body.indexOf("Join a room"));
  });

  it("names the room by its code when this tab never learned a title", () => {
    const body = renderFrontDoor({
      rejoins: [{ code: "BQKX7", title: "", role: "host", at: fetchedAt, verdict: "live" }],
    });
    expect(body).toContain("room BQKX7");
    expect(body).toContain("as host");
  });

  it("shows an unresolved probe as checking rather than as a claim", () => {
    const body = renderFrontDoor({
      rejoins: [
        { code: "BQKX7", title: "Pub quiz", role: "player", at: fetchedAt, verdict: "unknown" },
      ],
    });
    expect(body).toContain("checking it is still live");
    expect(body).not.toContain(">still live<");
  });
});

describe("creating a room from the front page", () => {
  it("offers a real form, not a link to a developer surface", () => {
    const body = renderFrontDoor();
    expect(body).toContain("Room name");
    expect(body).toContain("Hosted by");
    expect(body).toContain("Player cap");
    expect(body).toContain("Create room");
    expect(body).not.toContain('href="/dev/rooms">Create');
  });

  it("explains what being public means before anyone chooses it", () => {
    expect(renderFrontDoor()).toContain("Only people you give the code to can join");
    const publicForm = { ...blankCreateForm(), listing: "public" as const, title: "Quiz" };
    expect(
      render(FrontDoor, {
        props: {
          listing: listingOf([]),
          now: fetchedAt,
          surfaces: devSurfaces,
          createForm: publicForm,
          createState: { status: "idle" } as CreateState,
          onJoin: () => undefined,
          onJoinRoom: () => undefined,
          onRejoin: () => undefined,
          onCreate: () => undefined,
          onContinueCreate: () => undefined,
        },
      }).body,
    ).toContain("Anyone can see this room in the list");
  });

  it("holds a public room that could not be listed, with its code and the fix", () => {
    const body = renderFrontDoor({
      createState: {
        status: "held",
        code: "BQKX7",
        warning: "Room BQKX7 is live and joinable by code, but it could NOT be listed.",
        registry: { status: "unavailable", reason: "no-table" },
      },
    });
    expect(body).toContain("Room BQKX7 is live");
    expect(body).toContain("Registry table missing");
    expect(body).toContain("Open the host console");
  });

  it("says so while it is working, in place", () => {
    expect(renderFrontDoor({ createState: { status: "creating" } })).toContain(
      "Creating the room...",
    );
  });

  it("reports a refusal without losing the form", () => {
    const body = renderFrontDoor({
      createState: { status: "failed", message: "This server cannot host rooms" },
    });
    expect(body).toContain("This server cannot host rooms");
    expect(body).toContain("Room name");
  });
});

describe("the developer index", () => {
  const body = renderFrontDoor();

  it("stays complete but demoted - present, closed, and last (the owner's freshness rule)", () => {
    expect(body).toContain("<details");
    expect(body).not.toContain("<details open");
    expect(body).toContain("Developer surfaces");
    expect(body.indexOf("Developer surfaces")).toBeGreaterThan(body.indexOf("Public rooms"));
    for (const surface of devSurfaces) {
      expect(body).toContain(surface.href);
      expect(body).toContain(surface.title);
    }
  });

  it("lists no card for a route that no longer exists", () => {
    expect(devSurfaces.some((surface) => surface.href === "/lobby")).toBe(false);
  });
});
