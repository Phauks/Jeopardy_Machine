// Rules-matrix rows 17-19. Row 20 (host score override + undo) is deliberately NOT here: it
// is always on (guiding principle 4, boundary 2.8), so it is not representable as data - a
// setting that cannot be turned off is not a setting.
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const scoringGroup = defineSettingsGroup({
  id: "scoring",
  label: "Scoring",
  description: "What wrong answers and timeouts cost.",
  settings: {
    wrongAnswerPenalty: defineSetting({
      matrixRow: 17,
      label: "Wrong answer penalty",
      description:
        "deduct is the TV rule (negative scores are normal); floor-at-zero deducts but never below zero; none is the kids/casual mode.",
      schema: z.enum(["deduct", "floor-at-zero", "none"]).default("deduct"),
    }),
    deductOnAnswerTimeout: defineSetting({
      matrixRow: 18,
      label: "Deduct on answer timeout",
      description:
        "Buzzing in and then running out the answer window is treated as a wrong answer (TV rule).",
      schema: z.boolean().default(true),
    }),
    questionFormatRequired: defineSetting({
      matrixRow: 19,
      label: "Question format required",
      description:
        "Whether responses must be phrased as a question. strict-later-rounds is the TV rule (gentle reminder in round one, strictly enforced from round two); off is the natural default for typed answers.",
      schema: z.enum(["off", "host-reminder", "strict-later-rounds"]).default("off"),
    }),
  },
  refinements: [],
});
