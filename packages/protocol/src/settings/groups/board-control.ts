// Rules-matrix rows 7-10: who picks the next clue, and how long they get to dither.
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const boardControlGroup = defineSettingsGroup({
  id: "boardControl",
  label: "Board control",
  description: "Who selects the next clue and when.",
  settings: {
    nextSelector: defineSetting({
      matrixRow: 7,
      label: "Next clue selector",
      description:
        "last-correct is the TV rule; auto-sweep plays cells top-to-bottom with no choosing (faster, less strategy).",
      schema: z
        .enum(["last-correct", "rotate", "host-picks", "auto-sweep"])
        .default("last-correct"),
    }),
    firstSelectorRoundOne: defineSetting({
      matrixRow: 8,
      label: "First selector, round one",
      description: "Who picks the first clue of the game.",
      schema: z.enum(["random", "host-picks"]).default("random"),
    }),
    firstSelectorRoundTwo: defineSetting({
      matrixRow: 9,
      label: "First selector, round two",
      description: "lowest-score is the TV rule (trailing player opens the second board).",
      schema: z.enum(["lowest-score", "same-as-round-one"]).default("lowest-score"),
    }),
    selectionShotClockMs: defineSetting({
      matrixRow: 10,
      label: "Selection shot clock",
      description: "Time limit for choosing a clue; null lets the host prod stallers instead.",
      schema: z.int().min(5000).max(60_000).nullable().default(null),
    }),
  },
  refinements: [],
});
