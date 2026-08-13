// Rules-matrix row 43 (late join - added by the user-flows review) plus the named additions
// from docs/design/user-flows.md: clue text on phones (expansion 1.4, remote play +
// accessibility) and the host-toggleable nickname profanity filter (flow A2).
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const joinGroup = defineSettingsGroup({
  id: "join",
  label: "Joining",
  description: "Late joiners and the player-facing join experience.",
  settings: {
    lateJoinAllowed: defineSetting({
      matrixRow: 43,
      label: "Late join allowed",
      description: "Players can join after the game starts.",
      schema: z.boolean().default(true),
    }),
    lateJoinScore: defineSetting({
      matrixRow: 43,
      label: "Late join score",
      description:
        "zero: late joiners start at 0. match-lowest: they match the current lowest score. host-prompt: the host is asked per joiner. Host score override remains the universal escape hatch.",
      constraints: "Only read when late join is allowed.",
      schema: z.enum(["zero", "match-lowest", "host-prompt"]).default("zero"),
    }),
    clueTextOnPhones: defineSetting({
      matrixRow: null,
      label: "Clue text on phones",
      description:
        "Show the clue text on player phones. Off for in-room play (reading ahead beats listening); on for remote play and accessibility.",
      constraints:
        "Default under review - revisit after the first playtest (user-flows open question 4).",
      schema: z.boolean().default(false),
    }),
    profanityFilter: defineSetting({
      matrixRow: null,
      label: "Nickname profanity filter",
      description:
        "Filter player nicknames at join; duplicate names get an auto-suffix either way.",
      schema: z.boolean().default(true),
    }),
  },
  refinements: [],
});
