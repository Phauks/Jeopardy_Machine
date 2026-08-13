// Rules-matrix rows 34-36: team play (docs/research/01-game-anatomy.md section 6).
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const teamsGroup = defineSettingsGroup({
  id: "teams",
  label: "Teams",
  description: "Individuals or teams, and how a team buzzes.",
  settings: {
    playerMode: defineSetting({
      matrixRow: 34,
      label: "Player mode",
      description: "Individual players or shared-score teams.",
      schema: z.enum(["individuals", "teams"]).default("individuals"),
    }),
    teamBuzzer: defineSetting({
      matrixRow: 35,
      label: "Team buzzer",
      description:
        "shared-phone: one phone per team (simplest and most robust). any-member: first buzz from any teammate counts. rotating-captain: one active buzzer per clue, rotated to keep everyone engaged.",
      constraints: "Only read in teams mode.",
      schema: z.enum(["shared-phone", "any-member", "rotating-captain"]).default("shared-phone"),
    }),
    teamWideEarlyBuzzPenalty: defineSetting({
      matrixRow: 36,
      label: "Team-wide early-buzz penalty",
      description:
        "An early buzz locks out the whole team, not just the presser - otherwise multi-phone teams can spam the arm window.",
      constraints: "Only read in teams mode.",
      schema: z.boolean().default(true),
    }),
  },
  refinements: [],
});
