import { describe, expect, it } from "vitest";
import {
  applyExpectingRejection,
  eventsOfType,
  runOn,
  startedGame,
  testSetup,
  winClue,
} from "./testing.ts";
import type { Run } from "./testing.ts";

function selectAsHost(game: Run, category: number, row: number, at: number): Run {
  return runOn(game, [{ type: "select-cell", at, category, row }]);
}

describe("matrix #8: first selector, round one", () => {
  it("random draws a seeded entity and grants control", () => {
    const game = startedGame(testSetup({ seed: "selector-a" }));
    expect(game.state.controlEntity).not.toBeNull();
    expect(game.state.entityOrder).toContain(game.state.controlEntity);
    const assignment = eventsOfType(game.events, "control-assigned")[0];
    expect(assignment?.reason).toBe("first-selector");
  });

  it("the draw is seed-deterministic", () => {
    const first = startedGame(testSetup({ seed: "selector-b" }));
    const second = startedGame(testSetup({ seed: "selector-b" }));
    expect(first.state.controlEntity).toBe(second.state.controlEntity);
  });

  it("host-picks leaves control with nobody", () => {
    const game = startedGame(
      testSetup({ overrides: { boardControl: { firstSelectorRoundOne: "host-picks" } } }),
    );
    expect(game.state.controlEntity).toBeNull();
  });
});

describe("selection validation", () => {
  it("the controller selects; another entity is rejected; the host may always select", () => {
    const game = startedGame(testSetup({ seed: "selector-a" }));
    const controller = game.state.controlEntity;
    const other = game.state.entityOrder.find((entityId) => entityId !== controller);
    expect(
      applyExpectingRejection(game, {
        type: "select-cell",
        at: 2100,
        category: 0,
        row: 0,
        entityId: other,
      }),
    ).toBe("not-your-turn");
    const selectedBySelf = runOn(game, [
      { type: "select-cell", at: 2100, category: 0, row: 0, entityId: controller ?? "p1" },
    ]);
    expect(selectedBySelf.state.phase).toBe("reading");
    const selectedByHost = selectAsHost(game, 0, 0, 2100);
    expect(selectedByHost.state.phase).toBe("reading");
    expect(selectedByHost.state.clue?.selectedBy).toBe(controller);
  });

  it("played and out-of-bounds cells are rejected", () => {
    let game = startedGame(testSetup());
    game = selectAsHost(game, 0, 0, 2100);
    game = runOn(game, [
      { type: "arm-buzzers", at: 2200 },
      { type: "buzz-timeout", at: 8000 },
    ]);
    expect(
      applyExpectingRejection(game, { type: "select-cell", at: 8100, category: 0, row: 0 }),
    ).toBe("cell-already-played");
    expect(
      applyExpectingRejection(game, { type: "select-cell", at: 8100, category: 9, row: 0 }),
    ).toBe("no-such-cell");
  });
});

describe("matrix #7: next clue selector", () => {
  it("last-correct: the correct answerer takes the pick", () => {
    let game = startedGame(testSetup({ seed: "selector-a" }));
    game = selectAsHost(game, 0, 0, 2100);
    game = winClue(game, "p2", 2200);
    expect(game.state.controlEntity).toBe("p2");
    expect(game.state.phase).toBe("awaiting-selection");
  });

  it("last-correct: control does NOT move on a dead clue", () => {
    let game = startedGame(testSetup({ seed: "selector-a" }));
    const controller = game.state.controlEntity;
    game = selectAsHost(game, 0, 0, 2100);
    game = runOn(game, [
      { type: "arm-buzzers", at: 2200 },
      { type: "buzz-timeout", at: 8000 },
    ]);
    expect(game.state.controlEntity).toBe(controller);
  });

  it("rotate: control advances in join order every played clue, correct or not", () => {
    let game = startedGame(
      testSetup({ overrides: { boardControl: { nextSelector: "rotate" } }, seed: "rotate-1" }),
    );
    const first = game.state.controlEntity;
    expect(first).not.toBeNull();
    game = selectAsHost(game, 0, 0, 2100);
    game = runOn(game, [
      { type: "arm-buzzers", at: 2200 },
      { type: "buzz-timeout", at: 8000 },
    ]);
    const order = game.state.entityOrder;
    const expected = order[(order.indexOf(first ?? "") + 1) % order.length];
    expect(game.state.controlEntity).toBe(expected);
  });

  it("host-picks: players may not select at all", () => {
    const game = startedGame(
      testSetup({
        overrides: {
          boardControl: { nextSelector: "host-picks", firstSelectorRoundOne: "host-picks" },
        },
      }),
    );
    expect(
      applyExpectingRejection(game, {
        type: "select-cell",
        at: 2100,
        category: 0,
        row: 0,
        entityId: "p1",
      }),
    ).toBe("host-picks-only");
    const hostSelected = selectAsHost(game, 0, 0, 2100);
    expect(hostSelected.state.phase).toBe("reading");
    expect(hostSelected.state.clue?.selectedBy).toBeNull();
  });

  it("auto-sweep: cells present themselves top-to-bottom, category by category", () => {
    let game = startedGame(
      testSetup({ overrides: { boardControl: { nextSelector: "auto-sweep" } } }),
    );
    // Round start goes straight into reading the first cell - no selection phase.
    expect(game.state.phase).toBe("reading");
    expect(game.state.clue).toMatchObject({ category: 0, row: 0 });
    game = runOn(game, [
      { type: "arm-buzzers", at: 2200 },
      { type: "buzz-timeout", at: 8000 },
    ]);
    expect(game.state.phase).toBe("reading");
    expect(game.state.clue).toMatchObject({ category: 0, row: 1 });
    const selections = eventsOfType(game.events, "cell-selected");
    expect(selections.every((event) => event.autoSelected)).toBe(true);
  });
});

describe("matrix #10: selection shot clock", () => {
  it("emits the timer hint and auto-picks a random hidden cell on expiry", () => {
    let game = startedGame(
      testSetup({
        overrides: { boardControl: { selectionShotClockMs: 10_000 } },
        seed: "shot-clock",
      }),
    );
    const hint = eventsOfType(game.events, "timer-set").find(
      (event) => event.kind === "selection-shot-clock",
    );
    expect(hint?.durationMs).toBe(10_000);
    game = runOn(game, [{ type: "selection-timeout", at: 12_000 }]);
    expect(game.state.phase).toBe("reading");
    expect(eventsOfType(game.events, "cell-selected")[0]?.autoSelected).toBe(true);
  });

  it("a stale expiry outside awaiting-selection is rejected harmlessly", () => {
    let game = startedGame(testSetup());
    game = selectAsHost(game, 0, 0, 2100);
    expect(applyExpectingRejection(game, { type: "selection-timeout", at: 9000 })).toBe(
      "not-selecting",
    );
  });
});

describe("host board repairs", () => {
  it("reopen-cell brings a played cell back", () => {
    let game = startedGame(testSetup());
    game = selectAsHost(game, 0, 0, 2100);
    game = winClue(game, "p1", 2200);
    game = runOn(game, [{ type: "reopen-cell", at: 3000, category: 0, row: 0 }]);
    expect(game.state.boards[0]?.status[0]?.[0]).toBe("hidden");
    game = selectAsHost(game, 0, 0, 3100);
    expect(game.state.phase).toBe("reading");
  });

  it("reopening a hidden cell is rejected", () => {
    const game = startedGame(testSetup());
    expect(
      applyExpectingRejection(game, { type: "reopen-cell", at: 3000, category: 0, row: 0 }),
    ).toBe("cell-not-played");
  });
});
