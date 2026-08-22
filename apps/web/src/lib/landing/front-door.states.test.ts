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

describe("two columns: joining on the left, hosting on the right", () => {
  const body = renderFrontDoor();

  // The field still does both jobs; it no longer SAYS so in a second label. "or search what is
  // on" went with the standing hint on 2026-08-20 - the list sits directly under the field
  // now, which shows the second job rather than describing it.
  it("puts a single field on the page, with one action beside it", () => {
    expect(body).toContain("Room code");
    expect(body).toContain(">Join<");
    expect(body).not.toContain("or search what is on");
  });

  it("orders the page: masthead, then the counter, then the list it filters", () => {
    expect(body.indexOf("Jeopardy Machine")).toBeLessThan(body.indexOf("Room code"));
    expect(body.indexOf("Room code")).toBeLessThan(body.indexOf("Public rooms"));
  });

  it("gives joining and hosting a column each, in that order", () => {
    expect(body).toContain('aria-label="Join a room"');
    expect(body).toContain('aria-label="Host a game"');
    expect(body.indexOf('aria-label="Join a room"')).toBeLessThan(
      body.indexOf('aria-label="Host a game"'),
    );
  });

  it("keeps the room list in the JOIN column, under the field that filters it", () => {
    const joinColumn = body.slice(
      body.indexOf('aria-label="Join a room"'),
      body.indexOf('aria-label="Host a game"'),
    );
    expect(joinColumn).toContain("Room code");
    expect(joinColumn).toContain("Public rooms");
  });

  it("offers ONE entry control: the code box, and nothing beside it", () => {
    // The code is the whole credential (@jeopardy/protocol room/visibility.ts, 2026-08-20), so
    // there is no second field for this page to grow back - not beside the box, not revealed
    // by a valid code, not inside a room card.
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
    // The deleted thing was the numbered HEADING "01 Join a room", not the words. Since
    // 2026-08-20 the join side is a landmark carrying that name for a screen reader, which is
    // the opposite of a decorative panel heading - so this asserts no visible heading rather
    // than the absence of a string the page now legitimately uses.
    expect(body).not.toContain("<h2>Join a room");
    expect(body).not.toContain(">Join a room<");
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
  it("arms the join and holds the list back for a room it cannot see", () => {
    const body = renderFrontDoor({ initialCode: "ZZZZZ" });
    expect(body).toContain("not on the public list");
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

  it("names a listed room and still asks for nothing but the code", () => {
    const body = renderFrontDoor({ initialCode: "BQKX7" });
    expect(body).toContain("BQKX7 is Pub quiz night");
    expect(body).not.toContain('type="password"');
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

// REWRITTEN 2026-08-20. Hosting was a BUTTON whose form opened in place, and the reason was
// space: the form had nowhere to go without pushing the room list down a screen. Given a
// column of its own it has somewhere, so the disclosure is gone - a tap to reveal a thing
// that has room to simply be there is a tap charged for nothing. Same reasoning that took the
// Roster and Settings toggles out of the console header on the same day.
describe("hosting has a column, not a button", () => {
  it("lays the form out beside the code box rather than behind a toggle", () => {
    const body = renderFrontDoor();
    expect(body).toContain("Room name");
    expect(body).toContain("Player cap");
    expect(body).not.toContain('href="/dev/rooms">Create');
    // ...and there is no longer a control that opens it, because nothing is closed.
    expect(body).not.toContain(">Host a game<");
    expect(body).not.toContain("Close hosting");
  });

  it("keeps the counter on screen while a room is being created", () => {
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

  it("asks WHICH GAME, including the club night and a file the host brought", () => {
    // The form always sent the built-in sample, so the one game this software exists to run
    // could be authored, validated, hashed and never played (2026-08-19).
    const body = renderFrontDoor({ createState: { status: "creating" } });
    expect(body).toContain("Which game");
    expect(body).toContain("Sample game");
    expect(body).toContain("Board Game Club");
    expect(body).toContain("A game file");
    for (const choice of ["sample", "event", "file"]) {
      expect(body).toContain(`value="${choice}"`);
    }
  });

  it("shows the file picker only once a host has asked for a file", () => {
    const idle = renderFrontDoor({ createState: { status: "creating" } });
    expect(idle).not.toContain('type="file"');
    const bringing = { ...blankCreateForm(), gameChoice: "file" as const, title: "Quiz" };
    const body = renderFrontDoor({ createForm: bringing, createState: { status: "creating" } });
    expect(body).toContain('type="file"');
    // Both files at once - asking for them one at a time is a wizard step, and a game that
    // keeps its questions in a separate pack needs the pack too.
    expect(body).toContain("multiple");
  });

  it("asks how people play, because nothing else can (owner report 2026-08-19)", () => {
    // Teams mode is a RULE of the game, fixed when the room opens - there is no console switch
    // that can flip it mid-night, so if this form does not ask, every room the front door makes
    // is an individuals room and the pre-game screen's teams region can only say so. The choice
    // is written onto the game definition (create-room-request.ts, withPlayerMode).
    const body = renderFrontDoor({ createState: { status: "creating" } });
    expect(body).toContain("How people play");
    // Three modes, because a room night is rarely all pairs or all soloists (owner,
    // 2026-08-19): mixed lets teams exist without forcing the odd person into a team of one.
    expect(body).toContain("Individuals");
    expect(body).toContain("Teams");
    expect(body).toContain("Mixed");
    for (const mode of ["individuals", "teams", "mixed"]) {
      expect(body).toContain(`value="${mode}"`);
    }
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
