import { describe, expect, it } from "vitest";
import { hiddenCells } from "./control.ts";
import {
  applyExpectingRejection,
  eventsOfType,
  joinActions,
  run,
  runOn,
  startedGame,
  testSetup,
} from "./testing.ts";
import type { Run } from "./testing.ts";
import type { TestSetupOptions } from "./testing.ts";

/** Play out a one-round game so that `scores` are the finish, then proceed to the end. */
function finishedGame(scores: Record<string, number>, options: TestSetupOptions = {}): Run {
  let game = startedGame(testSetup({ rounds: [{ columns: 3, rows: 3 }], ...options }));
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
  return runOn(game, [{ type: "proceed", at: 9000 }]);
}

/** A game stopped mid-board, which is the whole point: nothing is played out. */
function stoppedMidGame(scores: Record<string, number>, options: TestSetupOptions = {}): Run {
  let game = startedGame(testSetup({ rounds: [{ columns: 3, rows: 3 }], ...options }));
  game = runOn(
    game,
    Object.entries(scores).map(([entityId, score], index) => ({
      type: "score-set" as const,
      at: 3000 + index,
      entityId,
      score,
    })),
  );
  return runOn(game, [{ type: "end-game", at: 4000 }]);
}

describe("standings and winners", () => {
  it("a clean finish ranks by score and crowns the leader", () => {
    const game = finishedGame({ p1: 800, p2: 400, p3: -200 });
    expect(game.state.phase).toBe("game-over");
    expect(game.state.winners).toEqual(["p1"]);
    const over = eventsOfType(game.events, "game-over")[0];
    expect(over?.note).toBe("clean");
    expect(over?.standings.map((entry) => [entry.entityId, entry.placement])).toEqual([
      ["p1", 1],
      ["p2", 2],
      ["p3", 3],
    ]);
  });

  it("non-first ties share a placement", () => {
    const game = finishedGame({ p1: 800, p2: 400, p3: 400 });
    const over = eventsOfType(game.events, "game-over")[0];
    expect(over?.standings.map((entry) => entry.placement)).toEqual([1, 2, 2]);
  });
});

describe("matrix #37: tie for first", () => {
  it("co-champions (party default): both leaders win", () => {
    const game = finishedGame({ p1: 800, p2: 800, p3: 100 });
    expect(game.state.winners?.toSorted()).toEqual(["p1", "p2"]);
    expect(eventsOfType(game.events, "game-over")[0]?.note).toBe("co-champions");
  });

  it("shared-placement ranks them equal", () => {
    const game = finishedGame(
      { p1: 800, p2: 800, p3: 100 },
      { overrides: { end: { tieForFirst: "shared-placement" } } },
    );
    expect(game.state.winners?.toSorted()).toEqual(["p1", "p2"]);
    expect(eventsOfType(game.events, "game-over")[0]?.note).toBe("shared-placement");
  });

  it("sudden-death: the tied leaders enter a no-stakes buzz clue; correct wins the game", () => {
    let game = finishedGame(
      { p1: 800, p2: 800, p3: 100 },
      { overrides: { end: { tieForFirst: "sudden-death" } } },
    );
    expect(game.state.phase).toBe("tiebreaker-reading");
    expect(eventsOfType(game.events, "tiebreaker-started")[0]?.participants.toSorted()).toEqual([
      "p1",
      "p2",
    ]);
    // The non-participant cannot buzz.
    game = runOn(game, [{ type: "arm-buzzers", at: 10_000 }]);
    expect(applyExpectingRejection(game, { type: "buzz", at: 10_100, playerId: "p3" })).toBe(
      "locked-out",
    );
    game = runOn(game, [
      { type: "buzz", at: 10_200, playerId: "p2" },
      { type: "judge", at: 10_300, verdict: "correct" },
    ]);
    expect(game.state.phase).toBe("game-over");
    expect(game.state.winners).toEqual(["p2"]);
    const over = eventsOfType(game.events, "game-over")[0];
    expect(over?.note).toBe("sudden-death");
    // Scores never moved - the tiebreaker is stakes-free.
    expect(game.state.scores.p2).toBe(800);
    // The winner promotes above the tied rival in the standings.
    expect(over?.standings.map((entry) => [entry.entityId, entry.placement])).toEqual([
      ["p2", 1],
      ["p1", 2],
      ["p3", 3],
    ]);
  });

  it("sudden-death: wrong answers eliminate from the clue and re-arm for the rest", () => {
    let game = finishedGame(
      { p1: 800, p2: 800, p3: 100 },
      { overrides: { end: { tieForFirst: "sudden-death" } } },
    );
    game = runOn(game, [
      { type: "arm-buzzers", at: 10_000 },
      { type: "buzz", at: 10_100, playerId: "p1" },
      { type: "judge", at: 10_200, verdict: "wrong" },
    ]);
    expect(game.state.phase).toBe("tiebreaker-armed");
    expect(applyExpectingRejection(game, { type: "buzz", at: 10_300, playerId: "p1" })).toBe(
      "locked-out",
    );
    // Everyone missing sends the clue dead; the host deals the next one, eliminations reset.
    game = runOn(game, [
      { type: "buzz", at: 10_400, playerId: "p2" },
      { type: "judge", at: 10_500, verdict: "wrong" },
    ]);
    expect(game.state.phase).toBe("tiebreaker-reading");
    game = runOn(game, [
      { type: "tiebreaker-next-clue", at: 11_000 },
      { type: "arm-buzzers", at: 11_100 },
      { type: "buzz", at: 11_200, playerId: "p1" },
      { type: "judge", at: 11_300, verdict: "correct" },
    ]);
    expect(game.state.winners).toEqual(["p1"]);
  });

  it("sudden-death: a dead buzz window resets for the next clue", () => {
    let game = finishedGame(
      { p1: 800, p2: 800, p3: 100 },
      { overrides: { end: { tieForFirst: "sudden-death" } } },
    );
    game = runOn(game, [
      { type: "arm-buzzers", at: 10_000 },
      { type: "buzz-timeout", at: 16_000 },
    ]);
    expect(game.state.phase).toBe("tiebreaker-reading");
    game = runOn(game, [
      { type: "arm-buzzers", at: 17_000 },
      { type: "buzz", at: 17_100, playerId: "p1" },
      { type: "judge", at: 17_200, verdict: "correct" },
    ]);
    expect(game.state.winners).toEqual(["p1"]);
  });
});

describe("matrix #38: all-non-positive finish", () => {
  it("highest-wins (party default): someone is crowned anyway", () => {
    const game = finishedGame({ p1: -100, p2: -400, p3: 0 });
    expect(game.state.winners).toEqual(["p3"]);
    expect(eventsOfType(game.events, "game-over")[0]?.note).toBe("clean");
  });

  it("no-winner (tv preset): nobody wins", () => {
    const game = finishedGame(
      { p1: -100, p2: -400, p3: 0 },
      { preset: "tv", overrides: { end: { tieForFirst: "co-champions" } } },
    );
    expect(game.state.winners).toEqual([]);
    expect(eventsOfType(game.events, "game-over")[0]?.note).toBe("no-winner");
  });
});

// Owner report 2026-08-20: "there is no end game button for the host." There genuinely was no
// way to end a game short of playing the board out - `end-round` finishes a ROUND and leaves
// whatever comes next still ahead - so a quiz night that ran long had no ending, and the only
// workaround was closing the ROOM, which is not an ending: it is every screen going dark with
// no scores on it.
describe("the host's own ending (end-game)", () => {
  it("ends the game where it stands, with the scores as they are", () => {
    const game = stoppedMidGame({ p1: 600, p2: 200, p3: 100 });
    expect(game.state.phase).toBe("game-over");
    expect(game.state.winners).toEqual(["p1"]);
    const over = eventsOfType(game.events, "game-over")[0];
    expect(over?.note).toBe("ended-early");
    expect(over?.standings.map((entry) => [entry.entityId, entry.score])).toEqual([
      ["p1", 600],
      ["p2", 200],
      ["p3", 100],
    ]);
    // Cells are still hidden - that is what "ended early" MEANS, and a display that redrew
    // the board as finished would be lying about the night.
    expect(hiddenCells(game.state).length).toBeGreaterThan(0);
  });

  // The difference from every other path into game-over. `finishGame` opens sudden death on a
  // tie for first; a host who is stopping the game is not asking for one more clue.
  it("leaves a tie for first TIED instead of opening sudden death", () => {
    const game = stoppedMidGame(
      { p1: 400, p2: 400, p3: 0 },
      { overrides: { end: { tieForFirst: "sudden-death" } } },
    );
    expect(game.state.phase).toBe("game-over");
    expect(game.state.winners).toEqual(["p1", "p2"]);
    expect(game.state.tiebreaker).toBeNull();
    expect(eventsOfType(game.events, "tiebreaker-started")).toHaveLength(0);
  });

  // The one rule it DOES keep: a host stopping early must not mint a champion the room's own
  // settings forbid (#38).
  it("still refuses to crown anybody when nobody may win", () => {
    const game = stoppedMidGame(
      { p1: 0, p2: -200, p3: -400 },
      { overrides: { end: { allNonPositiveFinish: "no-winner" } } },
    );
    expect(game.state.winners).toEqual([]);
    expect(eventsOfType(game.events, "game-over")[0]?.note).toBe("ended-early");
  });

  it("ends a game stopped MID-CLUE, without judging the clue that was open", () => {
    let game = startedGame(testSetup({ rounds: [{ columns: 3, rows: 3 }] }));
    game = runOn(game, [{ type: "select-cell", at: 3000, category: 0, row: 0 }]);
    expect(game.state.phase).not.toBe("awaiting-selection");
    game = runOn(game, [{ type: "end-game", at: 3500 }]);
    expect(game.state.phase).toBe("game-over");
  });

  it("refuses once the game is already over - there is one ending, not two", () => {
    expect(
      applyExpectingRejection(stoppedMidGame({ p1: 100 }), { type: "end-game", at: 5000 }),
    ).toBe("already-over");
  });

  it("refuses in the lobby, where there is nothing to show scores for", () => {
    const lobby = run(testSetup(), joinActions(2));
    expect(lobby.state.phase).toBe("lobby");
    expect(applyExpectingRejection(lobby, { type: "end-game", at: 2000 })).toBe("not-started");
  });
});
