// Rules-matrix rows 23-28: hidden wager cells ("Daily Double" on TV - genericized here, never
// the show's name, per the trademark notes in docs/research/01-game-anatomy.md section 7).
// Count and placement act as inputs to wagerPlacement:"auto" in the game definition; a
// hand-placed board always wins over these settings (proposal section 3, deliberate call 3).
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const wagersGroup = defineSettingsGroup({
  id: "wagers",
  label: "Wager cells",
  description: "Hidden wager cells: how many, where, and the betting rules.",
  settings: {
    label: defineSetting({
      matrixRow: 28,
      label: "Wager cell label",
      description:
        "What the splash screen calls it. Any short phrase except the trademarked TV name.",
      schema: z.string().min(1).max(30).default("Double Down"),
    }),
    countRoundOne: defineSetting({
      matrixRow: 23,
      label: "Wager cells, round one",
      description: "Hidden wager cells auto-placed in the first board round (TV: 1).",
      schema: z.int().min(0).max(4).default(1),
    }),
    countRoundTwo: defineSetting({
      matrixRow: 23,
      label: "Wager cells, round two",
      description:
        "Hidden wager cells auto-placed in the second board round (TV: 2, never two in one category).",
      schema: z.int().min(0).max(4).default(2),
    }),
    autoPlacement: defineSetting({
      matrixRow: 24,
      label: "Auto placement",
      description:
        "weighted-realistic mirrors 13,600 aired placements (row-4-heavy, never the top row); uniform draws from rows 2 down.",
      schema: z.enum(["weighted-realistic", "uniform"]).default("weighted-realistic"),
    }),
    minimumWager: defineSetting({
      matrixRow: 25,
      label: "Minimum wager",
      description: "Lowest allowed bet on a wager cell (TV: 5).",
      schema: z.int().min(0).max(10_000).default(5),
    }),
    maximumWagerRule: defineSetting({
      matrixRow: 26,
      label: "Maximum wager rule",
      description:
        "tv: the greater of current score and the round's top row value (a trailing player can still bet big). score-only: current score caps the bet. unlimited: no cap.",
      schema: z.enum(["tv", "score-only", "unlimited"]).default("tv"),
    }),
    wagerTimerMs: defineSetting({
      matrixRow: 27,
      label: "Wager entry timer",
      description: "Time to commit a wager before the clue shows; null is host-paced.",
      schema: z.int().min(10_000).max(120_000).nullable().default(30_000),
    }),
  },
  refinements: [],
});
