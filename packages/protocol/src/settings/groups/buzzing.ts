// Rules-matrix rows 11-16: the buzzer state machine's inputs. These settings parameterize the
// ONE locked adjudication core (docs/design/expansion-and-boundaries.md boundary 2.1) - new
// settings on the state machine are the only sanctioned way to vary buzzing behavior.
//
// Convention (proposal section 4): durations are integer milliseconds with an Ms suffix;
// "off / unlimited / host-paced" is null on a nullable number, never a magic 0 - EXCEPT
// earlyBuzzLockoutMs, where 0-is-off is the natural physical reading of "no lockout".
import { z } from "zod";
import { limits } from "../../limits.ts";
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
      description:
        "How long the buzz winner has, shown as a countdown on the big screen and on their phone. null is NO LIMIT: no clock, no countdown, and the host closes the answer whenever the room is done with it.",
      constraints:
        "null = unlimited, per the group's own convention. It never scored anything either way - a clock is information here, never a verdict (@jeopardy/protocol settings/groups/scoring.ts).",
      schema: z.int().min(3000).max(15_000).nullable().default(5000),
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
    // M6 (docs/decisions/2026-08-17-buzz-latency-compensation.md). Not a matrix row: the
    // matrix inventories the SHOW's rules, and the show has no network. This is the setting
    // boundary 2.1 always named ("fairness compensation on/off in M6") - a knob on the one
    // adjudication state machine, applied upstream of it, never a second algorithm.
    latencyCompensation: defineSetting({
      matrixRow: null,
      label: "Buzz latency compensation",
      description:
        "Rank buzzes by reaction time (measured against each phone's own arm signal, clamped by its measured round trip) instead of raw server arrival, so a slow connection stops being a handicap. Off ranks by arrival, which quietly rewards the best Wi-Fi in the room.",
      schema: z.boolean().default(true),
    }),
    compensationWindowMs: defineSetting({
      matrixRow: null,
      label: "Compensation window",
      description:
        "How long the room may hold buzzes before crowning the winner. Reordering needs waiting: a slower phone's earlier press physically arrives later. The room usually waits far less - adjudication closes as soon as no later arrival could still win.",
      constraints:
        "Only read when latency compensation is on; 0 makes it inert (arrival order wins).",
      schema: z.int().min(0).max(limits.buzz.compensationWindowMaxMs).default(250),
    }),
  },
  refinements: [],
});
