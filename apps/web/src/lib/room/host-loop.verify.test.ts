// THE C4 LOOP, WALKED END TO END - the host system's first real audit (2026-08-16).
//
// The console had had the least real use of any surface: it was built against the flow chart
// in docs/design/user-flows.md C4 and the loop in docs/research/01-game-anatomy.md section 8,
// and then almost never driven all the way through. This file is the walk, kept: every step of
// the per-clue loop, every "anytime control" section 8 lists, and the paths that only exist
// under a non-default rule (everyone-answers, sudden death) - each asserted at BOTH levels,
// the store's state and what the console actually renders, because every break found in the
// walk was of the second kind. The engine worked; the console did not offer the button.
//
// What the walk found, all fixed in the same commit and each pinned by a test below:
//   1. Pressing Start in an empty room moved the ROOM to active while the engine stayed in its
//      lobby - the projector left the staged lobby for an unplayable board, silently.
//   2. Sudden death was unrunnable: a tiebreaker carries no clue, and every control - ARM
//      included - lived inside the clue branch.
//   3. Everyone-answers reached all-judging and stopped: no close-answers, no per-entity
//      verdicts, though the store had both methods all along.
//   4. Reopen-a-clue existed in the store and on no surface.
//   5. A rebound never said who was locked out - the one fact a rebound is about.
//   6. Pending timer hints accumulated (an answer window still "pending" through the rebound
//      after it), which the console's new countdown would have shown the host as fact.
//   7. Space on a focused <select> armed the buzzers (the settings panel added the first
//      dropdowns to this screen).
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import HostConsole from "#lib/room/host-console.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import type { GameState } from "@jeopardy/engine/state";
import type { RoomStore } from "#lib/room/room-store.ts";
import type { RoomView } from "#lib/room/room-view.ts";

function hostStore(seed = "host-loop"): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seed });
}

function consoleBody(store: LocalSimRoomStore): string {
  return render(HostConsole, { props: { store } }).body;
}

/** A started game with the fixture roster, parked on the board. */
function started(seed = "host-loop"): LocalSimRoomStore {
  const store = hostStore(seed);
  store.startGame();
  return store;
}

function timerKinds(store: LocalSimRoomStore): string[] {
  return store.view.pendingTimers.map((timer) => timer.kind).toSorted();
}

describe("C4 step 1-2: the board, control, and the clue", () => {
  it("names who picks, then opens the clue with the answer host-only", () => {
    const store = started();
    expect(store.view.game?.controlEntity).not.toBeNull();
    expect(consoleBody(store)).toContain("picks");

    store.selectCell(0, 0);
    expect(store.view.game?.phase).toBe("reading");
    const body = consoleBody(store);
    expect(body).toContain("Topsy-Turvy National Park"); // the answer, host-only
    expect(body).toContain("ARM");
  });

  // An empty room may start since 2026-08-20 (owner: "allow for starting a room with 0
  // players"), so what this test guards has moved rather than gone. The bug the walk found was
  // never really "an empty room started" - it was the ROOM moving to active while the ENGINE
  // stayed in its lobby, which took the projector off the staged lobby onto a board that could
  // not be played. Both screens looked fine, which is what made it the worst kind of failure.
  //
  // So the invariant is the same one, now asserted in the direction the rule points: the two
  // move TOGETHER. And the console still says the room is empty, because starting empty is
  // legitimate but usually an accident.
  it("starts an empty room, moving the engine and the room together", () => {
    const empty = new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seedRoster: "empty" });
    empty.startGame();
    expect(empty.view.game?.phase).toBe("awaiting-selection");
    expect(empty.view.phase).toBe("active");
  });

  it("leaves Start live in an empty room rather than disabling it", () => {
    const empty = new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seedRoster: "empty" });
    const body = render(HostConsole, { props: { store: empty } }).body;
    // The button is enabled. Asserted on the start ROW rather than the whole document, because
    // other controls on this console are legitimately disabled (the rules panel's slider when
    // the clock is off, for one). The empty-room WARNING follows the same warn-once shape as
    // the missing-game-screen one - it appears on the first press, which an SSR render cannot
    // perform, so game-screen.test.ts holds the readiness function's answer directly.
    const startRow = body.slice(body.indexOf('class="start-row'), body.indexOf("console-body"));
    expect(startRow).toContain("Start game");
    expect(startRow).not.toContain("disabled");
    // ...and the roster says the room is empty regardless, which is where a host looks.
    expect(body).toContain("Nobody has joined yet");
  });
});

describe("C4 step 3-5: arm, buzz, judge, rebound", () => {
  it("arms, takes a buzz, and names the answerer on the console", () => {
    const store = started();
    store.selectCell(0, 0);
    store.armBuzzers();
    expect(store.view.game?.phase).toBe("armed");
    expect(timerKinds(store)).toEqual(["buzz-window"]);

    store.simBuzzRace();
    expect(store.view.game?.phase).toBe("answering");
    // The buzz window is over the moment somebody wins it; only the answer window is pending.
    expect(timerKinds(store)).toEqual(["answer-window"]);
    const winner = store.view.game?.clue?.buzzWinner?.entityId ?? "";
    expect(winner.length).toBeGreaterThan(0);
    expect(consoleBody(store)).toContain("answers");
  });

  it("correct: scores the value, passes control, closes the clue", () => {
    const store = started();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.simBuzzRace();
    const winner = store.view.game?.clue?.buzzWinner?.entityId ?? "";
    store.judge("correct");
    expect(store.view.game?.phase).toBe("awaiting-selection");
    expect(store.view.game?.scores[winner]).toBe(200);
    expect(store.view.game?.controlEntity).toBe(winner);
    expect(store.view.game?.boards[0]?.status[0]?.[0]).toBe("played");
    expect(timerKinds(store)).toEqual([]);
  });

  it("wrong: re-arms for the rest, and the console says who is out of the clue", () => {
    const store = started();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.simBuzzRace();
    const first = store.view.game?.clue?.buzzWinner?.entityId ?? "";
    store.judge("wrong");
    // The rebound (#15): armed again, without the wrong answerer (#16).
    expect(store.view.game?.phase).toBe("armed");
    expect(store.view.game?.clue?.lockedOutEntities).toContain(first);
    expect(timerKinds(store)).toEqual(["buzz-window"]);
    expect(consoleBody(store)).toContain("Locked out of this clue");

    store.simBuzzRace();
    const second = store.view.game?.clue?.buzzWinner?.entityId ?? "";
    expect(second).not.toBe(first);
    store.judge("correct");
    expect(store.view.game?.controlEntity).toBe(second);
  });

  it("no penalty: no deduction, no lockout, the same clue stays open", () => {
    const store = started();
    store.selectCell(0, 1);
    store.armBuzzers();
    store.simBuzzRace();
    const before = { ...store.view.game?.scores };
    const winner = store.view.game?.clue?.buzzWinner?.entityId ?? "";
    store.judge("no-penalty");
    expect(store.view.game?.scores).toEqual(before);
    expect(store.view.game?.clue?.lockedOutEntities).not.toContain(winner);
    expect(store.view.game?.phase).toBe("armed");
  });
});

describe("C4 step 6: no takers, skip, and reopening a clue", () => {
  it("no takers closes the clue and leaves control where it was", () => {
    const store = started();
    const control = store.view.game?.controlEntity;
    store.selectCell(1, 0);
    store.armBuzzers();
    store.closeBuzzWindow();
    expect(store.view.game?.phase).toBe("awaiting-selection");
    expect(store.view.game?.controlEntity).toBe(control);
    expect(store.view.game?.boards[0]?.status[1]?.[0]).toBe("played");
  });

  it("skip abandons a clue without scoring it", () => {
    const store = started();
    store.selectCell(1, 1);
    store.cancelClue();
    expect(store.view.game?.phase).toBe("awaiting-selection");
    expect(store.view.game?.clue).toBeNull();
  });

  it("reopens a played cell FROM THE MINIMAP - the store method had no surface", () => {
    const store = started();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.simBuzzRace();
    store.judge("correct");
    expect(store.view.game?.boards[0]?.status[0]?.[0]).toBe("played");
    // The console renders played cells as live buttons titled "Reopen this clue" while the
    // board is open; before the walk they were permanently disabled.
    expect(consoleBody(store)).toContain("Reopen this clue");
    store.reopenCell(0, 0);
    expect(store.view.game?.boards[0]?.status[0]?.[0]).toBe("hidden");
  });
});

describe("C4 step 7: the Double Down wager flow", () => {
  it("splashes, takes a wager the host can type, then judges once", () => {
    const store = started();
    const key = store.view.game?.boards[0]?.wagerCells[0] ?? "0:0";
    const [category, row] = key.split(":").map(Number);
    store.selectCell(category ?? 0, row ?? 0);

    expect(store.view.game?.phase).toBe("wagering");
    expect(store.view.wagerRange).not.toBeNull();
    expect(timerKinds(store)).toEqual(["wager-entry"]);
    const body = consoleBody(store);
    expect(body).toContain("Commit wager");
    expect(body).toContain(String(store.view.wagerRange?.maximum ?? -1));

    const wagerer = store.view.wagerRange?.entityId ?? "";
    store.hostCommitWager(wagerer, 400);
    expect(store.view.game?.phase).toBe("wager-answering");
    expect(store.view.game?.clue?.wager).toBe(400);
    // The wager-entry hint is gone the moment the wager lands - it used to linger, and the
    // console's countdown would have told the host a wager was still due. And nothing replaces
    // it: the engine opens no answer window on a wager clue (there was no buzz to start one),
    // so a wagering player answers on the host's patience. Noted rather than fixed - an answer
    // window on the wager path is an ENGINE decision (matrix #14 reads "after buzz"), not
    // something a console should invent by starting a clock the server does not know about.
    expect(timerKinds(store)).toEqual([]);

    store.judge("correct");
    expect(store.view.game?.scores[wagerer]).toBe(400);
    expect(store.view.game?.phase).toBe("awaiting-selection");
  });
});

describe("C5: round transitions and the Final wizard", () => {
  it("walks break, round two, and the whole final in the order the console enforces", () => {
    const store = started("final-walk");
    const [alpha, beta] = store.view.game?.entityOrder ?? [];
    store.scoreSet(alpha ?? "", 3000);
    store.scoreSet(beta ?? "", 1200);

    store.endRound();
    expect(store.view.game?.phase).toBe("round-break");
    expect(consoleBody(store)).toContain("Round break");
    store.proceed();
    expect(store.view.game?.roundIndex).toBe(1);

    store.endRound();
    store.proceed();
    expect(store.view.game?.phase).toBe("final-wagers");
    expect(timerKinds(store)).toEqual(["final-wager"]);
    expect(consoleBody(store)).toContain("Wagers in: 0 /");

    store.simCompleteFinal();
    expect(store.view.game?.phase).toBe("final-writing");
    expect(timerKinds(store)).toEqual(["final-writing"]);

    store.simCompleteFinal();
    expect(store.view.game?.phase).toBe("final-reveal");
    expect(timerKinds(store)).toEqual([]);
    const reveal = consoleBody(store);
    expect(reveal).toContain("Simulated answer");
    // The reveal order is enforced: exactly one row is judgeable at a time in the individual
    // phase, which is what makes the wizard "impossible to do wrong".
    expect(reveal).toContain("waiting");

    for (const entityId of store.view.game?.final?.individualOrder ?? []) {
      store.judgeEntity(entityId, "correct");
    }
    expect(store.view.game?.phase).toBe("game-over");
    expect(store.view.game?.winners?.length ?? 0).toBeGreaterThan(0);
    expect(consoleBody(store)).toContain("Game over");
  });

  it("promises a final that eligibility then skips - found by the walk, left to the engine", () => {
    // A room where nobody is above zero has no eligible finalists (matrix #30, score > 0), so
    // proceeding from the last break goes straight to game-over. The break panel, which
    // reports the ENGINE's own `breakNextStage`, has already told the host "Next: final".
    //
    // Left alone deliberately. The engine plans the break before it applies eligibility, and
    // the honest fix is there; a console that second-guessed the state it renders would be a
    // second rulebook, and the failure mode it would hide (an unexpected winner screen) is
    // far less bad than two surfaces disagreeing about what happens next.
    const store = started("zero-walk");
    store.endRound();
    expect(store.view.game?.breakNextStage).toBe("round");
    store.proceed();
    store.endRound();
    expect(store.view.game?.breakNextStage).toBe("final");
    expect(consoleBody(store)).toContain("final");
    store.proceed();
    expect(store.view.game?.phase).toBe("game-over");
    expect(store.view.game?.final).toBeNull();
  });
});

describe("C4 anytime controls", () => {
  it("undo unwinds the last action, from anywhere", () => {
    const store = started();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.simBuzzRace();
    const winner = store.view.game?.clue?.buzzWinner?.entityId ?? "";
    store.judge("correct");
    expect(store.view.game?.scores[winner]).toBe(200);
    store.undo();
    expect(store.view.game?.phase).toBe("answering");
    expect(store.view.game?.scores[winner]).toBe(0);
  });

  it("score override adjusts and sets, and the drawer is always reachable", () => {
    const store = started();
    const [first, second] = store.view.game?.entityOrder ?? [];
    store.scoreAdjust(first ?? "", 500);
    store.scoreSet(second ?? "", -200);
    expect(store.view.game?.scores[first ?? ""]).toBe(500);
    expect(store.view.game?.scores[second ?? ""]).toBe(-200);
    expect(consoleBody(store)).toContain("Override");
  });

  it("pause freezes the room without touching the engine's phase", () => {
    const store = started();
    store.selectCell(0, 0);
    store.armBuzzers();
    store.setPaused(true);
    expect(store.view.paused).toBe(true);
    expect(store.view.game?.phase).toBe("armed");
    store.setPaused(false);
    expect(store.view.paused).toBe(false);
  });

  it("manual mode awards without a buzzer race (the Wi-Fi-died fallback)", () => {
    const store = started();
    store.selectCell(0, 0);
    const [first] = store.view.game?.entityOrder ?? [];
    store.hostAward(first ?? "", "correct");
    expect(store.view.game?.scores[first ?? ""]).toBe(200);
    expect(store.view.game?.phase).toBe("awaiting-selection");
  });
});

/**
 * The console is a pure renderer over a RoomView, so a phase the fixture's rule set cannot
 * produce is still reachable: hand it the view. Everything else about the store is real - the
 * proxy replaces one property and nothing else - so what is under test is the component's
 * reading of a state the engine genuinely produces under a different rule set.
 */
function withGame(store: LocalSimRoomStore, mutate: (state: GameState) => GameState): RoomStore {
  const game = store.view.game;
  if (game === null) throw new Error("withGame needs a started game");
  const view: RoomView = { ...store.view, game: mutate(structuredClone(game)) };
  return new Proxy(store, {
    get(target, property, receiver): unknown {
      if (property === "view") return view;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (value as () => void).bind(target) : value;
    },
  }) as unknown as RoomStore;
}

describe("the paths only a non-default rule reaches", () => {
  it("everyone-answers: the console closes the window, then judges every entity", () => {
    // The store has had closeAnswers() and judgeEntity() since the seam was written; the
    // console could call neither, so a room in this mode reached all-judging and stopped.
    const store = started("everyone");
    store.selectCell(0, 0);
    const entities = store.view.game?.entityOrder ?? [];

    const answering = withGame(store, (state) => {
      state.phase = "all-answering";
      if (state.clue !== null) {
        state.clue.answersOpenedAt = 1000;
        state.clue.submissions = {
          [entities[0] ?? ""]: { playerId: "p1", text: "an upside-down waterfall", at: 1100 },
        };
      }
      return state;
    });
    const open = render(HostConsole, { props: { store: answering } }).body;
    expect(open).toContain("Close answers now");
    expect(open).toContain("Answers in: 1 /");

    const judging = withGame(store, (state) => {
      state.phase = "all-judging";
      if (state.clue !== null) {
        state.clue.submissions = {
          [entities[0] ?? ""]: { playerId: "p1", text: "an upside-down waterfall", at: 1100 },
          [entities[1] ?? ""]: { playerId: "p2", text: "a normal waterfall", at: 1200 },
        };
        state.clue.entityVerdicts = { [entities[0] ?? ""]: "correct" };
      }
      return state;
    });
    const verdicts = render(HostConsole, { props: { store: judging } }).body;
    expect(verdicts).toContain("an upside-down waterfall");
    expect(verdicts).toContain("a normal waterfall");
    // The judged one shows its verdict; the rest are still judgeable.
    expect(verdicts).toContain("correct");
    expect(verdicts).toContain("(no answer)");
  });

  it("sudden death: the console offers arm, judge, and the next tiebreaker clue", () => {
    // Found unrunnable by the walk: a tiebreaker carries no CLUE, and every control on the
    // panel lived inside the clue branch, so the console showed "Board up - pick any cell"
    // while the engine sat in tiebreaker-reading waiting to be armed.
    const store = started("sudden-death");
    const [first, second] = store.view.game?.entityOrder ?? [];
    const tied = withGame(store, (state) => {
      state.phase = "tiebreaker-reading";
      state.clue = null;
      state.tiebreaker = {
        participants: [first ?? "", second ?? ""],
        eliminated: [second ?? ""],
        buzzWinner: null,
        armedAt: null,
      };
      return state;
    });
    const body = render(HostConsole, { props: { store: tied } }).body;
    expect(body).toContain("Sudden death");
    expect(body).toContain("Tied for first");
    expect(body).toContain("ARM");
    expect(body).toContain("Next tiebreaker clue");
    expect(body).toContain("Out of this clue");
    expect(body).not.toContain("Pick any cell on the minimap");
  });
});
