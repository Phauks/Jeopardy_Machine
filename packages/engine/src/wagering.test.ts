import { describe, expect, it } from "vitest";
import { simulate } from "./simulate.ts";
import {
  applyExpectingRejection,
  eventsOfType,
  joinActions,
  runOn,
  startedGame,
  testSetup,
} from "./testing.ts";
import type { Run } from "./testing.ts";
import type { TestSetupOptions } from "./testing.ts";

/** A 3x3 round with the middle cell (1,1) authored as the wager cell - deterministic. */
function wagerSetupOptions(overrides: TestSetupOptions["overrides"] = {}): TestSetupOptions {
  return {
    rounds: [{ columns: 3, rows: 3, wagerPlacement: "manual", authoredWagers: [[1, 1]] }],
    overrides,
    seed: "wager-tests",
  };
}

/** Give the controller a known score, then hit the wager cell. */
function atWagerPrompt(options: TestSetupOptions, controllerScore: number): Run {
  let game = startedGame(testSetup(options));
  const controller = game.state.controlEntity ?? "p1";
  game = runOn(game, [
    { type: "score-set", at: 2050, entityId: controller, score: controllerScore },
    { type: "select-cell", at: 2100, category: 1, row: 1 },
  ]);
  return game;
}

describe("wager cells (matrix #23-#28)", () => {
  it("hitting the cell prompts the SELECTOR with range and label; buzzing is impossible", () => {
    const game = atWagerPrompt(wagerSetupOptions(), 1000);
    expect(game.state.phase).toBe("wagering");
    const prompt = eventsOfType(game.events, "wager-cell-hit")[0];
    expect(prompt).toMatchObject({
      label: "Double Down",
      entityId: game.state.controlEntity,
      minimum: 5,
      maximum: 1000, // score 1000 > top row 600
    });
    expect(applyExpectingRejection(game, { type: "buzz", at: 2200, playerId: "p2" })).toBe(
      "not-armed",
    );
  });

  it("matrix #28: the label is configurable", () => {
    const game = atWagerPrompt(wagerSetupOptions({ wagers: { label: "Wild Wager" } }), 100);
    expect(eventsOfType(game.events, "wager-cell-hit")[0]?.label).toBe("Wild Wager");
  });

  it("matrix #26 tv rule: a trailing (even negative) player may still bet the top row value", () => {
    const game = atWagerPrompt(wagerSetupOptions(), -400);
    const prompt = eventsOfType(game.events, "wager-cell-hit")[0];
    expect(prompt?.maximum).toBe(600); // top row of a 3-row tv board
  });

  it("matrix #26 score-only: the score caps the bet (floored at the minimum)", () => {
    const game = atWagerPrompt(
      wagerSetupOptions({ wagers: { maximumWagerRule: "score-only" } }),
      350,
    );
    expect(eventsOfType(game.events, "wager-cell-hit")[0]?.maximum).toBe(350);
    const broke = atWagerPrompt(
      wagerSetupOptions({ wagers: { maximumWagerRule: "score-only" } }),
      -100,
    );
    expect(eventsOfType(broke.events, "wager-cell-hit")[0]?.maximum).toBe(5);
  });

  it("matrix #26 unlimited: no cap", () => {
    const game = atWagerPrompt(
      wagerSetupOptions({ wagers: { maximumWagerRule: "unlimited" } }),
      10,
    );
    const committed = runOn(game, [{ type: "commit-wager", at: 2200, amount: 50_000 }]);
    expect(committed.state.clue?.wager).toBe(50_000);
  });

  it("matrix #25: bets below the minimum (and above the maximum) are rejected", () => {
    const game = atWagerPrompt(wagerSetupOptions(), 1000);
    expect(applyExpectingRejection(game, { type: "commit-wager", at: 2200, amount: 4 })).toBe(
      "wager-out-of-range",
    );
    expect(applyExpectingRejection(game, { type: "commit-wager", at: 2200, amount: 1001 })).toBe(
      "wager-out-of-range",
    );
  });

  it("true double: wager the whole score, win doubles it", () => {
    let game = atWagerPrompt(wagerSetupOptions(), 800);
    const controller = game.state.controlEntity ?? "p1";
    game = runOn(game, [
      { type: "commit-wager", at: 2200, amount: 800 },
      { type: "judge", at: 2300, verdict: "correct" },
    ]);
    expect(game.state.scores[controller]).toBe(1600);
  });

  it("wrong answer costs the wager and the selector KEEPS the pick (TV rule)", () => {
    let game = atWagerPrompt(wagerSetupOptions(), 800);
    const controller = game.state.controlEntity ?? "p1";
    game = runOn(game, [
      { type: "commit-wager", at: 2200, amount: 600 },
      { type: "judge", at: 2300, verdict: "wrong" },
    ]);
    expect(game.state.scores[controller]).toBe(200);
    expect(game.state.controlEntity).toBe(controller);
    expect(game.state.phase).toBe("awaiting-selection");
  });

  it("matrix #17 floor-at-zero also floors wager losses", () => {
    let game = atWagerPrompt(
      wagerSetupOptions({ scoring: { wrongAnswerPenalty: "floor-at-zero" } }),
      100,
    );
    const controller = game.state.controlEntity ?? "p1";
    game = runOn(game, [
      { type: "commit-wager", at: 2200, amount: 600 },
      { type: "judge", at: 2300, verdict: "wrong" },
    ]);
    expect(game.state.scores[controller]).toBe(0);
  });

  it("matrix #18: the answer timeout treats the wager like a wrong answer", () => {
    let game = atWagerPrompt(wagerSetupOptions(), 800);
    const controller = game.state.controlEntity ?? "p1";
    game = runOn(game, [
      { type: "commit-wager", at: 2200, amount: 500 },
      { type: "answer-timeout", at: 9000 },
    ]);
    expect(game.state.scores[controller]).toBe(300);
  });

  it("matrix #27: the entry timer expiry force-commits the minimum", () => {
    let game = atWagerPrompt(wagerSetupOptions(), 800);
    game = runOn(game, [{ type: "wager-timeout", at: 40_000 }]);
    expect(game.state.phase).toBe("wager-answering");
    const committed = eventsOfType(game.events, "wager-committed")[0];
    expect(committed).toMatchObject({ amount: 5, forced: true });
  });

  it("matrix #27 null: host-paced, no timer hint", () => {
    const game = atWagerPrompt(wagerSetupOptions({ wagers: { wagerTimerMs: null } }), 800);
    const hints = eventsOfType(game.events, "timer-set").filter(
      (event) => event.kind === "wager-entry",
    );
    expect(hints).toHaveLength(0);
  });
});

function placementSetup(seed: string, countRoundOne: number, uniform = false) {
  return testSetup({
    rounds: [{ columns: 6, rows: 5 }],
    overrides: {
      wagers: {
        countRoundOne,
        autoPlacement: uniform ? "uniform" : "weighted-realistic",
      },
    },
    seed,
  });
}

describe("matrix #23/#24: auto placement", () => {
  it("places the configured count, never in the top row, all in distinct categories", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const game = startedGame(placementSetup(seed, 4));
      const cells = game.state.boards[0]?.wagerCells ?? [];
      expect(cells).toHaveLength(4);
      const categories = cells.map((key) => key.split(":")[0]);
      expect(new Set(categories).size).toBe(4);
      for (const key of cells) {
        expect(key.split(":")[1]).not.toBe("0");
      }
    }
  });

  it("placement is seed-deterministic", () => {
    const first = startedGame(placementSetup("same-seed", 2));
    const second = startedGame(placementSetup("same-seed", 2));
    expect(first.state.boards[0]?.wagerCells).toEqual(second.state.boards[0]?.wagerCells);
  });

  it("uniform mode also avoids the top row", () => {
    const game = startedGame(placementSetup("uniform-seed", 3, true));
    for (const key of game.state.boards[0]?.wagerCells ?? []) {
      expect(key.split(":")[1]).not.toBe("0");
    }
  });

  it("count zero places nothing", () => {
    const game = startedGame(placementSetup("zero", 0));
    expect(game.state.boards[0]?.wagerCells).toEqual([]);
  });

  it("a wager cell hit with NO controlling entity plays as a plain clue (host-picks)", () => {
    const setup = testSetup({
      rounds: [{ columns: 3, rows: 3, wagerPlacement: "manual", authoredWagers: [[0, 0]] }],
      overrides: {
        boardControl: { nextSelector: "host-picks", firstSelectorRoundOne: "host-picks" },
      },
    });
    const result = simulate(
      [
        ...joinActions(2),
        { type: "start-game", at: 2000 },
        { type: "select-cell", at: 2100, category: 0, row: 0 },
      ],
      setup,
    );
    expect(result.state.phase).toBe("reading");
    expect(result.state.clue?.isWagerClue).toBe(false);
    expect(eventsOfType(result.events, "wager-cell-hit")).toHaveLength(0);
  });
});

describe("wager cells and rebounds never mix", () => {
  it("the wager clue never arms buzzers, even after a wrong answer", () => {
    let game = atWagerPrompt(wagerSetupOptions(), 800);
    game = runOn(game, [{ type: "commit-wager", at: 2200, amount: 100 }]);
    expect(applyExpectingRejection(game, { type: "arm-buzzers", at: 2300 })).toBe("not-reading");
    game = runOn(game, [{ type: "judge", at: 2400, verdict: "wrong" }]);
    // Clue is closed - no rebound phase for wager clues.
    expect(game.state.phase).toBe("awaiting-selection");
    expect(eventsOfType(game.events, "rebound-armed")).toHaveLength(0);
  });
});
