// Every row of the A4 states table (docs/design/user-flows.md) rendered through the real
// buzzer screen: a local-sim store is driven to each state and the SSR markup (svelte/server
// render - the repo's component-test pattern) is asserted for that state's signature. This is
// the "every state" gate the milestone asks for; interaction timing lives in the contract
// tests, visual truth in the /dev routes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import BuzzerScreen from "#lib/room/buzzer-screen.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { viewEntityForPlayer } from "#lib/room/room-view.ts";
import type { RoomStore } from "#lib/room/room-store.ts";
import type { RoomView } from "#lib/room/room-view.ts";

function playerStore(seed = "buzzer-states"): LocalSimRoomStore {
  const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "player", seed });
  store.join({
    nickname: "Stagehand",
    avatarId: null,
    accentId: null,
    buzzSoundId: null,
    skinToneId: null,
  });
  return store;
}

/** A store whose view is whatever a test needs - the only way to reach states the sim, which
 * adjudicates a buzz in the same tick as the press, can never produce. */
function viewOnlyStore(view: RoomView): RoomStore {
  return { mode: "ws", view } as unknown as RoomStore;
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

  it("buzzed, waiting on the room: the press is confirmed instead of re-offered", () => {
    // The room may hold the ANNOUNCEMENT for up to `compensationMs` while it ranks the field
    // by reaction time (docs/decisions/2026-08-17-buzz-latency-compensation.md). It never holds
    // the presser's own confirmation, and the button must not snap back to hot in the meantime
    // - a phone that looks unpressed invites a second press at a room that already heard.
    const store = playerStore();
    store.startGame();
    store.selectCell(0, 0);
    store.armBuzzers();
    const armed = store.view;
    // Side by side, so the assertions are about the DIFFERENCE rather than about substrings
    // that could be anywhere in the markup.
    const hot = render(BuzzerScreen, { props: { store: viewOnlyStore(armed) } }).body;
    const waiting = render(BuzzerScreen, {
      props: { store: viewOnlyStore({ ...armed, myBuzz: { status: "pending", at: Date.now() } }) },
    }).body;
    expect(hot).toContain("BUZZ<");
    expect(hot).toContain("pulse");
    expect(waiting).toContain("BUZZED<");
    expect(waiting).toContain("sent");
    // No longer inviting a press it has already sent.
    expect(waiting).not.toContain("pulse");
  });

  it("reports the paint of the armed button, or the room silently ranks by arrival", () => {
    // A SOURCE-level gate, and the reason is the whole point of it: nothing renders this. If
    // the report is dropped, every buzz goes out unstamped, every room falls back to arrival
    // order, and no screen anywhere says the race stopped being about thumbs. The store's side
    // is held by ws-room-store.test.ts; this is the half only the component can supply.
    const source = readFileSync(
      new URL("./buzzer-screen.svelte", import.meta.url).pathname,
      "utf8",
    );
    expect(source).toContain("store.markArmedPainted(arming.armId)");
    // Inside an effect, because an effect runs AFTER the DOM is updated - which is the closest
    // a component gets to "the player could see it". A call during setup would stamp t0 before
    // the button existed and hand this phone free milliseconds.
    expect(source).toMatch(/\$effect\(\(\) => \{[^}]*markArmedPainted/);
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
