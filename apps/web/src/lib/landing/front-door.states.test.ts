// The front door, server-rendered. What is asserted here is the SHAPE the decision asked for
// (docs/decisions/2026-08-18-front-door-architecture.md): one counter that spans the code and
// the search, the room list beneath it as that counter's results, hosting behind a button, and
// a masthead that is a wordmark rather than a hero. If a future change re-splits any of that
// into competing panels - or brings the hero back - this test is what says so.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import FrontDoor from "#lib/landing/front-door.svelte";
import { blankCreateForm } from "#lib/landing/create-room-request.ts";
import { formatClockTime } from "#lib/lobby/room-age.ts";
import { devSurfaces } from "#lib/landing/surface-cards.ts";
import type { CreateRoomForm } from "#lib/landing/create-room-request.ts";
import type { CreateState } from "#lib/landing/create-room-panel.svelte";
import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";
import type { RejoinCandidate } from "#lib/lobby/room-liveness.ts";

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

const lockedRoom: RoomSummary = {
  ...room,
  code: "MJ4TW",
  title: "Environment trivia",
  hostLabel: "Environmental Law Society",
  hasPassword: true,
};

function listingOf(rooms: RoomSummary[]): LobbyListing {
  return { rooms, fetchedAt, registry: { status: "ok" } };
}

type Overrides = {
  listing?: LobbyListing;
  listingError?: string | null;
  listingLoaded?: boolean;
  rejoins?: RejoinCandidate[];
  /** Seeds the counter's field - a `?code=` arrival, or (in tests) a search term. */
  initialCode?: string;
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

describe("one counter, one list, one host button", () => {
  const body = renderFrontDoor();

  it("puts a single field on the page that names both of its jobs", () => {
    expect(body).toContain("Room code");
    expect(body).toContain("or search what is on");
    expect(body).toContain(">Join<");
  });

  it("orders the page: masthead, then the counter, then the list", () => {
    expect(body.indexOf("Jeopardy Machine")).toBeLessThan(body.indexOf("Room code"));
    expect(body.indexOf("Room code")).toBeLessThan(body.indexOf("Public rooms"));
  });

  it("offers no second entry control - no standing password box beside the code", () => {
    // The password is a STATE of having a code (decision 2026-08-18 §2), so an untouched page
    // carries no password input anywhere.
    expect(body).not.toContain('type="password"');
  });

  it("never links to the deleted /lobby route from anywhere on the page", () => {
    expect(body).not.toContain('href="/lobby"');
  });
});

describe("the hero, the panels and the drawer are gone", () => {
  const body = renderFrontDoor();

  it("keeps no hero copy above the control everyone came for", () => {
    for (const deleted of [
      "Self-hosted quiz-show night",
      "You run the board on the big screen. Everyone else scans a code and buzzes in.",
      "Players never log in",
      "Two to a hundred, in teams",
      "Your questions, your look",
    ]) {
      expect(body).not.toContain(deleted);
    }
    expect(body).not.toContain('class="lead');
    expect(body).not.toContain('class="support');
  });

  it("ends after the rooms, with no pitch band under them (owner call 2026-08-17)", () => {
    // The three-pillar band was deleted then, and a footer that restates the pitch plus three
    // marketing facts is the same band with a quieter voice. The page's job is a code box.
    expect(body).not.toContain("page-foot");
    expect(body).not.toContain("No app, no account, nothing to install");
    expect(body).not.toContain("None, ever");
  });

  it("numbers no sections, because there are no longer four equal ones", () => {
    expect(body).not.toContain(">01<");
    expect(body).not.toContain(">02<");
    expect(body).not.toContain(">03<");
    expect(body).not.toContain("Join a room");
  });

  it("keeps the developer index complete, but as one gear in the masthead", () => {
    expect(body).toContain("<details");
    expect(body).not.toContain("<details open");
    // Above the counter, in the strip - not a band at the bottom of the page.
    expect(body.indexOf("<details")).toBeLessThan(body.indexOf("Room code"));
    for (const surface of devSurfaces) {
      expect(body).toContain(surface.href);
      expect(body).toContain(surface.title);
    }
  });
});

describe("the code still wins, and now says what it will do", () => {
  it("arms the join, holds the list back, and offers a password for a room it cannot see", () => {
    const body = renderFrontDoor({ initialCode: "ZZZZZ" });
    expect(body).toContain("not on the public list");
    expect(body).toContain('type="password"');
    expect(body).toContain("only if the host set one");
    // The list steps back rather than competing for the tap.
    expect(body).toContain("dimmed");
  });

  it("keeps the list on screen for a code it cannot see, rather than emptying it", () => {
    const body = renderFrontDoor({ initialCode: "ZZZZZ" });
    // A private code is the ordinary case; answering it with an empty list would read as "your
    // code is wrong" when the truth is "that room was never listed".
    expect(body).toContain("Pub quiz night");
    expect(body).not.toContain("Nothing here matches");
  });

  it("narrows the list to the one room a listed code names", () => {
    const body = renderFrontDoor({
      listing: listingOf([room, lockedRoom]),
      initialCode: "MJ4TW",
    });
    expect(body).toContain("Environment trivia");
    expect(body).not.toContain("Pub quiz night");
  });

  it("names a listed open room and asks for no password", () => {
    const body = renderFrontDoor({ initialCode: "BQKX7" });
    expect(body).toContain("BQKX7 is Pub quiz night");
    expect(body).not.toContain('type="password"');
  });

  it("says a listed locked room needs one, before anyone taps Join", () => {
    const body = renderFrontDoor({
      listing: listingOf([lockedRoom]),
      initialCode: "MJ4TW",
    });
    expect(body).toContain("needs the room password");
    expect(body).toContain("this room needs one");
  });

  it("leaves the list live while the field is incomplete", () => {
    const body = renderFrontDoor({ initialCode: "BQK" });
    expect(body).not.toContain("not on the public list");
    expect(body).not.toContain("dimmed");
  });
});

describe("the same field searches the list", () => {
  it("filters the rooms and counts what is left", () => {
    const body = renderFrontDoor({
      listing: listingOf([room, lockedRoom]),
      initialCode: "environment",
    });
    expect(body).toContain("Showing 1 of 2 public rooms");
    expect(body).toContain("Environment trivia");
    expect(body).not.toContain("Pub quiz night");
  });

  it("distinguishes 'nothing matches' from 'nobody is hosting'", () => {
    const body = renderFrontDoor({ initialCode: "nothing like this" });
    expect(body).toContain("Nothing here matches");
    expect(body).not.toContain("Nobody is hosting publicly");
  });

  it("carries the one filter the list's size justifies", () => {
    expect(renderFrontDoor()).toContain("Open rooms only");
  });
});

describe("the live listing states", () => {
  it("counts the rooms it can actually see", () => {
    expect(renderFrontDoor()).toContain("1 live");
    expect(renderFrontDoor({ listing: listingOf([]) })).toContain("none listed");
  });

  it("keeps the real fetch timestamp on screen, as a stamp rather than a decaying phrase", () => {
    // Owner call 2026-08-17: "instead of updated just now, show time stamp". A relative age is
    // only honest while something re-renders it (src/lib/lobby/room-age.ts).
    expect(renderFrontDoor()).toContain(`Updated ${formatClockTime(fetchedAt)}`);
    expect(renderFrontDoor()).not.toContain("Updated just now");
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

  it("reports a failed fetch on the counter, which still works", () => {
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
  it("offers nothing at all - not even an empty strip - when this tab remembers nothing", () => {
    const body = renderFrontDoor({ rejoins: [] });
    expect(body).not.toContain("Rejoin");
    expect(body).not.toContain("Back in");
  });

  it("leads with the room this tab was in, by name, above the counter", () => {
    const body = renderFrontDoor({
      rejoins: [
        { code: "BQKX7", title: "Pub quiz night", role: "player", at: fetchedAt, verdict: "live" },
      ],
    });
    expect(body).toContain("Rejoin");
    expect(body).toContain("still live");
    expect(body.indexOf("Rejoin")).toBeLessThan(body.indexOf("Room code"));
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
    expect(body).toContain(">checking<");
    expect(body).not.toContain(">still live<");
  });
});

describe("hosting is a button, and its form opens in place", () => {
  it("offers hosting without laying a six-field form beside the code box", () => {
    const body = renderFrontDoor();
    expect(body).toContain("Host a game");
    expect(body).not.toContain("Room name");
    expect(body).not.toContain("Player cap");
    expect(body).not.toContain('href="/dev/rooms">Create');
  });

  it("opens the real form - and keeps the counter on screen with it", () => {
    const body = renderFrontDoor({ createState: { status: "creating" } });
    expect(body).toContain("Room name");
    expect(body).toContain("Hosted by");
    expect(body).toContain("Player cap");
    expect(body).toContain("Creating the room...");
    expect(body).toContain("Room code");
  });

  it("keeps the listing and browsing explanations deleted (owner call 2026-08-17)", () => {
    // The form narrated its own settings back at whoever was filling it in. The segmented
    // control already says "Private - code only" and "Public - listed here"; a sentence under
    // it repeating that in longer words is the prose the owner had removed.
    const working = renderFrontDoor({ createState: { status: "creating" } });
    const publicForm = { ...blankCreateForm(), listing: "public" as const, title: "Quiz" };
    const listed = renderFrontDoor({
      createForm: publicForm,
      createState: { status: "creating" },
    });
    for (const gone of [
      "A public room needs a name",
      "it is the line people read in the list",
      "Anyone can see this room in the list and walk in",
      "Only people you give the code to can join",
      "Hosts opt in to being listed",
      "Everyone joining will be asked for this password",
      "You host, everyone else scans",
      "editable afterwards from the console",
    ]) {
      expect(working).not.toContain(gone);
      expect(listed).not.toContain(gone);
    }
  });

  it("asks how people play, because nothing else can (owner report 2026-08-19)", () => {
    // Teams mode is a RULE of the game, fixed when the room opens - there is no console switch
    // that can flip it mid-night, so if this form does not ask, every room the front door makes
    // is an individuals room and the pre-game screen's teams region can only say so. The choice
    // is written onto the game definition (create-room-request.ts, withPlayerMode).
    const body = renderFrontDoor({ createState: { status: "creating" } });
    expect(body).toContain("How people play");
    expect(body).toContain("Individuals");
    expect(body).toContain("Teams");
    expect(body).toContain('value="teams"');
  });

  it("marks the two fields the room cannot open without (owner call 2026-08-17)", () => {
    const body = renderFrontDoor({ createState: { status: "creating" } });
    // Room name and Hosted by are required, and the panel says so on the labels rather than
    // waiting to refuse - create-room-request.ts holds the rule itself.
    expect(body).toContain("Room name");
    expect(body).toContain("Hosted by");
    // Two required inputs, marked in the markup and visibly on the label (the class carries
    // Svelte's scope hash, so the assertion is on the prefix).
    expect((body.match(/required/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(body).toContain('class="required');
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

  it("reports a refusal without losing the form or closing the panel", () => {
    const body = renderFrontDoor({
      createState: { status: "failed", message: "This server cannot host rooms" },
    });
    expect(body).toContain("This server cannot host rooms");
    expect(body).toContain("Room name");
  });
});
