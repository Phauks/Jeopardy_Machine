// OWNER, 2026-08-20, in two steps that land in the same place:
//   "Just because it times out, doesn't mean it was wrong. People will be discussing the
//    question."
//   "all scoring is manual, remove it counts as wrong option."
//
// The first was answered with a CHOICE - the television rule, or defer to the host. The second
// deleted the choice, and it is the truer description of this product: a host with a microphone
// judges every answer in this room, and the only verdicts the engine ever applied on its own
// were the ones a clock produced. So an expired answer window is information and nothing else,
// unconditionally, with no setting that makes it a verdict again.
//
// The clue-level consequence is what these tests hold: the floor does not move, no score
// changes, nobody is locked out, and the host judges when the room has finished arguing.
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

describe("when the answer clock runs out", () => {
  it("judges NOTHING and leaves the clue exactly where it was", () => {
    const before = buzzedClue();
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
    const game = runOn(buzzedClue(), [{ type: "answer-timeout", at: 9000 }]);
    expect(eventsOfType(game.events, "answer-time-expired")[0]?.entityId).toBe("p1");
  });

  it("still lets the host judge afterwards - the verdict was only ever deferred", () => {
    let game = runOn(buzzedClue(), [{ type: "answer-timeout", at: 9000 }]);
    game = runOn(game, [{ type: "judge", at: 12_000, verdict: "correct" }]);
    expect(eventsOfType(game.events, "judged").at(-1)?.verdict).toBe("correct");
    expect(game.state.scores["p1"]).toBeGreaterThan(0);
  });

  it("does not fire twice into a decision - a second expiry is still just information", () => {
    let game = runOn(buzzedClue(), [{ type: "answer-timeout", at: 9000 }]);
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
    // The everyone-answers window still closes submissions: that window is a collection
    // DEADLINE, not a verdict, and closing it takes no decision away from anybody.
    const game = startedGame(
      testSetup({
        overrides: { answerMode: { everyoneAnswers: "on", answerCapture: "typed" } },
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

  // NO CLOCK AT ALL is a legitimate room (owner, 2026-08-20: "time to answer should allow for
  // no time limit"). The engine's side of that is simply that nothing schedules the timer;
  // there is no second code path, which is the point of spelling "off" as null.
  it("sets no answer timer when the room has no answer clock", () => {
    const game = buzzedClue({ overrides: { buzzing: { answerWindowMs: null } } });
    const timers = eventsOfType(game.events, "timer-set").filter(
      (event) => event.kind === "answer-window",
    );
    expect(timers).toHaveLength(0);
    expect(game.state.phase).toBe("answering");
  });
});
