// The front door, server-rendered. What is asserted here is the SHAPE the decision doc asked
// for (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Landing and
// lobby"): one screen where rejoining, joining by code, browsing and creating are all present
// at once, in that order of priority, with the code box still winning when a code is complete.
// If a future change re-splits any of that onto its own page, this test is what says so.
//
// It also holds the 2026-08-17 simplification: the page is a header, four controls and no
// narration. The deleted copy has its own gate below - by exact string, because "we deleted
// the marketing block" is only true until someone writes a new one.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import FrontDoor from "#lib/landing/front-door.svelte";
import { blankCreateForm } from "#lib/landing/create-room-request.ts";
import { devSurfaces } from "#lib/landing/surface-cards.ts";
import type { CreateRoomForm } from "#lib/landing/create-room-request.ts";
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
  initialSearch?: string;
  createForm?: CreateRoomForm;
  createState?: CreateState;
};

function renderFrontDoor(overrides: Overrides = {}): string {
  return render(FrontDoor, {
    props: {
      listing: listingOf([room]),
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

  it("says the password field is a password field and nothing more", () => {
    // Owner copy fix: the helper prose ("shouted across the hall, not emailed") is gone.
    expect(body).toContain(">Password<");
    expect(body).not.toContain("Shouted across the hall");
  });
});

// The 2026-08-17 pass, asserted as deletions. Each string below is one the owner quoted while
// reading the deployed page; each explains something the control beside it already says.
describe("the page does not narrate itself", () => {
  const body = renderFrontDoor();

  it("makes the wordmark a header, with nothing arranged around it", () => {
    expect(body).toContain("Jeopardy Machine");
    expect(body).not.toContain("Self-hosted quiz-show night");
    expect(body).not.toContain("Quiz night, on everyone's phone.");
    expect(body).not.toContain("You run the board on the big screen");
    // The statistics rail that flanked the title went with it.
    expect(body).not.toContain("None, ever");
    expect(body).not.toContain("<dl");
  });

  it("keeps the three-pillar footer block deleted, all of it", () => {
    for (const gone of [
      "Players never log in",
      "Scan the QR or type the code",
      "no cookie banner",
      "Two to a hundred, in teams",
      "Everyone buzzes from their own phone",
      "Your questions, your look",
      "Games, question packs, and themes are portable files",
      "run the whole thing on your own Cloudflare account",
    ]) {
      expect(body).not.toContain(gone);
    }
  });

  it("keeps the listing and browsing explanations deleted", () => {
    for (const gone of [
      "A public room needs a name",
      "it is the line people read in the list",
      "Anyone can see this room in the list and walk in",
      "Only people you give the code to can join",
      "Hosts opt in to being listed",
      "Picking one here does exactly what typing its code does",
      "Everyone joining will be asked for this password",
    ]) {
      expect(body).not.toContain(gone);
    }
  });

  it("keeps the create panel's preamble deleted", () => {
    expect(body).not.toContain("You host, everyone else scans");
    expect(body).not.toContain("editable afterwards from the console");
  });

  it("says nothing in the reserved blocks when there is nothing to say", () => {
    // The blocks still EXIST (the layout law reserves their height); they are simply silent.
    expect(body).not.toContain("A code from the big screen beats anything");
    expect(body).toContain('class="join-note');
    expect(body).toContain('class="verdict');
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

  it("offers the search box on the list, and filters what it renders", () => {
    expect(renderFrontDoor()).toContain('type="search"');
    const filtered = renderFrontDoor({ initialSearch: "zzz" });
    expect(filtered).toContain("No room matches that search");
    expect(filtered).not.toContain("Pub quiz night");
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

  it("marks name and host as required, and starts with the button off", () => {
    const body = renderFrontDoor();
    // Two required inputs, marked in the markup and visibly on the label.
    expect((body.match(/required/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(body).toContain('class="required');
    expect(body).toMatch(/class="create-button[^>]*disabled/);
  });

  it("prints the player cap's real bound instead of hiding it in a refusal", () => {
    const body = renderFrontDoor();
    expect(body).toContain("2-100");
    expect(body).toContain('max="100"');
    // The hard cap is refusal headroom and was never a number to offer a host.
    expect(body).not.toContain('max="128"');
  });

  it("enables the button once both required fields are filled", () => {
    const body = renderFrontDoor({
      createForm: { ...blankCreateForm(), title: "Pub quiz", hostLabel: "Board Game Club" },
    });
    expect(body).not.toMatch(/class="create-button[^>]*disabled/);
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

  it("lives in the header now - a closed menu, not a drawer at the foot of the page", () => {
    expect(body).toContain("<details");
    expect(body).not.toContain("<details open");
    expect(body).toContain('aria-label="Developer surfaces"');
    // In the masthead, above everything the page is actually for.
    expect(body.indexOf("Developer surfaces")).toBeLessThan(body.indexOf("Join a room"));
  });

  it("leaves nothing of the old bottom drawer behind - it moved, it was not copied", () => {
    expect(body).not.toContain("Developer surfaces</span>");
    expect(body).not.toContain("the suite is still being built milestone by milestone");
    expect((body.match(/Developer surfaces/g) ?? []).length).toBe(1);
  });

  it("stays complete - the owner's rule is unchanged, only the place moved", () => {
    for (const surface of devSurfaces) {
      expect(body).toContain(surface.href);
      expect(body).toContain(surface.title);
    }
  });

  it("lists no card for a route that no longer exists", () => {
    expect(devSurfaces.some((surface) => surface.href === "/lobby")).toBe(false);
  });
});
