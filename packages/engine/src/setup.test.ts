import { describe, expect, it } from "vitest";
import { gameDefinitionBodySchema, generateId } from "@jeopardy/protocol";
import { plainRoundSetup, playedRoundCount, setupFromGameDefinition } from "./setup.ts";
import { testSetup } from "./testing.ts";

describe("plainRoundSetup", () => {
  it("matrix #2/#3: builds any 3-6 x 3-6 board with tv ladder values by default", () => {
    const round = plainRoundSetup({ columns: 4, rows: 3 });
    expect(round.cells).toHaveLength(4);
    expect(round.cells[0]).toHaveLength(3);
    expect(round.cells[0]?.map((cell) => cell.value)).toEqual([200, 400, 600]);
    expect(round.topRowValue).toBe(600);
  });

  it("matrix #5: the multiplier scales every value and the wager ceiling", () => {
    const round = plainRoundSetup({ columns: 3, rows: 3, valueMultiplier: 2 });
    expect(round.cells[2]?.map((cell) => cell.value)).toEqual([400, 800, 1200]);
    expect(round.topRowValue).toBe(1200);
  });

  it("matrix #3: custom row values are used verbatim", () => {
    const round = plainRoundSetup({ columns: 3, rows: 3, rowValues: [10, 20, 50] });
    expect(round.cells[0]?.map((cell) => cell.value)).toEqual([10, 20, 50]);
  });

  it("authored wager marks land on the right cells", () => {
    const round = plainRoundSetup({
      columns: 3,
      rows: 3,
      wagerPlacement: "manual",
      authoredWagers: [[1, 2]],
    });
    expect(round.cells[1]?.[2]?.authoredWager).toBe(true);
    expect(round.cells[0]?.[0]?.authoredWager).toBe(false);
  });
});

describe("playedRoundCount", () => {
  it("matrix #1: settings cap the authored rounds", () => {
    const setup = testSetup({
      rounds: [
        { columns: 3, rows: 3 },
        { columns: 3, rows: 3 },
      ],
      overrides: { structure: { roundCount: 1 } },
    });
    expect(playedRoundCount(setup)).toBe(1);
  });

  it("fewer authored rounds than the setting plays what exists", () => {
    const setup = testSetup({ rounds: [{ columns: 3, rows: 3 }] });
    expect(setup.settings.structure.roundCount).toBe(2);
    expect(playedRoundCount(setup)).toBe(1);
  });
});

function definitionBody() {
  const itemIds = Array.from({ length: 9 }, () => generateId());
  return gameDefinitionBodySchema.parse({
    mode: "jeopardy",
    rounds: [
      {
        name: "Round one",
        valueMultiplier: 1,
        categories: Array.from({ length: 3 }, (_unusedCategory, categoryIndex) => ({
          title: `Category ${String(categoryIndex + 1)}`,
          cells: Array.from({ length: 3 }, (_unusedRow, rowIndex) => ({
            itemId: itemIds[categoryIndex * 3 + rowIndex],
            ...(categoryIndex === 0 && rowIndex === 1 ? { value: 777, wager: true } : {}),
          })),
        })),
        wagerPlacement: "manual",
      },
    ],
    final: { category: "Finale", itemId: generateId() },
    valueScheme: { kind: "preset", preset: "tv" },
    content: { kind: "external", packId: generateId() },
    rules: { kind: "preset", preset: "casual-party", overrides: {} },
    theme: { kind: "preset", preset: "modern-flat" },
  });
}

describe("setupFromGameDefinition", () => {
  it("resolves preset row values, honors authored cell values, and carries wager flags", () => {
    const setup = setupFromGameDefinition(definitionBody(), "seed-1");
    expect(setup.rounds).toHaveLength(1);
    expect(setup.rounds[0]?.cells[1]?.map((cell) => cell.value)).toEqual([200, 400, 600]);
    // Authored value is truth as-is (the definition owns its concrete numbers).
    expect(setup.rounds[0]?.cells[0]?.[1]?.value).toBe(777);
    expect(setup.rounds[0]?.cells[0]?.[1]?.authoredWager).toBe(true);
    expect(setup.rounds[0]?.wagerPlacement).toBe("manual");
    expect(setup.hasFinalClue).toBe(true);
    expect(setup.settings.structure.roundCount).toBe(2);
  });

  it("no authored final slot means no final, regardless of settings row #29", () => {
    const body = { ...definitionBody(), final: null };
    const setup = setupFromGameDefinition(body, "seed-1");
    expect(setup.hasFinalClue).toBe(false);
    expect(setup.settings.final.enabled).toBe(true);
  });
});
