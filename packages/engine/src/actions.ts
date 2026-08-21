// The complete action catalog - the ONLY way anything happens to a game. Every action
// carries `at` (unix milliseconds): time is data, the engine never reads a clock, so a
// recorded action array replays bit-identically (the simulation directive). Timer expiries
// are actions too - the driver (host UI, DO alarm, test) owns real clocks and dispatches
// the expiry it was told to schedule via TimerSetEvent; the engine only validates phase, so
// a stale expiry after an undo or a faster action is a harmless rejection, not a crash.
//
// Actor model: actions with a playerId/entityId act as that participant; actions without one
// (judge, arm-buzzers, score-adjust...) are host actions. The engine trusts the driver to
// authenticate - transport-level identity is M3's business.
import { z } from "zod";

// Engine-level participant ids are short opaque strings ("p1", a DO session id), NOT
// document UUIDs - rooms mint them, fixtures hand-write them.
export const participantIdSchema = z.string().min(1).max(64);

const at = z.number().int().nonnegative();

export const verdictSchema = z.enum(["correct", "wrong", "no-penalty"]);
export type Verdict = z.infer<typeof verdictSchema>;

export const gameActionSchema = z.discriminatedUnion("type", [
  // Lobby + joining (settings row #43 governs post-start joins).
  z.strictObject({
    type: z.literal("player-join"),
    at,
    playerId: participantIdSchema,
    name: z.string().min(1).max(60),
    // Required in teams mode: joining an unknown teamId creates the team (teamName names it).
    teamId: participantIdSchema.optional(),
    teamName: z.string().min(1).max(60).optional(),
  }),
  z.strictObject({ type: z.literal("player-leave"), at, playerId: participantIdSchema }),
  z.strictObject({ type: z.literal("start-game"), at }),

  // Board selection. entityId present = that participant selects (validated against
  // control); absent = the host selects on anyone's behalf (always allowed - principle 4).
  z.strictObject({
    type: z.literal("select-cell"),
    at,
    category: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
    entityId: participantIdSchema.optional(),
  }),
  z.strictObject({ type: z.literal("selection-timeout"), at }), // #10 shot clock expiry

  // Clue lifecycle. arm-buzzers doubles as "open the answer window" in everyone-answers
  // mode (#22) - one host gesture, mode decides what it opens.
  z.strictObject({ type: z.literal("arm-buzzers"), at }),
  z.strictObject({ type: z.literal("buzz"), at, playerId: participantIdSchema }),
  z.strictObject({ type: z.literal("buzz-timeout"), at }), // #13 window expiry / host closes
  z.strictObject({ type: z.literal("judge"), at, verdict: verdictSchema }),
  z.strictObject({ type: z.literal("answer-timeout"), at }), // #14/#18
  // Typed answer from the buzz winner (#21 typed) or anyone in everyone-answers (#22).
  z.strictObject({
    type: z.literal("submit-typed-answer"),
    at,
    playerId: participantIdSchema,
    text: z.string().max(300),
  }),
  z.strictObject({ type: z.literal("close-answers"), at }), // host closes everyone-answers early
  // Per-entity verdicts where there is no single buzz winner: everyone-answers judging and
  // the final-round reveal.
  z.strictObject({
    type: z.literal("judge-entity"),
    at,
    entityId: participantIdSchema,
    verdict: z.enum(["correct", "wrong"]),
  }),

  // Wager cells (Double Down - settings rows #23-#28).
  z.strictObject({ type: z.literal("commit-wager"), at, amount: z.number().int() }),
  z.strictObject({ type: z.literal("wager-timeout"), at }), // #27 entry timer expiry

  // Host controls - always available (matrix row 20 is not a setting; principle 4).
  z.strictObject({
    type: z.literal("host-award"),
    at,
    entityId: participantIdSchema,
    verdict: z.enum(["correct", "wrong"]),
  }), // manual mode: no buzzers, host awards from the console
  z.strictObject({ type: z.literal("cancel-clue"), at }), // close with no scoring
  z.strictObject({
    type: z.literal("reopen-cell"),
    at,
    category: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("score-adjust"),
    at,
    entityId: participantIdSchema,
    delta: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("score-set"),
    at,
    entityId: participantIdSchema,
    score: z.number().int(),
  }),
  z.strictObject({ type: z.literal("undo"), at }),

  // Round flow.
  z.strictObject({ type: z.literal("end-round"), at }), // host force-end
  // "Stop here and show the scores" - the host's own ending, from wherever the room is
  // (owner, 2026-08-20: "there is no end game button for the host"). Distinct from end-round,
  // which finishes a ROUND and leaves the rest of the game ahead of it; this one is the whole
  // game, because a quiz night that has run long stops for reasons the board knows nothing
  // about. See transitions/rounds.ts `handleEndGame` for what it refuses.
  z.strictObject({ type: z.literal("end-game"), at }),
  z.strictObject({ type: z.literal("round-timeout"), at }), // #6 wall-clock limit expiry
  z.strictObject({ type: z.literal("proceed"), at }), // leave a round break for whatever is next

  // Final round (#29-#33).
  z.strictObject({
    type: z.literal("commit-final-wager"),
    at,
    entityId: participantIdSchema,
    amount: z.number().int(),
  }),
  z.strictObject({ type: z.literal("final-wager-timeout"), at }), // silent entities wager 0
  z.strictObject({
    type: z.literal("submit-final-answer"),
    at,
    entityId: participantIdSchema,
    text: z.string().max(300),
  }),
  z.strictObject({ type: z.literal("final-writing-timeout"), at }),

  // Sudden-death tiebreaker (#37): arm/buzz/judge are reused; this deals the next clue after
  // a dead one.
  z.strictObject({ type: z.literal("tiebreaker-next-clue"), at }),
]);

export type GameAction = z.infer<typeof gameActionSchema>;
export type GameActionType = GameAction["type"];
