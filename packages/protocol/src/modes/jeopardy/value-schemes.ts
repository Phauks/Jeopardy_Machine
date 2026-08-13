// Row-value schemes (rules-matrix #3). A game definition carries either a named preset or
// custom per-row values; the settings' structure group holds the same shape as an authoring
// GENERATOR for new boards, but once authored, the definition is truth (proposal section 3,
// deliberate call 3).
import { z } from "zod";

export const valueSchemePresetIdSchema = z.enum([
  "tv", // current TV: 200 per row, doubled in round two by the multiplier
  "classic", // pre-2001 dollars: 100 per row
  "points", // plain points: 100 per row, no currency connotation
]);

export type ValueSchemePresetId = z.infer<typeof valueSchemePresetIdSchema>;

export const valueSchemeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("preset"), preset: valueSchemePresetIdSchema }),
  z.strictObject({
    kind: z.literal("custom"),
    // Lowest row first. Length must match the board's row count - lint checks that against
    // the authored grid, not the schema (grids are per-round, schemes are per-game).
    rowValues: z.array(z.int().positive().max(1_000_000)).min(3).max(6),
  }),
]);

export type ValueScheme = z.infer<typeof valueSchemeSchema>;

const presetRowStep: Record<ValueSchemePresetId, number> = { tv: 200, classic: 100, points: 100 };

// Concrete row values for any board height: every preset is linear in the row index (the TV
// pattern), so 4-row or 6-row boards get sensible values without a lookup table per height.
export function presetRowValues(preset: ValueSchemePresetId, rowCount: number): number[] {
  return Array.from({ length: rowCount }, (_, index) => presetRowStep[preset] * (index + 1));
}
