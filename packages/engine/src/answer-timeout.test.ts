// OWNER, 2026-08-20: "Just because it times out, doesn't mean it was wrong. People will be
// discussing the question."
//
// The rules matrix only ever asked what a timeout COSTS (row 18). It took for granted that a
// timeout was a verdict at all - true on television, where the contestant had their five
// seconds and the show moves, and false in a room where six people are still arguing. The
// engine ending the clue over a clock takes the decision away from the person holding the
// microphone, which is the one thing guiding principle 4 says it may never do.
import { describe, expect, it } from "vitest";
import { eventsOfType, runOn, startedGame, testSetup } from "./testing.ts";
import type { Run } from "./testing.ts";
import type { TestSetupOptions } from "./testing.ts";

/** A clue with p1 holding the floor, about to run out of answer time. */
function buzzedClue(options: TestSetupOptions = {}): Run {
  const game = startedGame(testSetup(options));
  return runOn(game, [
    { type: "select-cell", at: 3000, category: 0, row: 0 },
    { type: "arm-buzzers", at: 3100 },
    { type: "buzz", at: 3200, playerId: "p1" },
  ]);
}

const hostDecides: TestSetupOptions = {
  overrides: { scoring: { answerTimeoutOutcome: "host-decides" } },
};

describe("when the answer clock runs out", () => {
  it("counts as wrong by default - the TV rule, unchanged", () => {
    const game = runOn(buzzedClue(), [{ type: "answer-timeout", at: 9000 }]);
    const judged = eventsOfType(game.events, "judged").at(-1);
    expect(judged?.verdict).toBe("timeout");
    expect(judged?.delta).toBeLessThan(0);
    // The attempt is closed: p1 is locked out and the rest get their rebound.
    expect(game.state.clue?.lockedOutEntities).toContain("p1");
  });

  it("under host-decides, judges NOTHING and leaves the clue exactly where it was", () => {
    const before = buzzedClue(hostDecides);
    const scoreBefore = before.state.scores["p1"] ?? 0;
    const game = runOn(before, [{ type: "answer-timeout", at: 9000 }]);

    // Still the same moment of the game: same phase, same buzz winner, same score.
    expect(game.state.phase).toBe("answering");
    expect(game.state.clue?.buzzWinner?.entityId).toBe("p1");
    expect(game.state.scores["p1"]).toBe(scoreBefore);
    expect(game.state.clue?.lockedOutEntities ?? []).not.toContain("p1");
    expect(eventsOfType(game.events, "judged")).toHaveLength(0);
  });

  it("says so out loud, so every screen can show 'over time' without the game acting on it", () => {
    const game = runOn(buzzedClue(hostDecides), [{ type: "answer-timeout", at: 9000 }]);
    expect(eventsOfType(game.events, "answer-time-expired")[0]?.entityId).toBe("p1");
  });

  it("still lets the host judge afterwards - the verdict was only ever deferred", () => {
    let game = runOn(buzzedClue(hostDecides), [{ type: "answer-timeout", at: 9000 }]);
    game = runOn(game, [{ type: "judge", at: 12_000, verdict: "correct" }]);
    expect(eventsOfType(game.events, "judged").at(-1)?.verdict).toBe("correct");
    expect(game.state.scores["p1"]).toBeGreaterThan(0);
  });

  it("does not fire twice into a decision - a second expiry is still just information", () => {
    let game = runOn(buzzedClue(hostDecides), [{ type: "answer-timeout", at: 9000 }]);
    game = runOn(game, [{ type: "answer-timeout", at: 15_000 }]);
    expect(game.state.phase).toBe("answering");
    expect(eventsOfType(game.events, "answer-time-expired")).toHaveLength(2);
    expect(eventsOfType(game.events, "judged")).toHaveLength(0);
  });

  it("holds the same line on a WAGER clue, where the stake is the player's own number", () => {
    // The wager cell is AUTHORED at (1,1) rather than seeded, so this test does not depend on
    // where a particular rng put one (wagering.test.ts uses the same fixture).
    let game = runOn(
      startedGame(
        testSetup({
          rounds: [{ columns: 3, rows: 3, wagerPlacement: "manual", authoredWagers: [[1, 1]] }],
          overrides: { scoring: { answerTimeoutOutcome: "host-decides" } },
        }),
      ),
      [
        { type: "select-cell", at: 3000, category: 1, row: 1 },
        { type: "commit-wager", at: 3100, amount: 400 },
      ],
    );
    expect(game.state.phase).toBe("wager-answering");
    const scoreBefore = game.state.scores["p1"] ?? 0;
    game = runOn(game, [{ type: "answer-timeout", at: 9000 }]);
    expect(game.state.phase).toBe("wager-answering");
    expect(game.state.scores["p1"]).toBe(scoreBefore);
    expect(eventsOfType(game.events, "answer-time-expired")).toHaveLength(1);
  });

  it("leaves every OTHER timeout alone - this rule is about the answer window only", () => {
    // The everyone-answers window still closes submissions under host-decides: that window is
    // a collection deadline, not a verdict, and nothing about it takes a decision from anyone.
    const game = startedGame(
      testSetup({
        overrides: {
          scoring: { answerTimeoutOutcome: "host-decides" },
          answerMode: { everyoneAnswers: "on", answerCapture: "typed" },
        },
      }),
    );
    const opened = runOn(game, [
      { type: "select-cell", at: 3000, category: 0, row: 0 },
      // The same host gesture that arms buzzers opens the typed window in this mode.
      { type: "arm-buzzers", at: 3100 },
    ]);
    expect(opened.state.phase).toBe("all-answering");
    const closed = runOn(opened, [{ type: "answer-timeout", at: 9000 }]);
    // The window CLOSED - which is the assertion. Where it lands depends on whether anybody
    // typed: with submissions it is all-judging, and with none (this fixture) there is
    // nothing to judge, so the clue is simply over.
    expect(closed.state.phase).not.toBe("all-answering");
    expect(eventsOfType(closed.events, "answer-time-expired")).toHaveLength(0);
  });
});
