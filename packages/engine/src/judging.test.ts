import { describe, expect, it } from "vitest";
import { applyExpectingRejection, eventsOfType, runOn, startedGame, testSetup } from "./testing.ts";
import type { Run } from "./testing.ts";
import type { TestSetupOptions } from "./testing.ts";

/** Open the first cell (value 200) and put playerId on the floor. */
function answering(options: TestSetupOptions, playerId = "p1"): Run {
  let game = startedGame(testSetup(options));
  game = runOn(game, [
    { type: "select-cell", at: 2100, category: 0, row: 0 },
    { type: "arm-buzzers", at: 2200 },
    { type: "buzz", at: 2300, playerId },
  ]);
  return game;
}

describe("verdicts and scoring", () => {
  it("correct: value added, clue closes, cell is spent", () => {
    let game = answering({});
    game = runOn(game, [{ type: "judge", at: 2400, verdict: "correct" }]);
    expect(game.state.scores.p1).toBe(200);
    expect(game.state.phase).toBe("awaiting-selection");
    expect(game.state.boards[0]?.status[0]?.[0]).toBe("played");
    expect(eventsOfType(game.events, "clue-finished")[0]?.resolution).toBe("correct");
  });

  it("matrix #17 deduct: wrong subtracts the value, scores go negative", () => {
    let game = answering({});
    game = runOn(game, [{ type: "judge", at: 2400, verdict: "wrong" }]);
    expect(game.state.scores.p1).toBe(-200);
  });

  it("matrix #17 floor-at-zero: deducts only down to zero", () => {
    let game = answering({ overrides: { scoring: { wrongAnswerPenalty: "floor-at-zero" } } });
    game = runOn(game, [
      { type: "score-adjust", at: 2350, entityId: "p1", delta: 150 },
      { type: "judge", at: 2400, verdict: "wrong" },
    ]);
    expect(game.state.scores.p1).toBe(0);
  });

  it("matrix #17 none: wrong answers cost nothing", () => {
    let game = answering({ overrides: { scoring: { wrongAnswerPenalty: "none" } } });
    game = runOn(game, [{ type: "judge", at: 2400, verdict: "wrong" }]);
    expect(game.state.scores.p1).toBe(0);
    const judged = eventsOfType(game.events, "judged")[0];
    expect(judged).toMatchObject({ verdict: "wrong", delta: 0 });
  });

  it("no-penalty: nothing deducted and NO lockout - the answerer may rebuzz on the rebound", () => {
    let game = answering({});
    game = runOn(game, [
      { type: "judge", at: 2400, verdict: "no-penalty" },
      { type: "buzz", at: 2500, playerId: "p1" },
    ]);
    expect(game.state.scores.p1).toBe(0);
    expect(game.state.clue?.buzzWinner?.playerId).toBe("p1");
  });

  it("judging with nobody on the floor is rejected", () => {
    const game = startedGame(testSetup());
    expect(applyExpectingRejection(game, { type: "judge", at: 2400, verdict: "correct" })).toBe(
      "nothing-to-judge",
    );
  });
});

describe("matrix #14/#18: answer window timeout", () => {
  it("deductOnAnswerTimeout on (default): timeout scores like a wrong answer", () => {
    let game = answering({});
    game = runOn(game, [{ type: "answer-timeout", at: 7400 }]);
    expect(game.state.scores.p1).toBe(-200);
    expect(eventsOfType(game.events, "judged")[0]?.verdict).toBe("timeout");
  });

  it("deductOnAnswerTimeout off: free, but the lockout still applies", () => {
    let game = answering({ overrides: { scoring: { deductOnAnswerTimeout: false } } });
    game = runOn(game, [{ type: "answer-timeout", at: 7400 }]);
    expect(game.state.scores.p1).toBe(0);
    expect(applyExpectingRejection(game, { type: "buzz", at: 7500, playerId: "p1" })).toBe(
      "locked-out",
    );
  });
});

describe("matrix #15/#16: rebound and lockout", () => {
  it("rebound chain: three wrong answers exhaust the field into a dead clue", () => {
    let game = answering({ seed: "rebound-chain" });
    game = runOn(game, [
      { type: "judge", at: 2400, verdict: "wrong" }, // p1 out
      { type: "buzz", at: 2500, playerId: "p2" },
      { type: "judge", at: 2600, verdict: "wrong" }, // p2 out
      { type: "buzz", at: 2700, playerId: "p3" },
      { type: "judge", at: 2800, verdict: "wrong" }, // p3 out - nobody left
    ]);
    expect(game.state.scores).toEqual({ p1: -200, p2: -200, p3: -200 });
    expect(game.state.phase).toBe("awaiting-selection");
    const finished = eventsOfType(game.events, "clue-finished")[0];
    expect(finished?.resolution).toBe("dead");
    // Three armings, three buzz-won events - sequential, one per arming.
    expect(eventsOfType(game.events, "buzz-won")).toHaveLength(3);
    expect(eventsOfType(game.events, "rebound-armed")).toHaveLength(2);
  });

  it("matrix #16: the wrong answerer is locked out for the rest of the clue", () => {
    let game = answering({});
    game = runOn(game, [{ type: "judge", at: 2400, verdict: "wrong" }]);
    expect(applyExpectingRejection(game, { type: "buzz", at: 2500, playerId: "p1" })).toBe(
      "locked-out",
    );
  });

  it("matrix #16 off: the wrong answerer may buzz again on the same clue", () => {
    let game = answering({ overrides: { buzzing: { wrongAnswererLockedOut: false } } });
    game = runOn(game, [
      { type: "judge", at: 2400, verdict: "wrong" },
      { type: "buzz", at: 2500, playerId: "p1" },
      { type: "judge", at: 2600, verdict: "correct" },
    ]);
    expect(game.state.scores.p1).toBe(0); // -200 then +200
  });

  it("matrix #15 off: one attempt per clue - a wrong answer kills the clue", () => {
    let game = answering({ overrides: { buzzing: { rebound: false } }, seed: "no-rebound" });
    const controller = game.state.controlEntity;
    game = runOn(game, [{ type: "judge", at: 2400, verdict: "wrong" }]);
    expect(game.state.phase).toBe("awaiting-selection");
    expect(game.state.controlEntity).toBe(controller);
    expect(eventsOfType(game.events, "clue-finished")[0]?.resolution).toBe("dead");
  });
});

describe("matrix #42: dead clue reveal", () => {
  it("host-reads leaves the reveal to the host", () => {
    let game = startedGame(
      testSetup({ overrides: { presentation: { deadClueReveal: "host-reads" } } }),
    );
    game = runOn(game, [
      { type: "select-cell", at: 2100, category: 0, row: 0 },
      { type: "arm-buzzers", at: 2200 },
      { type: "buzz-timeout", at: 8000 },
    ]);
    expect(eventsOfType(game.events, "clue-finished")[0]?.reveal).toBe("host-reads");
  });
});

describe("manual mode: host-award (owner directive, no-buzzer fallback)", () => {
  it("correct award closes the clue and passes control, no buzzers involved", () => {
    let game = startedGame(testSetup({ seed: "manual-mode" }));
    game = runOn(game, [
      { type: "select-cell", at: 2100, category: 0, row: 0 },
      { type: "host-award", at: 2500, entityId: "p3", verdict: "correct" },
    ]);
    expect(game.state.scores.p3).toBe(200);
    expect(game.state.controlEntity).toBe("p3");
    expect(game.state.phase).toBe("awaiting-selection");
  });

  it("wrong award deducts and locks out, clue stays open for another award", () => {
    let game = startedGame(testSetup({ seed: "manual-mode" }));
    game = runOn(game, [
      { type: "select-cell", at: 2100, category: 0, row: 0 },
      { type: "host-award", at: 2500, entityId: "p3", verdict: "wrong" },
      { type: "host-award", at: 2600, entityId: "p2", verdict: "correct" },
    ]);
    expect(game.state.scores.p3).toBe(-200);
    expect(game.state.scores.p2).toBe(200);
    expect(game.state.phase).toBe("awaiting-selection");
  });

  it("awarding an unknown entity is rejected", () => {
    let game = startedGame(testSetup());
    game = runOn(game, [{ type: "select-cell", at: 2100, category: 0, row: 0 }]);
    expect(
      applyExpectingRejection(game, {
        type: "host-award",
        at: 2500,
        entityId: "ghost",
        verdict: "correct",
      }),
    ).toBe("unknown-entity");
  });
});

describe("host controls: cancel and score surgery (matrix row 20 - always on)", () => {
  it("cancel-clue closes without scoring from any clue phase", () => {
    let game = answering({ seed: "cancel" });
    game = runOn(game, [{ type: "cancel-clue", at: 2400 }]);
    expect(game.state.scores).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(game.state.phase).toBe("awaiting-selection");
    expect(eventsOfType(game.events, "clue-finished")[0]?.resolution).toBe("cancelled");
  });

  it("score-adjust and score-set work in any phase, including mid-clue", () => {
    let game = answering({});
    game = runOn(game, [
      { type: "score-adjust", at: 2350, entityId: "p2", delta: -300 },
      { type: "score-set", at: 2360, entityId: "p3", score: 1000 },
    ]);
    expect(game.state.scores.p2).toBe(-300);
    expect(game.state.scores.p3).toBe(1000);
    expect(game.state.phase).toBe("answering"); // the clue is untouched
  });
});

describe("matrix #21: typed answer capture", () => {
  it("typed: the buzz winner's typed answer is recorded for auto-judge upstream", () => {
    let game = answering({ overrides: { answerMode: { answerCapture: "typed" } } });
    game = runOn(game, [
      { type: "submit-typed-answer", at: 2400, playerId: "p1", text: "what is catan" },
    ]);
    expect(eventsOfType(game.events, "answer-submitted")[0]?.text).toBe("what is catan");
    game = runOn(game, [{ type: "judge", at: 2500, verdict: "correct" }]);
    expect(game.state.scores.p1).toBe(200);
  });

  it("typed: a non-winner's submission is rejected", () => {
    const game = answering({ overrides: { answerMode: { answerCapture: "typed" } } });
    expect(
      applyExpectingRejection(game, {
        type: "submit-typed-answer",
        at: 2400,
        playerId: "p2",
        text: "sneaky",
      }),
    ).toBe("not-buzz-winner");
  });

  it("verbal (default): typed submissions are refused", () => {
    const game = answering({});
    expect(
      applyExpectingRejection(game, {
        type: "submit-typed-answer",
        at: 2400,
        playerId: "p1",
        text: "spoken not typed",
      }),
    ).toBe("verbal-capture");
  });
});
