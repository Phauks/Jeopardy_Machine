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
    // ROW 18 IS GONE, and so is the setting that was briefly added above it.
    //
    // It asked what a timeout COSTS, which presupposed that a timeout was a verdict at all. On
    // television it is: the contestant had their five seconds and the show moves. The owner
    // rejected that on 2026-08-20 - "Just because it times out, doesn't mean it was wrong.
    // People will be discussing the question" - and it was first answered with a CHOICE
    // between the TV rule and deferring to the host.
    //
    // The choice went the same day, on the sharper statement behind it: "all scoring is
    // manual, remove it counts as wrong option." Which is the truer description of this
    // product - a host with a microphone judges every answer in this room, and the only
    // verdicts the engine has ever applied on its own were the ones a clock produced. An
    // expired answer window is now purely information ("you are over time"): no score moves,
    // nobody is locked out, the clue stays open on the same buzz winner, and the host judges
    // when the room has finished talking. There is no setting because there is no longer a
    // second behaviour to select.
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
