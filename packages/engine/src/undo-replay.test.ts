import { describe, expect, it } from "vitest";
import { simulate } from "./simulate.ts";
import { createInitialState } from "./state.ts";
import { transition } from "./transition.ts";
import {
  applyExpectingRejection,
  eventsOfType,
  joinActions,
  runOn,
  startedGame,
  testSetup,
} from "./testing.ts";
import type { GameAction } from "./actions.ts";
import type { GameState } from "./state.ts";

/** A busy little game exercising joins, buzzing, scoring, a wager cell, and an undo target. */
function busyActions(): GameAction[] {
  return [
    ...joinActions(3),
    { type: "start-game", at: 2000 },
    { type: "select-cell", at: 2100, category: 0, row: 0 },
    { type: "buzz", at: 2150, playerId: "p3" }, // early
    { type: "arm-buzzers", at: 2200 },
    { type: "buzz", at: 2300, playerId: "p1" },
    { type: "judge", at: 2400, verdict: "wrong" },
    { type: "buzz", at: 2500, playerId: "p2" },
    { type: "judge", at: 2600, verdict: "correct" },
    { type: "select-cell", at: 2700, category: 1, row: 1, entityId: "p2" },
    { type: "commit-wager", at: 2800, amount: 250 },
    { type: "judge", at: 2900, verdict: "correct" },
    { type: "score-adjust", at: 3000, entityId: "p3", delta: 111 },
  ];
}

const busySetup = testSetup({
  rounds: [{ columns: 3, rows: 3, wagerPlacement: "manual", authoredWagers: [[1, 1]] }],
  overrides: { boardControl: { firstSelectorRoundOne: "host-picks" } },
  seed: "undo-replay",
});

describe("undo (matrix row 20 - always on)", () => {
  it("undo returns EXACTLY the prior state - full deep equality, rng included", () => {
    const actions = busyActions();
    let state = createInitialState(busySetup);
    const history: GameState[] = [state];
    for (const action of actions) {
      state = transition(state, action, busySetup).state;
      history.push(state);
    }
    // Undo repeatedly, checking each rewind against the recorded history, all the way to
    // the initial state.
    for (let index = history.length - 1; index > 0; index -= 1) {
      const result = transition(state, { type: "undo", at: 99_000 }, busySetup);
      expect(result.events[0]?.type).toBe("undo-applied");
      state = result.state;
      expect(state).toEqual(history[index - 1]);
    }
    expect(state).toEqual(createInitialState(busySetup));
  });

  it("undo on an empty log is rejected", () => {
    const empty = { state: createInitialState(busySetup), events: [], setup: busySetup };
    expect(applyExpectingRejection(empty, { type: "undo", at: 1 })).toBe("nothing-to-undo");
  });

  it("undo reports what it undid", () => {
    const game = startedGame(testSetup());
    const result = transition(game.state, { type: "undo", at: 5000 }, game.setup);
    const applied = eventsOfType(result.events, "undo-applied")[0];
    expect(applied?.undoneAction).toBe("start-game");
    expect(result.state.phase).toBe("lobby");
  });

  it("the classic host save: undo a mis-judged answer and re-judge", () => {
    let game = startedGame(testSetup({ seed: "mis-tap" }));
    game = runOn(game, [
      { type: "select-cell", at: 2100, category: 0, row: 0 },
      { type: "arm-buzzers", at: 2200 },
      { type: "buzz", at: 2300, playerId: "p1" },
      { type: "judge", at: 2400, verdict: "wrong" }, // mis-tap!
    ]);
    expect(game.state.scores.p1).toBe(-200);
    const undone = transition(game.state, { type: "undo", at: 2500 }, game.setup).state;
    expect(undone.scores.p1).toBe(0);
    expect(undone.phase).toBe("answering");
    expect(undone.clue?.buzzWinner?.playerId).toBe("p1");
    const rejudged = transition(
      undone,
      { type: "judge", at: 2600, verdict: "correct" },
      game.setup,
    ).state;
    expect(rejudged.scores.p1).toBe(200);
  });
});

describe("replay determinism (the simulation directive)", () => {
  it("same seed + same actions = identical final state, twice", () => {
    const first = simulate(busyActions(), busySetup);
    const second = simulate(busyActions(), busySetup);
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
  });

  it("replaying a live game's own action log reproduces it exactly (crash recovery)", () => {
    const live = simulate(busyActions(), busySetup);
    const replayed = simulate(live.state.actionLog, busySetup);
    expect(replayed.state).toEqual(live.state);
  });

  it("a different seed diverges where randomness matters", () => {
    const setupA = testSetup({ rounds: [{ columns: 6, rows: 5 }], seed: "seed-a" });
    const setupB = testSetup({ rounds: [{ columns: 6, rows: 5 }], seed: "seed-b" });
    const actions: GameAction[] = [...joinActions(3), { type: "start-game", at: 2000 }];
    const stateA = simulate(actions, setupA).state;
    const stateB = simulate(actions, setupB).state;
    expect(stateA.rngState).not.toBe(stateB.rngState);
  });

  it("score invariant: every score stays an integer through a full noisy game", () => {
    const result = simulate(busyActions(), busySetup);
    for (const score of Object.values(result.state.scores)) {
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it("rejected actions leave no trace in the log", () => {
    const actions: GameAction[] = [
      ...joinActions(2),
      { type: "start-game", at: 2000 },
      { type: "judge", at: 2100, verdict: "correct" }, // rejected: nothing to judge
      { type: "proceed", at: 2200 }, // rejected: not in a break
    ];
    const result = simulate(actions, testSetup());
    expect(result.state.actionLog).toHaveLength(3);
    expect(result.steps.filter((step) => step.rejected !== null)).toHaveLength(2);
  });
});
