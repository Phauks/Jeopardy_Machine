// The C4 console through its states, plus the C1b mirror-mode invariant: answers render in
// the normal console and NEVER in the mirrored layout. Server-render per the repo pattern.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import HostConsole from "#lib/room/host-console.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";

function hostStore(seed = "console-states"): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seed });
}

function markup(
  store: LocalSimRoomStore,
  mirror = false,
  showSimPanel = false,
  settingsOpen = false,
): string {
  return render(HostConsole, { props: { store, mirror, showSimPanel, settingsOpen } }).body;
}

const fixtureAnswer = "Topsy-Turvy National Park"; // (0,0) of the fixture pack, round 1

describe("host console states (C4)", () => {
  it("lobby: the roster itself, the game-screen setup, and start as an action", () => {
    const store = hostStore();
    const body = markup(store);
    // The "Pre-flight" panel was DELETED 2026-08-19 (owner: "pre-flight and roster look the exact
    // same"). Every count it restated is state on the thing that owns it now: the roster answers
    // who is here, the game-screen panel answers what the room can see, and Start is an action in
    // the console's chrome with its readiness attached - one place per fact.
    expect(body).not.toContain("Pre-flight");
    expect(body).toContain("Roster");
    expect(body).toContain("Game screen");
    expect(body).toContain("Start game");
    // The names, not a count of them: the roster is the one place that answers "who is here".
    expect(body).toContain("Captain Canopy");
  });

  it("board up: minimap with values, who-has-control, hidden-wager dot (host-only layer)", () => {
    const store = hostStore();
    store.startGame();
    const body = markup(store);
    expect(body).toContain("Board minimap");
    expect(body).toContain("picks");
    expect(body).toContain("wager-dot");
  });

  it("clue open: prompt AND answer visible, ARM enabled with spacebar hint", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    const body = markup(store);
    expect(body).toContain(fixtureAnswer);
    expect(body).toContain("ARM");
    expect(body).toContain("space");
  });

  it("answering: judge row live with keyboard hints, answering entity named", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.simBuzzRace();
    const body = markup(store);
    expect(body).toContain("answers");
    expect(body).toContain("Correct");
    expect(body).toContain("Wrong");
    expect(body).toContain("No penalty");
  });

  it("manual mode: the toggle lives in the cog, and the console says when it is on", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    // Manual mode became a DEVICE PREFERENCE at the 2026-08-16 host-settings pass - it belongs
    // to this laptop, not to the room, and it survives a mid-game reload. SSR cannot click it,
    // so assert it is reachable in the panel; the award path itself is in the contract suite.
    expect(markup(store, false, false, true)).toContain("Manual mode");
    // ...and the header carries no flag while it is off, which is the honest default state.
    expect(markup(store)).not.toContain("mode-flag");
  });

  it("wager wizard: range shown, host can type the wager on the player's behalf", () => {
    const store = hostStore();
    store.startGame();
    const first = store.view.game?.entityOrder[0];
    store.selectCell(0, 0);
    store.hostAward(first ?? "", "correct");
    store.selectCell(2, 3);
    const body = markup(store);
    expect(body).toContain("wagers");
    expect(body).toContain("Commit wager");
    expect(body).toContain(String(store.view.wagerRange?.maximum ?? -1));
  });

  it("final wizard: wager progress, then reveal rows judged in enforced order", () => {
    const store = hostStore();
    store.startGame();
    const [alpha, beta] = store.view.game?.entityOrder ?? [];
    store.scoreSet(alpha ?? "", 3000);
    store.scoreSet(beta ?? "", 1200);
    store.endRound();
    store.proceed();
    store.endRound();
    store.proceed();
    // SSR keeps template line breaks, so match the stable prefix + the wizard's action.
    const wagers = markup(store);
    expect(wagers).toContain("Wagers in: 0 /");
    expect(wagers).toContain("Close wagers now");
    store.simCompleteFinal();
    const answers = markup(store);
    expect(answers).toContain("Answers in: 0 /");
    expect(answers).toContain("Close answers now");
    store.simCompleteFinal();
    const reveal = markup(store);
    expect(reveal).toContain("waiting"); // the not-yet-revealable row
    expect(reveal).toContain("Simulated answer");
  });

  it("game over: standings strip", () => {
    const store = hostStore();
    store.startGame();
    store.endRound();
    store.proceed();
    store.endRound();
    store.proceed();
    expect(markup(store)).toContain("Game over");
  });

  it("score override drawer control, pause, undo and the cog are always in the header", () => {
    const store = hostStore();
    store.startGame();
    const body = markup(store);
    expect(body).toContain("Override");
    expect(body).toContain("Pause");
    expect(body).toContain("Undo");
    expect(body).toContain('aria-label="Settings"');
  });
});

describe("mirror mode (C1b)", () => {
  it("reshapes into the display layout with the slim dock", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    const body = markup(store, true);
    expect(body).toContain("mirror-dock");
    expect(body).toContain("Arm");
    expect(body).toContain("No takers");
    expect(body).toContain("Exit mirror");
  });

  it("NEVER renders answers, the wager dot, or the private console panels", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    const body = markup(store, true);
    expect(body).not.toContain(fixtureAnswer);
    expect(body).not.toContain("wager-dot");
    expect(body).not.toContain("Board minimap");
    // The prompt itself is fine to mirror - the room is supposed to read it.
    expect(body).toContain(store.view.content?.clueAt(0, 0, 0)?.prompt ?? "@@never@@");
  });
});

describe("mirror mode is one click from the console chrome", () => {
  // It used to be a URL query and a checkbox two levels into the cog, which is not a control a
  // host can reach when the projector turns out to be mirroring their laptop (owner,
  // 2026-08-17: "Mirror mode needs to be easier to enter").
  it("is a labelled toggle in the header, carrying its own state", () => {
    const store = hostStore();
    store.startGame();
    const body = markup(store);
    expect(body).toContain("Mirror off");
    expect(body).toContain('aria-pressed="false"');
  });

  it("still leaves by its dock button - the header, the cog and the dock are one switch", () => {
    const store = hostStore();
    store.startGame();
    // Entered through the route's ?mirror. The seed used to be OR-ed with the device
    // preference, which made "Exit mirror" a button that could not work.
    expect(markup(store, true)).toContain("Exit mirror");
  });
});

describe("the roster rail", () => {
  it("is open by default in the lobby, where the roster IS the console's job", () => {
    const body = markup(hostStore());
    expect(body).toContain('aria-label="Room roster"');
    expect(body).toContain("Players");
  });

  it("closes once a game is running, and stays one click away in the header", () => {
    const store = hostStore();
    store.startGame();
    const body = markup(store);
    expect(body).not.toContain('aria-label="Room roster"');
    expect(body).toContain(">Roster<");
  });

  it("opens beside the console rather than replacing it (the persistent-layout law)", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    const body = render(HostConsole, { props: { store, rosterOpen: true } }).body;
    expect(body).toContain('aria-label="Room roster"');
    expect(body).toContain("Board minimap");
    expect(body).toContain(fixtureAnswer);
  });
});

describe("the console never presents fixture data as the room's", () => {
  it("says out loud that a local simulation is not a live room", () => {
    // The owner met a console reporting "26/30 connected" for a room nobody had joined: every
    // route seeded the 30-player fixture roster into whatever code was in the URL.
    expect(markup(hostStore())).toContain("Simulation");
  });

  it("and an empty room counts nobody rather than the fixture's crowd", () => {
    const empty = new LocalSimRoomStore({
      roomCode: "REALX",
      role: "host",
      seed: "empty-room",
      seedRoster: "empty",
    });
    const body = markup(empty);
    expect(body).toContain("0/0 connected");
    expect(body).toContain("Nobody has joined yet");
    expect(body).not.toContain("26/30");
  });
});

describe("sim panel gating", () => {
  it("renders only when the dev flag is passed", () => {
    const store = hostStore();
    expect(markup(store, false, true)).toContain("Simulation (dev)");
    expect(markup(store, false, false)).not.toContain("Simulation (dev)");
  });
});
