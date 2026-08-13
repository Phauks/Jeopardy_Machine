// Rules-matrix rows 29-33: the final round - simultaneous written wagers and answers.
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const finalGroup = defineSettingsGroup({
  id: "final",
  label: "Final round",
  description: "The all-play wager round after the boards.",
  settings: {
    enabled: defineSetting({
      matrixRow: 29,
      label: "Final round enabled",
      description:
        "Play a final round after the last board round. A game definition with no authored final slot also skips it.",
      schema: z.boolean().default(true),
    }),
    eligibility: defineSetting({
      matrixRow: 30,
      label: "Eligibility",
      description:
        "positive-score-only is the TV rule (zero or less sits out); everyone lets all players wager at least the minimum stake.",
      schema: z.enum(["positive-score-only", "everyone"]).default("positive-score-only"),
    }),
    wagerRule: defineSetting({
      matrixRow: 31,
      label: "Wager range",
      description:
        "zero-to-score is the TV rule (nobody can finish the final below zero); fixed-stake puts the same amount on the line for everyone.",
      schema: z.enum(["zero-to-score", "fixed-stake"]).default("zero-to-score"),
    }),
    fixedStakeAmount: defineSetting({
      matrixRow: 31,
      label: "Fixed stake amount",
      description: "The stake everyone risks under the fixed-stake rule.",
      constraints: "Only read when the wager range is fixed-stake.",
      schema: z.int().min(0).max(100_000).default(100),
    }),
    writingTimerMs: defineSetting({
      matrixRow: 32,
      label: "Writing timer",
      description: "Time to type the final answer (TV: 30 seconds - the think-music length).",
      schema: z.int().min(10_000).max(120_000).default(30_000),
    }),
    revealStyle: defineSetting({
      matrixRow: 33,
      label: "Reveal style",
      description:
        "lowest-first is the TV drama order, right for up to ~6 players/teams. top-contenders reveals the top few individually and batches the rest; leaderboard animates the whole standings - both exist because sequential reveal of 100 players is too slow.",
      schema: z.enum(["lowest-first", "top-contenders", "leaderboard"]).default("lowest-first"),
    }),
  },
  refinements: [],
});
