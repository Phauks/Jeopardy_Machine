// THE RULES A HOST MAY MOVE WHILE THE ROOM IS RUNNING.
//
// Owner, 2026-08-20: the answer timer "should be settable by the host", and a wrong answer
// costing points should be "a setting" a host can reach. Both were already rules-matrix rows
// (buzzing.answerWindowMs, scoring.wrongAnswerPenalty) - and both were frozen at room
// creation, because rules arrive inside the game definition and `setup` was written once.
//
// That is the right default and the wrong absolute. A rule set is an authored document and
// belongs to whoever wrote it (docs/design/expansion-and-boundaries.md - the design law), but
// the person running the night is discovering things the document could not know: that this
// room needs longer to answer, that deducting points is souring a charity quiz, that the
// group would rather keep passing a clue around than let it die.
//
// So this module names a SUBSET, and the subset is the whole safety argument:
//
//   MAY MOVE - a rule the engine reads fresh each time it needs it. Change it between clues
//              or during one and the next read simply sees the new number; no state in
//              flight means anything different than it did a moment ago.
//   MAY NOT  - anything the RUNNING STATE was built from. Board shape, round count, wager
//              placement, teams mode, the final's existence: the state machine has already
//              acted on these, so changing one mid-game does not retune the game, it makes
//              the state a description of a game that never existed.
//
// The line is not "important vs unimportant" - it is "read later vs already acted on". That
// is why `wagers.countRoundOne` is excluded even though it is a number like any other: the
// cells were placed at start-game and the board on thirty phones is the proof.
import { z } from "zod";
import { buzzingGroup } from "../settings/groups/buzzing.ts";
import { scoringGroup } from "../settings/groups/scoring.ts";
import { settingsSchema } from "../settings/derive.ts";

/**
 * The patch a host may send. Sparse by construction - a host changes one thing at a time, and
 * an absent field means "leave it", never "back to default" (the same rule the settings
 * overrides layer follows, settings/derive.ts).
 *
 * Strict, so a field that is NOT on this list is a refusal rather than a silent no-op. A
 * console that tries to retune the board mid-game should be told it cannot, not humoured.
 */
export const liveRulesPatchSchema = z
  .strictObject({
    buzzing: z
      .strictObject({
        answerWindowMs: buzzingGroup.settings.answerWindowMs.schema.unwrap().optional(),
        buzzWindowMs: buzzingGroup.settings.buzzWindowMs.schema.unwrap().optional(),
        rebound: buzzingGroup.settings.rebound.schema.unwrap().optional(),
        wrongAnswererLockedOut: buzzingGroup.settings.wrongAnswererLockedOut.schema
          .unwrap()
          .optional(),
      })
      .optional(),
    scoring: z
      .strictObject({
        wrongAnswerPenalty: scoringGroup.settings.wrongAnswerPenalty.schema.unwrap().optional(),
      })
      .optional(),
  })
  // An empty patch is a client bug, not a no-op worth broadcasting to thirty phones.
  .refine(
    (patch) => Object.values(patch).some((group) => group !== undefined),
    "a live-rules patch must change something",
  );
export type LiveRulesPatch = z.infer<typeof liveRulesPatchSchema>;

/**
 * The rules every surface is told about, so a console can render the CURRENT values rather
 * than the ones the game definition shipped with, and a phone can show the answer clock it is
 * actually running against.
 *
 * Complete rather than sparse: this is state, not a patch, and a surface that had to merge
 * a patch onto a document it does not hold would be guessing.
 */
export const liveRulesSchema = z.strictObject({
  /** null = no limit: no clock on any screen, and the host closes the answer (buzzing.ts). */
  answerWindowMs: z.int().positive().nullable(),
  buzzWindowMs: z.int().positive().nullable(),
  rebound: z.boolean(),
  wrongAnswererLockedOut: z.boolean(),
  wrongAnswerPenalty: z.enum(["deduct", "floor-at-zero", "none"]),
});
export type LiveRules = z.infer<typeof liveRulesSchema>;

/**
 * The rules a surface assumes BEFORE the room has told it any - the registry's own defaults,
 * projected, so a phone that renders in the half-second before `game-rules` lands draws a
 * plausible clock rather than a zero-length one.
 *
 * Derived from the settings schema rather than typed out, because a second copy of the
 * defaults is a second thing to keep true (`settingsSchema.parse({})` IS the default game).
 * Surfaces should still prefer telling the person nothing is known over drawing this as fact;
 * it exists so the shape is never absent, not so a guess can be presented as an answer.
 */
export const defaultLiveRules: LiveRules = liveRulesOfSettings(settingsSchema.parse({}));

/** The projection, shared by the default above and by the room that serves the real thing. */
export function liveRulesOfSettings(settings: {
  buzzing: {
    answerWindowMs: number | null;
    buzzWindowMs: number | null;
    rebound: boolean;
    wrongAnswererLockedOut: boolean;
  };
  scoring: { wrongAnswerPenalty: "deduct" | "floor-at-zero" | "none" };
}): LiveRules {
  return {
    answerWindowMs: settings.buzzing.answerWindowMs,
    buzzWindowMs: settings.buzzing.buzzWindowMs,
    rebound: settings.buzzing.rebound,
    wrongAnswererLockedOut: settings.buzzing.wrongAnswererLockedOut,
    wrongAnswerPenalty: settings.scoring.wrongAnswerPenalty,
  };
}

/**
 * The answer clock's bounds, in SECONDS, for the control a host actually operates.
 *
 * A host thinks "give them ten seconds", so the console's slider is in seconds while the wire
 * and the engine stay in milliseconds (the settings convention: durations are integer ms with
 * an Ms suffix). These are the schema's own bounds restated in the unit the UI needs, and
 * live-rules.test.ts holds them to it by round-tripping both ends through the real schema -
 * so a widened rule set moves this slider rather than silently disagreeing with it.
 */
export const answerWindowSecondBounds = { min: 3, max: 15 } as const;

/**
 * Every path the settings for a live room can be reached by, as one list. Exported so the DO,
 * the console and the gate test all agree on what is tunable without three copies of the
 * knowledge - and so adding a row here is the single edit that makes it host-settable.
 */
export const liveRuleKeys = [
  "buzzing.answerWindowMs",
  "buzzing.buzzWindowMs",
  "buzzing.rebound",
  "buzzing.wrongAnswererLockedOut",
  "scoring.wrongAnswerPenalty",
] as const;
