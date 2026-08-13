import { describe, expect, it } from "vitest";
import { hiddenCells } from "./control.ts";
import { applyExpectingRejection, eventsOfType, runOn, startedGame, testSetup } from "./testing.ts";
import type { Run } from "./testing.ts";
import type { TestSetupOptions } from "./testing.ts";

/**
 * Drive a game to the final: play every cell to p1 (host awards), then proceed. Callers set
 * scores via score-set before proceeding when they need a particular field.
 */
function atRoundBreak(options: TestSetupOptions = {}): Run {
  let game = startedGame(
    testSetup({ rounds: [{ columns: 3, rows: 3 }], hasFinalClue: true, ...options }),
  );
  let at = 3000;
  while (game.state.phase === "awaiting-selection") {
    const cell = hiddenCells(game.state)[0];
    if (cell === undefined) break;
    game = runOn(game, [
      { type: "select-cell", at, category: cell.category, row: cell.row },
      { type: "host-award", at: at + 10, entityId: "p1", verdict: "correct" },
    ]);
    at += 20;
  }
  return game;
}

function scoresThenFinal(scores: Record<string, number>, options: TestSetupOptions = {}): Run {
  let game = atRoundBreak(options);
  game = runOn(
    game,
    Object.entries(scores).map(([entityId, score], index) => ({
      type: "score-set" as const,
      at: 8000 + index,
      entityId,
      score,
    })),
  );
  return runOn(game, [{ type: "proceed", at: 9000 }]);
}

describe("matrix #29: final round enabled", () => {
  it("plays after the last board round when enabled and authored", () => {
    const game = scoresThenFinal({ p1: 1000, p2: 500, p3: 200 });
    expect(game.state.phase).toBe("final-wagers");
    expect(game.state.final?.eligible).toEqual(["p1", "p2", "p3"]);
  });

  it("disabled: the break goes straight to game over", () => {
    const game = atRoundBreak({ overrides: { final: { enabled: false } } });
    expect(eventsOfType(game.events, "round-break")[0]?.nextStage).toBe("game-over");
  });

  it("no authored final clue: skipped even though the setting is on", () => {
    const game = atRoundBreak({ hasFinalClue: false });
    expect(eventsOfType(game.events, "round-break")[0]?.nextStage).toBe("game-over");
  });
});

describe("matrix #30: eligibility", () => {
  it("positive-score-only: zero and negative scores sit out", () => {
    const game = scoresThenFinal({ p1: 1000, p2: 0, p3: -200 });
    expect(game.state.final?.eligible).toEqual(["p1"]);
  });

  it("everyone: all play, non-positive entities get a token stake to wager", () => {
    const game = scoresThenFinal(
      { p1: 1000, p2: 0, p3: -200 },
      { overrides: { final: { eligibility: "everyone" } } },
    );
    expect(game.state.final?.eligible).toEqual(["p1", "p2", "p3"]);
    const ranges = eventsOfType(game.events, "final-wagers-open")[0]?.ranges;
    expect(ranges?.find((range) => range.entityId === "p3")).toMatchObject({
      minimum: 0,
      maximum: 5, // the wagers minimum acts as the token stake
    });
  });

  it("nobody eligible: the final is skipped and the game ends", () => {
    const game = scoresThenFinal({ p1: -100, p2: 0, p3: -200 });
    expect(eventsOfType(game.events, "final-skipped")[0]?.reason).toBe("nobody-eligible");
    expect(game.state.phase).toBe("game-over");
  });
});

describe("matrix #31: wager rules", () => {
  it("zero-to-score: wagers from 0 to the full score; out of range rejected", () => {
    const game = scoresThenFinal({ p1: 1000, p2: 500, p3: 200 });
    expect(
      applyExpectingRejection(game, {
        type: "commit-final-wager",
        at: 9100,
        entityId: "p2",
        amount: 501,
      }),
    ).toBe("wager-out-of-range");
    expect(
      applyExpectingRejection(game, {
        type: "commit-final-wager",
        at: 9100,
        entityId: "p2",
        amount: -1,
      }),
    ).toBe("wager-out-of-range");
    const committed = runOn(game, [
      { type: "commit-final-wager", at: 9100, entityId: "p2", amount: 500 },
    ]);
    expect(committed.state.final?.wagers.p2).toBe(500);
  });

  it("an ineligible entity may not wager", () => {
    const game = scoresThenFinal({ p1: 1000, p2: 500, p3: -200 });
    expect(
      applyExpectingRejection(game, {
        type: "commit-final-wager",
        at: 9100,
        entityId: "p3",
        amount: 0,
      }),
    ).toBe("not-eligible");
  });

  it("fixed-stake: wagers are auto-committed and writing opens immediately", () => {
    const game = scoresThenFinal(
      { p1: 1000, p2: 500, p3: 200 },
      { overrides: { final: { wagerRule: "fixed-stake", fixedStakeAmount: 300 } } },
    );
    expect(game.state.phase).toBe("final-writing");
    expect(game.state.final?.wagers).toEqual({ p1: 300, p2: 300, p3: 300 });
    // Fixed stakes can push a low score negative - the stake is the stake.
    const judged = runOn(game, [
      { type: "final-writing-timeout", at: 40_000 },
      { type: "judge-entity", at: 41_000, entityId: "p3", verdict: "wrong" },
      { type: "judge-entity", at: 42_000, entityId: "p2", verdict: "wrong" },
      { type: "judge-entity", at: 43_000, entityId: "p1", verdict: "wrong" },
    ]);
    expect(judged.state.scores.p3).toBe(-100);
  });
});

describe("simultaneous wagers and answers", () => {
  it("all wagers in -> writing opens; all answers in -> reveal starts", () => {
    let game = scoresThenFinal({ p1: 1000, p2: 500, p3: 200 });
    game = runOn(game, [
      { type: "commit-final-wager", at: 9100, entityId: "p1", amount: 1 },
      { type: "commit-final-wager", at: 9200, entityId: "p2", amount: 400 },
      { type: "commit-final-wager", at: 9300, entityId: "p3", amount: 200 },
    ]);
    expect(game.state.phase).toBe("final-writing");
    const writingHint = eventsOfType(game.events, "timer-set").find(
      (event) => event.kind === "final-writing",
    );
    expect(writingHint?.durationMs).toBe(30_000); // matrix #32 default
    game = runOn(game, [
      { type: "submit-final-answer", at: 10_000, entityId: "p3", text: "what is tetris" },
      { type: "submit-final-answer", at: 11_000, entityId: "p1", text: "what is pong" },
      { type: "submit-final-answer", at: 12_000, entityId: "p2", text: "what is tetris" },
    ]);
    expect(game.state.phase).toBe("final-reveal");
  });

  it("re-commits overwrite while the phase is open (secret until reveal)", () => {
    let game = scoresThenFinal({ p1: 1000, p2: 500, p3: 200 });
    game = runOn(game, [
      { type: "commit-final-wager", at: 9100, entityId: "p1", amount: 1 },
      { type: "commit-final-wager", at: 9200, entityId: "p1", amount: 999 },
    ]);
    expect(game.state.final?.wagers.p1).toBe(999);
  });

  it("matrix #32: the writing timeout reveals with missing answers judged as absent", () => {
    let game = scoresThenFinal(
      { p1: 1000, p2: 500, p3: 200 },
      { overrides: { final: { writingTimerMs: 15_000 } } },
    );
    game = runOn(game, [
      { type: "final-wager-timeout", at: 40_000 }, // everyone forced to the minimum (0)
    ]);
    const writingHint = eventsOfType(game.events, "timer-set").find(
      (event) => event.kind === "final-writing",
    );
    expect(writingHint?.durationMs).toBe(15_000);
    game = runOn(game, [{ type: "final-writing-timeout", at: 60_000 }]);
    expect(game.state.phase).toBe("final-reveal");
    const started = eventsOfType(game.events, "final-reveal-started")[0];
    expect(started?.individualOrder).toEqual(["p3", "p2", "p1"]); // lowest first
  });
});

function revealGame(
  scores: Record<string, number>,
  revealStyle: "lowest-first" | "top-contenders" | "leaderboard",
  playerCount = 3,
): Run {
  let game = startedGame(
    testSetup({
      rounds: [{ columns: 3, rows: 3 }],
      hasFinalClue: true,
      overrides: {
        final: { revealStyle, wagerRule: "fixed-stake", fixedStakeAmount: 100 },
      },
    }),
    playerCount,
  );
  let at = 3000;
  while (game.state.phase === "awaiting-selection") {
    const cell = hiddenCells(game.state)[0];
    if (cell === undefined) break;
    game = runOn(game, [
      { type: "select-cell", at, category: cell.category, row: cell.row },
      { type: "host-award", at: at + 10, entityId: "p1", verdict: "correct" },
    ]);
    at += 20;
  }
  game = runOn(
    game,
    Object.entries(scores).map(([entityId, score], index) => ({
      type: "score-set" as const,
      at: 8000 + index,
      entityId,
      score,
    })),
  );
  game = runOn(game, [
    { type: "proceed", at: 9000 },
    { type: "final-writing-timeout", at: 50_000 },
  ]);
  return game;
}

describe("matrix #33: reveal styles", () => {
  it("lowest-first: every entity reveals individually, ascending pre-final score", () => {
    const game = revealGame({ p1: 300, p2: 900, p3: 600 }, "lowest-first");
    const started = eventsOfType(game.events, "final-reveal-started")[0];
    expect(started?.individualOrder).toEqual(["p1", "p3", "p2"]);
    expect(started?.batched).toEqual([]);
    // The engine enforces the drama order: judging out of order is refused.
    expect(
      applyExpectingRejection(game, {
        type: "judge-entity",
        at: 51_000,
        entityId: "p2",
        verdict: "correct",
      }),
    ).toBe("out-of-reveal-order");
  });

  it("lowest-first: judging in order walks the field and ends the game", () => {
    let game = revealGame({ p1: 300, p2: 900, p3: 600 }, "lowest-first");
    game = runOn(game, [
      { type: "judge-entity", at: 51_000, entityId: "p1", verdict: "correct" },
      { type: "judge-entity", at: 52_000, entityId: "p3", verdict: "wrong" },
      { type: "judge-entity", at: 53_000, entityId: "p2", verdict: "correct" },
    ]);
    expect(game.state.phase).toBe("game-over");
    expect(game.state.scores).toEqual({ p1: 400, p3: 500, p2: 1000 });
    expect(game.state.winners).toEqual(["p2"]);
  });

  it("top-contenders with a big field: bottom of the field batches, top 3 reveal individually", () => {
    const game = revealGame(
      { p1: 100, p2: 200, p3: 300, p4: 400, p5: 500, p6: 600 },
      "top-contenders",
      6,
    );
    const started = eventsOfType(game.events, "final-reveal-started")[0];
    expect(started?.individualOrder).toEqual(["p4", "p5", "p6"]);
    expect(started?.batched?.map((entry) => entry.entityId)).toEqual(["p1", "p2", "p3"]);
  });

  it("top-contenders with a small field reveals everyone individually", () => {
    const game = revealGame({ p1: 100, p2: 200, p3: 300 }, "top-contenders");
    const started = eventsOfType(game.events, "final-reveal-started")[0];
    expect(started?.individualOrder).toEqual(["p1", "p2", "p3"]);
    expect(started?.batched).toEqual([]);
  });

  it("top-contenders: batched entities judge in any order, but individuals wait for the batch", () => {
    let game = revealGame(
      { p1: 100, p2: 200, p3: 300, p4: 400, p5: 500, p6: 600 },
      "top-contenders",
      6,
    );
    expect(
      applyExpectingRejection(game, {
        type: "judge-entity",
        at: 51_000,
        entityId: "p4",
        verdict: "correct",
      }),
    ).toBe("batch-first");
    game = runOn(game, [
      { type: "judge-entity", at: 51_000, entityId: "p3", verdict: "wrong" },
      { type: "judge-entity", at: 52_000, entityId: "p1", verdict: "correct" },
      { type: "judge-entity", at: 53_000, entityId: "p2", verdict: "wrong" },
      { type: "judge-entity", at: 54_000, entityId: "p4", verdict: "correct" },
      { type: "judge-entity", at: 55_000, entityId: "p5", verdict: "wrong" },
      { type: "judge-entity", at: 56_000, entityId: "p6", verdict: "correct" },
    ]);
    expect(game.state.phase).toBe("game-over");
    expect(game.state.winners).toEqual(["p6"]);
  });

  it("leaderboard: the whole field batches, any judging order", () => {
    let game = revealGame({ p1: 300, p2: 900, p3: 600 }, "leaderboard");
    const started = eventsOfType(game.events, "final-reveal-started")[0];
    expect(started?.individualOrder).toEqual([]);
    expect(started?.batched?.map((entry) => entry.entityId)).toEqual(["p1", "p3", "p2"]);
    game = runOn(game, [
      { type: "judge-entity", at: 51_000, entityId: "p2", verdict: "wrong" },
      { type: "judge-entity", at: 52_000, entityId: "p1", verdict: "wrong" },
      { type: "judge-entity", at: 53_000, entityId: "p3", verdict: "correct" },
    ]);
    expect(game.state.phase).toBe("game-over");
  });
});
