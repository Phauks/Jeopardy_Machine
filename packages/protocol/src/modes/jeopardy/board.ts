// The board grid: categories (columns) of cells (rows), grouped into rounds. Sizes mirror
// rules-matrix #2 (3-6 both ways). The GRAMMAR - category headers over value cells, clue
// fills cell, cell dies after play - is locked per boundary 2.4: sizes and values are data,
// the structure is not.
import { z } from "zod";
import { cellSchema } from "./cells.ts";

export const categorySchema = z.strictObject({
  title: z.string().min(1).max(80),
  cells: z.array(cellSchema).min(3).max(6), // rows
});

export type Category = z.infer<typeof categorySchema>;

export const roundSchema = z.strictObject({
  name: z.string().min(1).max(60),
  // R2 = 2 under TV rules (matrix #5); kept per round so a third or fourth round can scale.
  valueMultiplier: z.number().positive().max(10).default(1),
  categories: z.array(categorySchema).min(3).max(6), // columns
  // auto: the engine places wager cells at game start from the rule set (count + weighting,
  // matrix #23/#24). manual: exactly the cells authored wager:true - authored wins over
  // settings. Lint flags manual rounds with zero wager cells; the schema does not.
  wagerPlacement: z.enum(["auto", "manual"]).default("auto"),
});

export type Round = z.infer<typeof roundSchema>;
