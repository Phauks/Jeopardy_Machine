// Rules-matrix rows 1-6: game structure. Board size and value scheme double as authoring-time
// generators - where a game definition is concrete (grid shape, row values), the DEFINITION is
// truth and these settings only seed new boards (proposal section 3, deliberate call 3).
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const valueSchemeSettingSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("preset"),
      // tv = 200..1000 doubled in round two; classic = pre-2001 100..500; points = plain
      // 100..500 with no currency connotation.
      preset: z.enum(["tv", "classic", "points"]),
    }),
    z.strictObject({
      kind: z.literal("custom"),
      rowValues: z.array(z.int().positive().max(1_000_000)).min(3).max(6),
    }),
  ])
  .default({ kind: "preset", preset: "tv" });

export const structureGroup = defineSettingsGroup({
  id: "structure",
  label: "Game structure",
  description: "Rounds, board size, and what a cell is worth.",
  settings: {
    roundCount: defineSetting({
      matrixRow: 1,
      label: "Board rounds",
      description:
        "How many board rounds are played. The final round is its own toggle (final group).",
      schema: z.int().min(1).max(4).default(2),
    }),
    boardColumns: defineSetting({
      matrixRow: 2,
      label: "Categories per round",
      description: "Columns on the board.",
      schema: z.int().min(3).max(6).default(6),
    }),
    boardRows: defineSetting({
      matrixRow: 2,
      label: "Clues per category",
      description: "Rows on the board.",
      schema: z.int().min(3).max(6).default(5),
    }),
    valueScheme: defineSetting({
      matrixRow: 3,
      label: "Value scheme",
      description: "Row values: a named preset or custom per-row values, lowest row first.",
      constraints: "Custom row values must match the clues-per-category row count.",
      schema: valueSchemeSettingSchema,
    }),
    currencyLabel: defineSetting({
      matrixRow: 4,
      label: "Currency label",
      description: 'What scores are denominated in: "$", "points", or any short custom label.',
      schema: z.string().min(1).max(12).default("$"),
    }),
    roundTwoValueMultiplier: defineSetting({
      matrixRow: 5,
      label: "Round two multiplier",
      description: "Multiplies row values in the second board round (TV doubles them).",
      schema: z.int().min(1).max(10).default(2),
    }),
    roundTimeLimitMs: defineSetting({
      matrixRow: 6,
      label: "Round time limit",
      description:
        "Wall-clock limit per board round; null plays the board out (TV forfeits uncalled clues, a digital game need not).",
      schema: z.int().min(60_000).max(3_600_000).nullable().default(null),
    }),
  },
  refinements: [
    {
      id: "custom-values-match-rows",
      description: "A custom value scheme must list exactly one value per board row.",
      path: "valueScheme",
      valid: (value) =>
        value.valueScheme.kind !== "custom" ||
        value.valueScheme.rowValues.length === value.boardRows,
    },
  ],
});
