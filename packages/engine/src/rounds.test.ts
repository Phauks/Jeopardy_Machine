import { describe, expect, it } from "vitest";
import { hiddenCells } from "./control.ts";
import { applyExpectingRejection, eventsOfType, runOn, startedGame, testSetup } from "./testing.ts";
import type { Run } from "./testing.ts";

/** Fast clue cycle: select a cell, host-award it to `winner`. Two actions per cell. */
function playOutRound(game: Run, winner: string, startAt: number): Run {
  let current = game;
  let at = startAt;
  while (current.state.phase === "awaiting-selection") {
    const cell = hiddenCells(current.state)[0];
    if (cell === undefined) break;
    current = runOn(current, [
      { type: "select-cell", at, category: cell.category, row: cell.row },
      { type: "host-award", at: at + 10, entityId: winner, verdict: "correct" },
    ]);
    at += 20;
  }
  return current;
}

const twoRounds = [
  { columns: 3, rows: 3 },
  { columns: 3, rows: 3, valueMultiplier: 2 },
];

describe("matrix #1: round flow", () => {
  it("finishing the board enters a round break pointing at the next round", () => {
    let game = startedGame(testSetup({ rounds: twoRounds }));
    game = playOutRound(game, "p1", 3000);
    expect(game.state.phase).toBe("round-break");
    expect(eventsOfType(game.events, "round-break")[0]?.nextStage).toBe("round");
    game = runOn(game, [{ type: "proceed", at: 9000 }]);
    expect(game.state.phase).toBe("awaiting-selection");
    expect(game.state.roundIndex).toBe(1);
  });

  it("after the last round with no final, the break leads to game over", () => {
    let game = startedGame(testSetup({ rounds: [{ columns: 3, rows: 3 }] }));
    game = playOutRound(game, "p1", 3000);
    expect(eventsOfType(game.events, "round-break")[0]?.nextStage).toBe("game-over");
    game = runOn(game, [{ type: "proceed", at: 9000 }]);
    expect(game.state.phase).toBe("game-over");
    expect(game.state.winners).toEqual(["p1"]);
  });

  it("roundCount 1 plays only the first of two authored rounds", () => {
    let game = startedGame(
      testSetup({ rounds: twoRounds, overrides: { structure: { roundCount: 1 } } }),
    );
    game = playOutRound(game, "p1", 3000);
    expect(eventsOfType(game.events, "round-break")[0]?.nextStage).toBe("game-over");
  });
});

describe("matrix #5: round two values", () => {
  it("round two cells carry multiplied values", () => {
    let game = startedGame(testSetup({ rounds: twoRounds, seed: "round-two" }));
    game = playOutRound(game, "p1", 3000);
    game = runOn(game, [
      { type: "proceed", at: 9000 },
      { type: "select-cell", at: 9100, category: 0, row: 2 },
    ]);
    expect(game.state.clue?.value).toBe(1200); // 600 x 2
  });
});

describe("matrix #9: first selector, round two", () => {
  it("lowest-score: the trailing entity opens round two", () => {
    let game = startedGame(testSetup({ rounds: twoRounds, seed: "selector-r2" }));
    game = runOn(game, [{ type: "score-set", at: 2050, entityId: "p2", score: -500 }]);
    game = playOutRound(game, "p1", 3000);
    game = runOn(game, [{ type: "proceed", at: 9000 }]);
    expect(game.state.controlEntity).toBe("p2");
  });

  it("exact ties resolve by a seeded draw among the tied", () => {
    let game = startedGame(testSetup({ rounds: twoRounds, seed: "selector-tie" }));
    game = playOutRound(game, "p1", 3000); // p1 leads; p2 and p3 tie at 0
    game = runOn(game, [{ type: "proceed", at: 9000 }]);
    expect(["p2", "p3"]).toContain(game.state.controlEntity);
    // Deterministic per seed:
    let again = startedGame(testSetup({ rounds: twoRounds, seed: "selector-tie" }));
    again = playOutRound(again, "p1", 3000);
    again = runOn(again, [{ type: "proceed", at: 9000 }]);
    expect(again.state.controlEntity).toBe(game.state.controlEntity);
  });

  it("same-as-round-one: round one's opener opens round two as well", () => {
    let game = startedGame(
      testSetup({
        rounds: twoRounds,
        overrides: { boardControl: { firstSelectorRoundTwo: "same-as-round-one" } },
        seed: "same-opener",
      }),
    );
    const opener = game.state.firstSelectorRoundOne;
    expect(opener).not.toBeNull();
    game = playOutRound(game, "p1", 3000);
    game = runOn(game, [{ type: "proceed", at: 9000 }]);
    expect(game.state.controlEntity).toBe(opener);
  });
});

describe("host force-end and matrix #6: round time limit", () => {
  it("end-round forfeits the remaining cells", () => {
    let game = startedGame(testSetup({ rounds: [{ columns: 3, rows: 3 }] }));
    game = runOn(game, [{ type: "end-round", at: 3000 }]);
    expect(game.state.phase).toBe("round-break");
    expect(eventsOfType(game.events, "round-ended")[0]?.unplayedCells).toBe(9);
  });

  it("emits the round timer hint and ends the round on expiry while selecting", () => {
    let game = startedGame(
      testSetup({
        rounds: [{ columns: 3, rows: 3 }],
        overrides: { structure: { roundTimeLimitMs: 300_000 } },
      }),
    );
    const hint = eventsOfType(game.events, "timer-set").find(
      (event) => event.kind === "round-time-limit",
    );
    expect(hint?.durationMs).toBe(300_000);
    game = runOn(game, [{ type: "round-timeout", at: 302_000 }]);
    expect(game.state.phase).toBe("round-break");
  });

  it("mid-clue expiry latches: the clue finishes, THEN the round ends", () => {
    let game = startedGame(
      testSetup({
        rounds: [{ columns: 3, rows: 3 }],
        overrides: { structure: { roundTimeLimitMs: 300_000 } },
      }),
    );
    game = runOn(game, [
      { type: "select-cell", at: 2100, category: 0, row: 0 },
      { type: "arm-buzzers", at: 2200 },
      { type: "buzz", at: 2300, playerId: "p2" },
      { type: "round-timeout", at: 302_000 },
    ]);
    expect(game.state.phase).toBe("answering"); // still judging
    game = runOn(game, [{ type: "judge", at: 302_100, verdict: "correct" }]);
    expect(game.state.phase).toBe("round-break");
    expect(game.state.scores.p2).toBe(200); // the buzz was honored
  });

  it("proceed outside a break is rejected", () => {
    const game = startedGame(testSetup());
    expect(applyExpectingRejection(game, { type: "proceed", at: 3000 })).toBe("not-in-break");
  });
});

describe("matrix #2/#3: board sizes", () => {
  it("a 6x5 and a 4x3 board both play end to end", () => {
    for (const board of [
      { columns: 6, rows: 5 },
      { columns: 4, rows: 3 },
    ]) {
      let game = startedGame(testSetup({ rounds: [board] }));
      game = playOutRound(game, "p1", 3000);
      expect(game.state.phase).toBe("round-break");
      const expected = board.columns * board.rows;
      const values = eventsOfType(game.events, "cell-selected");
      expect(values).toHaveLength(expected);
    }
  });
});
