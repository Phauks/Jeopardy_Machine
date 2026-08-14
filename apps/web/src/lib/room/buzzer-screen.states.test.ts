// Every row of the A4 states table (docs/design/user-flows.md) rendered through the real
// buzzer screen: a local-sim store is driven to each state and the SSR markup (svelte/server
// render - the repo's component-test pattern) is asserted for that state's signature. This is
// the "every state" gate the milestone asks for; interaction timing lives in the contract
// tests, visual truth in the /dev routes.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import BuzzerScreen from "#lib/room/buzzer-screen.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { viewEntityForPlayer } from "#lib/room/room-view.ts";

function playerStore(seed = "buzzer-states"): LocalSimRoomStore {
  const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "player", seed });
  store.join({ nickname: "Stagehand", avatarId: null, accentId: null, buzzSoundId: null });
  return store;
}

function markup(store: LocalSimRoomStore): string {
  return render(BuzzerScreen, { props: { store } }).body;
}

describe("buzzer screen states (A4 table)", () => {
  it("lobby: waiting placeholder before the game exists", () => {
    const store = playerStore();
    expect(markup(store)).toContain("Waiting in the lobby");
  });

  it("board up: scoreboard + who is picking", () => {
    const store = playerStore();
    store.startGame();
    const body = markup(store);
    expect(body).toContain("is picking");
    expect(body).toContain('data-stage="waiting"');
  });

  it("clue being read: cold button, 'wait for it...', buzz text not shown", () => {
    const store = playerStore();
    store.startGame();
    store.selectCell(0, 0);
    const body = markup(store);
    expect(body).toContain("wait for it...");
    expect(body).toContain("cold");
    // Listening beats reading: the clue prompt is NOT on the phone by default.
    expect(body).not.toContain(store.view.content?.clueAt(0, 0, 0)?.prompt ?? "@@never@@");
  });

  it("armed: hot button with pulse", () => {
    const store = playerStore();
    store.startGame();
    store.selectCell(0, 0);
    store.armBuzzers();
    const body = markup(store);
    expect(body).toContain("BUZZ");
    expect(body).toContain("hot");
  });

  it("you won the buzz: full-screen YOU + answer aloud + ring timer", () => {
    const store = playerStore();
    store.startGame();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.buzz();
    const body = markup(store);
    expect(body).toContain("YOU!");
    expect(body).toContain("Answer out loud");
    expect(body).toContain("time-track");
  });

  it("someone else won: dimmed '<name> buzzed'", () => {
    const store = playerStore();
    store.startGame();
    store.selectCell(0, 0);
    store.armBuzzers();
    const rival = store.view.roster.players.find(
      (entry) => entry.playerId !== store.view.myPlayerId,
    );
    store.simBuzz(rival?.playerId ?? "");
    const body = markup(store);
    expect(body).toContain("buzzed");
    expect(body).toContain("dimmed");
  });

  it("buzzed early: too-soon lockout with the visible penalty ring", () => {
    const store = playerStore();
    store.startGame();
    store.selectCell(0, 0);
    store.buzz(); // reading phase: early
    store.armBuzzers();
    const body = markup(store);
    expect(body).toContain("Too soon");
    expect(body).toContain("lockout-ring");
  });

  it("judged: score delta flash with verdict", () => {
    const store = playerStore();
    store.startGame();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.buzz();
    store.judge("correct");
    const body = markup(store);
    expect(body).toContain("judged-flash");
    expect(body).toContain("+$200");
  });

  it("wager cell mine: pad with slider, numeric entry, shown range, true-DD shortcut", () => {
    const store = playerStore();
    store.startGame();
    const myEntity = viewEntityForPlayer(store.view, store.view.myPlayerId ?? "");
    store.selectCell(0, 0);
    store.hostAward(myEntity ?? "", "correct");
    store.selectCell(2, 3); // R1 authored wager cell
    const body = markup(store);
    expect(body).toContain('type="range"');
    expect(body).toContain('type="number"');
    expect(body).toContain("True ");
    expect(body).toContain(String(store.view.wagerRange?.maximum ?? -1));
  });

  it("wager cell not mine: announcement with wager hidden", () => {
    const store = playerStore();
    store.startGame();
    const rivalEntity = store.view.game?.entityOrder.find(
      (entry) => entry !== viewEntityForPlayer(store.view, store.view.myPlayerId ?? ""),
    );
    store.selectCell(0, 0);
    store.hostAward(rivalEntity ?? "", "correct");
    store.selectCell(2, 3);
    const body = markup(store);
    expect(body).toContain("Wager: hidden");
  });

  it("final: wager pad then typed answer with deadline bar then locked in", () => {
    const store = playerStore();
    store.startGame();
    const myEntity = viewEntityForPlayer(store.view, store.view.myPlayerId ?? "");
    const rivalEntity = store.view.game?.entityOrder.find((entry) => entry !== myEntity);
    store.scoreSet(myEntity ?? "", 2000);
    store.scoreSet(rivalEntity ?? "", 1000);
    store.endRound();
    store.proceed();
    store.endRound();
    store.proceed();
    expect(markup(store)).toContain("Final wager");
    store.commitFinalWager(500);
    expect(markup(store)).toContain("Wager locked in");
    store.simCompleteFinal(); // other wagers -> final-writing
    const writing = markup(store);
    expect(writing).toContain("Your answer");
    expect(writing).toContain(store.view.content?.final?.categoryTitle ?? "@@never@@");
    store.submitFinalAnswer("What is a test?");
    expect(markup(store)).toContain("Locked in");
  });

  it("between rounds: scoreboard + what comes next", () => {
    const store = playerStore();
    store.startGame();
    store.endRound();
    const body = markup(store);
    expect(body).toContain('data-stage="between-rounds"');
    expect(body).toContain("coming up");
  });

  it("game over: placement + thanks for playing + scoreboard", () => {
    const store = playerStore();
    store.startGame();
    store.endRound();
    store.proceed();
    store.endRound();
    store.proceed(); // nobody eligible for the final -> straight to game over
    const body = markup(store);
    expect(body).toContain("Thanks for playing");
    expect(body).toContain("#1"); // everyone at 0 shares placement 1
  });

  it("paused room: the 'one moment' notice shows on the status strip", () => {
    const store = playerStore();
    store.startGame();
    store.setPaused(true);
    expect(markup(store)).toContain("one moment - the host paused");
  });
});
