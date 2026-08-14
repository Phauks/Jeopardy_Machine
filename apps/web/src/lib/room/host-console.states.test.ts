// The C4 console through its states, plus the C1b mirror-mode invariant: answers render in
// the normal console and NEVER in the mirrored layout. Server-render per the repo pattern.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import HostConsole from "#lib/room/host-console.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";

function hostStore(seed = "console-states"): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seed });
}

function markup(store: LocalSimRoomStore, mirror = false, showSimPanel = false): string {
  return render(HostConsole, { props: { store, mirror, showSimPanel } }).body;
}

const fixtureAnswer = "Topsy-Turvy National Park"; // (0,0) of the fixture pack, round 1

describe("host console states (C4)", () => {
  it("lobby: pre-flight checklist with roster counts and start button", () => {
    const store = hostStore();
    const body = markup(store);
    expect(body).toContain("Pre-flight");
    expect(body).toContain("Start game");
    expect(body).toContain("30 players in");
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

  it("manual mode: award-to rows for every entity, no buzzers required", () => {
    const store = hostStore();
    store.startGame();
    store.selectCell(0, 0);
    // Manual mode is a component toggle; SSR cannot click it, so assert the toggle exists
    // and the award path works store-side (covered by the contract suite).
    const body = markup(store);
    expect(body).toContain("Manual mode");
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

  it("score override drawer control and pause toggle are always in the header", () => {
    const store = hostStore();
    store.startGame();
    const body = markup(store);
    expect(body).toContain("Override");
    expect(body).toContain("Pause");
    expect(body).toContain("Undo");
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

describe("sim panel gating", () => {
  it("renders only when the dev flag is passed", () => {
    const store = hostStore();
    expect(markup(store, false, true)).toContain("Simulation (dev)");
    expect(markup(store, false, false)).not.toContain("Simulation (dev)");
  });
});
