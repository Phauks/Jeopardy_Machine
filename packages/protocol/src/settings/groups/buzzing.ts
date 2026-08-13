// Rules-matrix rows 11-16: the buzzer state machine's inputs. These settings parameterize the
// ONE locked adjudication core (docs/design/expansion-and-boundaries.md boundary 2.1) - new
// settings on the state machine are the only sanctioned way to vary buzzing behavior.
//
// Convention (proposal section 4): durations are integer milliseconds with an Ms suffix;
// "off / unlimited / host-paced" is null on a nullable number, never a magic 0 - EXCEPT
// earlyBuzzLockoutMs, where 0-is-off is the natural physical reading of "no lockout".
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const buzzingGroup = defineSettingsGroup({
  id: "buzzing",
  label: "Buzzing",
  description: "Arming, lockouts, and the windows around a buzz.",
  settings: {
    armMode: defineSetting({
      matrixRow: 11,
      label: "Arm mode",
      description:
        "manual mirrors the TV production (a human arms on the last syllable); the auto modes arm after text-to-speech ends or after a fixed reading delay.",
      schema: z.enum(["manual", "auto-after-tts", "auto-after-delay"]).default("manual"),
    }),
    autoArmDelayMs: defineSetting({
      matrixRow: 11,
      label: "Auto-arm delay",
      description: "Reading time before buzzers arm themselves.",
      constraints: "Only read when arm mode is auto-after-delay.",
      schema: z.int().min(500).max(30_000).default(4000),
    }),
    earlyBuzzLockoutMs: defineSetting({
      matrixRow: 12,
      label: "Early-buzz lockout",
      description:
        "Buzzing before arming locks that buzzer out this long, re-triggered per press (TV: 250ms - the core skill element). 0 turns the penalty off.",
      schema: z.int().min(0).max(1000).default(250),
    }),
    buzzWindowMs: defineSetting({
      matrixRow: 13,
      label: "Buzz-in window",
      description:
        "How long after arming anyone may ring in; null keeps buzzers live until the host closes the clue.",
      schema: z.int().min(3000).max(15_000).nullable().default(5000),
    }),
    answerWindowMs: defineSetting({
      matrixRow: 14,
      label: "Answer window",
      description: "Time the buzz winner has to answer before it counts as wrong.",
      schema: z.int().min(3000).max(15_000).default(5000),
    }),
    rebound: defineSetting({
      matrixRow: 15,
      label: "Rebound after wrong answer",
      description:
        "Re-arm the remaining buzzers after a wrong answer (TV rule); off means one attempt per clue.",
      schema: z.boolean().default(true),
    }),
    wrongAnswererLockedOut: defineSetting({
      matrixRow: 16,
      label: "Wrong answerer locked out",
      description:
        "A player who answered wrong stays locked out for the rest of the clue (TV rule).",
      schema: z.boolean().default(true),
    }),
  },
  refinements: [],
});
