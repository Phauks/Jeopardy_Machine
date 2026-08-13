import { describe, expect, it } from "vitest";
import { generateId } from "../../ids.ts";
import {
  gameDefinitionSchema,
  gameDefinitionSchemaVersion,
  resolveGameRules,
} from "./game-definition.ts";
import { presetRowValues } from "./value-schemes.ts";
import { ruleSetSchemaVersion } from "../../settings/rule-set.ts";

const meta = {
  title: "Club Night 2026",
  author: "Board Game Club",
  created: "2026-08-13T12:00:00.000Z",
  modified: "2026-08-13T12:00:00.000Z",
};

const itemIds = Array.from({ length: 10 }, () => generateId());

function category(title: string, ids: readonly string[]) {
  return { title, cells: ids.map((itemId) => ({ itemId })) };
}

const pack = {
  format: "content-pack",
  schemaVersion: "1.0.0",
  meta,
  body: {
    items: itemIds.map((id, index) => ({
      id,
      type: "basic",
      prompt: { text: `Prompt ${index}` },
      answer: { canonical: `Answer ${index}` },
    })),
  },
};

const validGame = {
  format: "game-definition",
  schemaVersion: gameDefinitionSchemaVersion,
  meta,
  body: {
    mode: "jeopardy",
    rounds: [
      {
        name: "Round One",
        categories: [
          category("Forests", itemIds.slice(0, 3)),
          category("Oceans", itemIds.slice(3, 6)),
          category("Meeples", itemIds.slice(6, 9)),
        ],
      },
    ],
    final: { category: "Stewardship", itemId: itemIds[9] },
    valueScheme: { kind: "preset", preset: "tv" },
    content: { kind: "embedded", pack },
  },
};

describe("gameDefinitionSchema", () => {
  it("accepts an embedded-content game and defaults rules, theme, and round knobs", () => {
    const parsed = gameDefinitionSchema.parse(validGame);
    expect(parsed.body.rules).toEqual({ kind: "preset", preset: "casual-party", overrides: {} });
    expect(parsed.body.theme).toEqual({ kind: "preset", preset: "modern-flat" });
    expect(parsed.body.rounds[0]?.wagerPlacement).toBe("auto");
    expect(parsed.body.rounds[0]?.valueMultiplier).toBe(1);
    expect(parsed.body.rounds[0]?.categories[0]?.cells[0]?.wager).toBe(false);
  });

  it("accepts external content with an optional pack hash", () => {
    const external = {
      ...validGame,
      body: {
        ...validGame.body,
        content: { kind: "external", packId: generateId(), sha256: "d".repeat(64) },
      },
    };
    expect(gameDefinitionSchema.safeParse(external).success).toBe(true);
    expect(
      gameDefinitionSchema.safeParse({
        ...validGame,
        body: {
          ...validGame.body,
          content: { kind: "external", packId: generateId(), sha256: "xyz" },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts manual wager placement with authored wager cells, and a null final", () => {
    const manual = structuredClone(validGame) as unknown as {
      body: {
        final: unknown;
        rounds: { wagerPlacement?: string; categories: { cells: { wager?: boolean }[] }[] }[];
      };
    };
    manual.body.final = null;
    const round = manual.body.rounds[0]!;
    round.wagerPlacement = "manual";
    round.categories[0]!.cells[2]!.wager = true;
    const parsed = gameDefinitionSchema.parse(manual);
    expect(parsed.body.final).toBeNull();
    expect(parsed.body.rounds[0]?.categories[0]?.cells[2]?.wager).toBe(true);
  });

  it("accepts an inline rule set and resolves rules from either attachment kind", () => {
    const withPresetRules = gameDefinitionSchema.parse({
      ...validGame,
      body: {
        ...validGame.body,
        rules: { kind: "preset", preset: "tv", overrides: { buzzing: { rebound: false } } },
      },
    });
    const presetResolved = resolveGameRules(withPresetRules.body.rules);
    expect(presetResolved.end.tieForFirst).toBe("sudden-death"); // tv base
    expect(presetResolved.buzzing.rebound).toBe(false); // per-game override

    const withInlineRules = gameDefinitionSchema.parse({
      ...validGame,
      body: {
        ...validGame.body,
        rules: {
          kind: "inline",
          ruleSet: {
            format: "rule-set",
            schemaVersion: ruleSetSchemaVersion,
            meta,
            body: { base: "tv", overrides: { scoring: { wrongAnswerPenalty: "none" } } },
          },
        },
      },
    });
    const inlineResolved = resolveGameRules(withInlineRules.body.rules);
    expect(inlineResolved.scoring.wrongAnswerPenalty).toBe("none");
    expect(inlineResolved.end.allNonPositiveFinish).toBe("no-winner");
  });

  it("round-trips parse -> serialize -> parse identically, ext included at every level", () => {
    const withExt = {
      ...validGame,
      ext: { "com.example.tournament": { round: 2 } },
      body: {
        ...validGame.body,
        content: {
          kind: "embedded",
          pack: { ...pack, ext: { "com.example.pack-note": "curated" } },
        },
      },
    };
    const first = gameDefinitionSchema.parse(withExt);
    const second = gameDefinitionSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it("rejects wrong modes, bad grids, and stray keys", () => {
    expect(
      gameDefinitionSchema.safeParse({
        ...validGame,
        body: { ...validGame.body, mode: "pub-quiz" },
      }).success,
    ).toBe(false);
    expect(
      gameDefinitionSchema.safeParse({
        ...validGame,
        body: {
          ...validGame.body,
          rounds: [{ name: "Tiny", categories: [category("Solo", itemIds.slice(0, 3))] }],
        },
      }).success,
    ).toBe(false); // fewer than 3 categories
    expect(
      gameDefinitionSchema.safeParse({ ...validGame, body: { ...validGame.body, host: "Trevor" } })
        .success,
    ).toBe(false);
  });

  it("rejects an embedded pack that is itself invalid - nesting does not launder documents", () => {
    const badPack = { ...pack, body: { items: [] } };
    expect(
      gameDefinitionSchema.safeParse({
        ...validGame,
        body: { ...validGame.body, content: { kind: "embedded", pack: badPack } },
      }).success,
    ).toBe(false);
  });
});

describe("presetRowValues", () => {
  it("scales linearly for any board height", () => {
    expect(presetRowValues("tv", 5)).toEqual([200, 400, 600, 800, 1000]);
    expect(presetRowValues("classic", 4)).toEqual([100, 200, 300, 400]);
    expect(presetRowValues("points", 3)).toEqual([100, 200, 300]);
  });
});
