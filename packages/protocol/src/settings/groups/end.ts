// Rules-matrix rows 37-38: how the game ends. Defaults are the party-friendly options on
// purpose (guiding principle 0) - the TV preset flips both to the competitive rules.
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const endGroup = defineSettingsGroup({
  id: "end",
  label: "End of game",
  description: "Ties and degenerate finishes.",
  settings: {
    tieForFirst: defineSetting({
      matrixRow: 37,
      label: "Tie for first",
      description:
        "sudden-death is the current TV rule (one buzz-in clue, repeat until resolved); co-champions is the pre-2014 rule and the party default; shared-placement just ranks them equal.",
      schema: z.enum(["sudden-death", "co-champions", "shared-placement"]).default("co-champions"),
    }),
    allNonPositiveFinish: defineSetting({
      matrixRow: 38,
      label: "All-non-positive finish",
      description:
        "When every score ends at zero or below: TV declares no winner; highest-wins crowns someone anyway.",
      schema: z.enum(["no-winner", "highest-wins"]).default("highest-wins"),
    }),
  },
  refinements: [],
});
