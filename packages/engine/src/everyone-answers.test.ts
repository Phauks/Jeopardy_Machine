import { describe, expect, it } from "vitest";
import { applyExpectingRejection, eventsOfType, runOn, startedGame, testSetup } from "./testing.ts";
import type { Run } from "./testing.ts";

function everyoneSetup(mode: "on" | "speed-weighted") {
  return testSetup({
    overrides: {
      answerMode: { answerCapture: "typed", everyoneAnswers: mode },
    },
    seed: "everyone",
  });
}

/** Select the first cell and open the typed-answer window. */
function windowOpen(mode: "on" | "speed-weighted" = "on"): Run {
  let game = startedGame(everyoneSetup(mode));
  game = runOn(game, [
    { type: "select-cell", at: 2100, category: 0, row: 0 },
    { type: "arm-buzzers", at: 3000 }, // the same host gesture opens answers in this mode
  ]);
  return game;
}

describe("matrix #22: everyone-answers mode", () => {
  it("arming opens the typed window for all; buzzing is meaningless", () => {
    const game = windowOpen();
    expect(game.state.phase).toBe("all-answering");
    expect(eventsOfType(game.events, "answers-open")).toHaveLength(1);
    const hint = eventsOfType(game.events, "timer-set").find(
      (event) => event.kind === "everyone-answers-window",
    );
    expect(hint?.durationMs).toBe(5000);
    expect(applyExpectingRejection(game, { type: "buzz", at: 3100, playerId: "p1" })).toBe(
      "not-armed",
    );
  });

  it("first submission per entity counts; the window auto-closes when everyone is in", () => {
    let game = windowOpen();
    game = runOn(game, [
      { type: "submit-typed-answer", at: 3500, playerId: "p1", text: "catan" },
      { type: "submit-typed-answer", at: 4000, playerId: "p2", text: "carcassonne" },
    ]);
    expect(
      applyExpectingRejection(game, {
        type: "submit-typed-answer",
        at: 4100,
        playerId: "p1",
        text: "no wait",
      }),
    ).toBe("already-answered");
    game = runOn(game, [{ type: "submit-typed-answer", at: 4200, playerId: "p3", text: "catan" }]);
    expect(game.state.phase).toBe("all-judging");
    expect(eventsOfType(game.events, "answers-closed")[0]?.submittedCount).toBe(3);
  });

  it("correct submissions score the full value; wrong ones never deduct", () => {
    let game = windowOpen();
    game = runOn(game, [
      { type: "submit-typed-answer", at: 3500, playerId: "p1", text: "catan" },
      { type: "submit-typed-answer", at: 4000, playerId: "p2", text: "wrong" },
      { type: "close-answers", at: 5000 },
      { type: "judge-entity", at: 5100, entityId: "p1", verdict: "correct" },
      { type: "judge-entity", at: 5200, entityId: "p2", verdict: "wrong" },
    ]);
    expect(game.state.scores).toEqual({ p1: 200, p2: 0, p3: 0 });
    expect(game.state.phase).toBe("awaiting-selection");
    // Fastest correct takes the pick under last-correct (#7).
    expect(game.state.controlEntity).toBe("p1");
  });

  it("speed-weighted: points decay linearly to half value across the window", () => {
    let game = windowOpen("speed-weighted");
    game = runOn(game, [
      { type: "submit-typed-answer", at: 3000, playerId: "p1", text: "instant" }, // 0ms elapsed
      { type: "submit-typed-answer", at: 5500, playerId: "p2", text: "half" }, // 2500/5000ms
      { type: "submit-typed-answer", at: 9000, playerId: "p3", text: "slow" }, // past the window
      { type: "judge-entity", at: 9100, entityId: "p1", verdict: "correct" },
      { type: "judge-entity", at: 9200, entityId: "p2", verdict: "correct" },
      { type: "judge-entity", at: 9300, entityId: "p3", verdict: "correct" },
    ]);
    expect(game.state.scores.p1).toBe(200);
    expect(game.state.scores.p2).toBe(150); // 200 * (1 - 0.5 * 0.5)
    expect(game.state.scores.p3).toBe(100); // clamped at half value
  });

  it("nobody answers: closing the window kills the clue", () => {
    let game = windowOpen();
    game = runOn(game, [{ type: "answer-timeout", at: 9000 }]);
    expect(game.state.phase).toBe("awaiting-selection");
    expect(eventsOfType(game.events, "clue-finished")[0]?.resolution).toBe("dead");
  });

  it("judging an entity that never submitted is rejected", () => {
    let game = windowOpen();
    game = runOn(game, [
      { type: "submit-typed-answer", at: 3500, playerId: "p1", text: "catan" },
      { type: "close-answers", at: 5000 },
    ]);
    expect(
      applyExpectingRejection(game, {
        type: "judge-entity",
        at: 5100,
        entityId: "p2",
        verdict: "correct",
      }),
    ).toBe("no-submission");
  });

  it("matrix #22 registry guard: everyone-answers requires typed capture", () => {
    expect(() =>
      testSetup({ overrides: { answerMode: { everyoneAnswers: "on" } } }),
    ).toThrowError();
  });
});
