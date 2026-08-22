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
    // OWNER, 2026-08-20: "Just because it times out, doesn't mean it was wrong. People will be
    // discussing the question." The matrix only ever asked what a timeout COSTS (row 18
    // below); it assumed a timeout was a verdict at all. On television it is - the contestant
    // had their five seconds and the game moves. In a room where six people are arguing about
    // the answer, a clock running out is not somebody being wrong, and the engine ending the
    // clue over it takes the decision away from the person holding the microphone.
    //
    // So this row asks the prior question, and row 18 is only read when the answer is
    // "counts-as-wrong":
    //
    //   counts-as-wrong - the TV rule. The window closes the attempt: deduct per row 18, lock
    //                     the answerer out, rebound to the rest or kill the clue.
    //   host-decides    - the window closes NOTHING. The clue stays open on the same buzz
    //                     winner, no score moves, nobody is locked out, and the host judges
    //                     when the room has finished talking. The timer becomes information
    //                     ("you are over time") rather than an adjudicator.
    answerTimeoutOutcome: defineSetting({
      matrixRow: null,
      label: "When the answer clock runs out",
      description:
        "counts-as-wrong is the TV rule: the window closes the attempt and the game moves on. host-decides leaves the clue open and the verdict with the host - the timer informs the room instead of judging it.",
      schema: z.enum(["counts-as-wrong", "host-decides"]).default("counts-as-wrong"),
    }),
    deductOnAnswerTimeout: defineSetting({
      matrixRow: 18,
      label: "Deduct on answer timeout",
      description:
        "Buzzing in and then running out the answer window is treated as a wrong answer (TV rule).",
      constraints: "Only read when the answer clock counts as wrong.",
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
