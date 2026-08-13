// Scenario fixtures: a named JSON file that IS a replayable game - compact board material,
// settings as preset + sparse overrides (the same layering as rule sets), a seed, and the
// action array. fixtures/*.json replay through the unit tests today; M3 bots and the M4
// simulation panel consume the same format (owner directive "Development simulation").
import { resolvePreset, settingsOverridesSchema, settingsPresetIdSchema } from "@jeopardy/protocol";
import { z } from "zod";
import { gameActionSchema } from "./actions.ts";
import { plainRoundSetup } from "./setup.ts";
import type { GameSetup, PlainBoardSetup } from "./setup.ts";

const boardSchema = z.strictObject({
  columns: z.int().min(3).max(6),
  rows: z.int().min(3).max(6),
  rowValues: z.array(z.int().positive()).optional(),
  valueMultiplier: z.number().positive().optional(),
  wagerPlacement: z.enum(["auto", "manual"]).optional(),
  authoredWagers: z.array(z.tuple([z.int().nonnegative(), z.int().nonnegative()])).optional(),
});

export const scenarioFixtureSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  seed: z.string().min(1),
  preset: settingsPresetIdSchema.default("casual-party"),
  overrides: settingsOverridesSchema.prefault({}),
  rounds: z.array(boardSchema).min(1).max(4),
  hasFinalClue: z.boolean().default(false),
  actions: z.array(gameActionSchema),
  // Light self-describing expectations; the replaying test asserts them. Deeper checks
  // (event shapes, intermediate states) belong in the test files themselves.
  expect: z
    .strictObject({
      phase: z.string().optional(),
      scores: z.record(z.string(), z.number().int()).optional(),
      winners: z.array(z.string()).optional(),
      rejectedCount: z.int().nonnegative().optional(),
    })
    .prefault({}),
});

export type ScenarioFixture = z.infer<typeof scenarioFixtureSchema>;

export function parseScenarioFixture(raw: unknown): ScenarioFixture {
  return scenarioFixtureSchema.parse(raw);
}

export function setupFromFixture(fixture: ScenarioFixture): GameSetup {
  return {
    settings: resolvePreset(fixture.preset, fixture.overrides),
    rounds: fixture.rounds.map((board) => plainRoundSetup(board as PlainBoardSetup)),
    hasFinalClue: fixture.hasFinalClue,
    seed: fixture.seed,
  };
}
