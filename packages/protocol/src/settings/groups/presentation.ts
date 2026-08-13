// Rules-matrix rows 39-42: presentation toggles. All sounds are original/royalty-free assets -
// never sampled from the show (docs/research/01-game-anatomy.md section 7). WHICH sound set
// plays is the theme document's business (soundSet slot); WHETHER each cue plays is a rule.
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const presentationGroup = defineSettingsGroup({
  id: "presentation",
  label: "Presentation",
  description: "Per-cue sounds, announcements, and reveal animations.",
  settings: {
    soundBoardFill: defineSetting({
      matrixRow: 39,
      label: "Board-fill sound",
      description: "The ascending boops as cells populate at round start.",
      schema: z.boolean().default(true),
    }),
    soundWagerSting: defineSetting({
      matrixRow: 39,
      label: "Wager cell sting",
      description: "The dramatic sting when a hidden wager cell is revealed.",
      schema: z.boolean().default(true),
    }),
    soundThinkMusic: defineSetting({
      matrixRow: 39,
      label: "Think music",
      description:
        "The final round writing-timer track (an original composition, not the TV melody).",
      schema: z.boolean().default(true),
    }),
    soundTimeUp: defineSetting({
      matrixRow: 39,
      label: "Time's-up beep",
      description: "The double beep when a buzz or answer window expires.",
      schema: z.boolean().default(true),
    }),
    soundBuzzIn: defineSetting({
      matrixRow: 39,
      label: "Buzz-in sound",
      description:
        "An audible cue when someone wins the buzz - useful in a big room (TV uses only the podium light).",
      schema: z.boolean().default(true),
    }),
    announceBuzzWinner: defineSetting({
      matrixRow: 40,
      label: "Announce buzz winner",
      description: "How the room learns who buzzed first.",
      schema: z
        .enum(["screen-only", "screen-and-sound", "screen-and-name-tts"])
        .default("screen-and-sound"),
    }),
    categoryRevealAnimation: defineSetting({
      matrixRow: 41,
      label: "Category reveal animation",
      description:
        "Animate the category strip one at a time at round start (host reads each aloud).",
      schema: z.boolean().default(true),
    }),
    deadClueReveal: defineSetting({
      matrixRow: 42,
      label: "Dead clue answer reveal",
      description:
        "When nobody gets a clue: auto-display shows the correct answer on the board; host-reads leaves it to the host.",
      schema: z.enum(["auto-display", "host-reads"]).default("auto-display"),
    }),
  },
  refinements: [],
});
