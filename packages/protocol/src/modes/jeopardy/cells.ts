// A board cell: a REFERENCE to a content item, never the item itself - the game definition
// is a presentation of content, not its owner (guiding principle 6). Prompt/answer text is
// never duplicated into the board.
import { z } from "zod";
import { idSchema } from "../../ids.ts";

export const cellSchema = z.strictObject({
  itemId: idSchema, // -> content-item in the game's content pack
  value: z.int().positive().max(1_000_000).optional(), // omitted = row value from the scheme
  // Manual wager-cell placement. Authored data ALWAYS wins over settings: rules-matrix
  // #23/#24 (count, placement weighting) only feed wagerPlacement:"auto" (board.ts); a
  // hand-placed cell with wager:true is truth.
  wager: z.boolean().default(false),
});

export type Cell = z.infer<typeof cellSchema>;
