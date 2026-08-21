// Adjudication: verdicts, the rebound loop (#15/#16), answer timeouts (#14/#18), the host's
// manual-mode awards, and clue cancellation. Scoring math lives in scoring.ts; this module
// owns the consequences (lockouts, re-arms, control passing, clue closure).
import { closeClue } from "../flow.ts";
import { answerTimeoutDelta, wrongAnswerDelta } from "../scoring.ts";
import { finishTiebreaker } from "../standings.ts";
import { entityForPlayer } from "../state.ts";
import type { GameAction, Verdict } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { ClueState, GameState } from "../state.ts";

function applyDelta(
  draft: GameState,
  entityId: string,
  delta: number,
  verdict: Verdict | "timeout",
  events: GameEvent[],
): void {
  const score = (draft.scores[entityId] ?? 0) + delta;
  draft.scores[entityId] = score;
  events.push({ type: "judged", entityId, verdict, delta, score });
}

/** Entities that could still legally buzz on this clue. */
function reboundCandidates(draft: GameState, clue: ClueState): string[] {
  return draft.entityOrder.filter((entityId) => !clue.lockedOutEntities.includes(entityId));
}

/**
 * After a non-correct outcome on a buzzed clue: lock the answerer out (#16), then either
 * re-arm for the rest (#15) or die. Re-arming starts a NEW arming - a second buzz-won for
 * this clue is correct behavior (sequential, never overlapping).
 */
function afterMiss(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
  clue: ClueState,
  missedEntity: string,
  lockOut: boolean,
): void {
  if (lockOut && setup.settings.buzzing.wrongAnswererLockedOut) {
    if (!clue.lockedOutEntities.includes(missedEntity)) clue.lockedOutEntities.push(missedEntity);
  }
  clue.buzzWinner = null;
  const candidates = reboundCandidates(draft, clue);
  if (!setup.settings.buzzing.rebound || candidates.length === 0) {
    closeClue(draft, setup, events, at, "dead");
    return;
  }
  draft.phase = "armed";
  clue.armedAt = at;
  clue.armingCount += 1;
  events.push({ type: "buzzers-armed", rebound: true, armedAt: at });
  events.push({ type: "rebound-armed", remainingEntities: candidates });
  const buzzWindow = setup.settings.buzzing.buzzWindowMs;
  if (buzzWindow !== null) {
    events.push({ type: "timer-set", kind: "buzz-window", durationMs: buzzWindow, at });
  }
}

/** A correct answer: award, pass control under last-correct (#7), close the clue. */
function afterCorrect(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
  entityId: string,
  stake: number,
): void {
  applyDelta(draft, entityId, stake, "correct", events);
  if (setup.settings.boardControl.nextSelector === "last-correct") {
    draft.controlEntity = entityId;
    events.push({ type: "control-assigned", entityId, reason: "correct-answer" });
  }
  closeClue(draft, setup, events, at, "correct");
}

export function handleJudge(
  draft: GameState,
  action: Extract<GameAction, { type: "judge" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  // Sudden-death tiebreaker (#37): no scores move; correct wins the game, wrong eliminates
  // from this clue and re-arms for the remaining participants.
  if (draft.phase === "tiebreaker-answering") {
    const tiebreaker = draft.tiebreaker;
    if (tiebreaker === null || tiebreaker.buzzWinner === null) return "no-buzz-winner";
    const winner = tiebreaker.buzzWinner;
    if (action.verdict === "correct") {
      finishTiebreaker(draft, winner.entityId, events);
      return null;
    }
    if (action.verdict === "wrong") tiebreaker.eliminated.push(winner.entityId);
    tiebreaker.buzzWinner = null;
    const remaining = tiebreaker.participants.filter(
      (entityId) => !tiebreaker.eliminated.includes(entityId),
    );
    if (remaining.length === 0) {
      // Everyone missed: stay in reading; the host deals a fresh clue (tiebreaker-next-clue).
      draft.phase = "tiebreaker-reading";
      tiebreaker.armedAt = null;
    } else {
      draft.phase = "tiebreaker-armed";
      events.push({ type: "buzzers-armed", rebound: true, armedAt: action.at });
    }
    return null;
  }

  if (draft.phase === "answering") {
    const clue = draft.clue;
    if (clue === null || clue.buzzWinner === null) return "no-buzz-winner";
    const winner = clue.buzzWinner;
    if (action.verdict === "correct") {
      afterCorrect(draft, setup, events, action.at, winner.entityId, clue.value);
      return null;
    }
    if (action.verdict === "wrong") {
      const delta = wrongAnswerDelta(
        draft.scores[winner.entityId] ?? 0,
        clue.value,
        setup.settings.scoring.wrongAnswerPenalty,
      );
      applyDelta(draft, winner.entityId, delta, "wrong", events);
      afterMiss(draft, setup, events, action.at, clue, winner.entityId, true);
      return null;
    }
    // no-penalty: judge's discretion - no deduction AND no lockout, so the same entity may
    // legitimately buzz again on the re-arm (e.g. "rephrase that as a question").
    applyDelta(draft, winner.entityId, 0, "no-penalty", events);
    afterMiss(draft, setup, events, action.at, clue, winner.entityId, false);
    return null;
  }

  // Wager clue (#23-#28): the selector answered alone; the committed wager is the stake and
  // the selector keeps the pick either way (TV rule - control does not move on a miss).
  if (draft.phase === "wager-answering") {
    const clue = draft.clue;
    if (clue === null || clue.selectedBy === null || clue.wager === null) return "no-wager";
    const entityId = clue.selectedBy;
    const wager = clue.wager;
    if (action.verdict === "correct") {
      afterCorrect(draft, setup, events, action.at, entityId, wager);
      return null;
    }
    if (action.verdict === "wrong") {
      const delta = wrongAnswerDelta(
        draft.scores[entityId] ?? 0,
        wager,
        setup.settings.scoring.wrongAnswerPenalty,
      );
      applyDelta(draft, entityId, delta, "wrong", events);
    } else {
      applyDelta(draft, entityId, 0, "no-penalty", events);
    }
    closeClue(draft, setup, events, action.at, "dead");
    return null;
  }

  return "nothing-to-judge";
}

export function handleAnswerTimeout(
  draft: GameState,
  action: Extract<GameAction, { type: "answer-timeout" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  // Everyone-answers window expiry closes submissions (handled by the same action so the
  // driver schedules exactly one timer per hint).
  if (draft.phase === "all-answering") {
    return closeEveryoneAnswers(draft, setup, events, action.at);
  }

  if (draft.phase === "answering") {
    const clue = draft.clue;
    if (clue === null || clue.buzzWinner === null) return "no-buzz-winner";
    const winner = clue.buzzWinner;
    // HOST-DECIDES: the clock is information, not a verdict (owner, 2026-08-20 - the setting's
    // own note in @jeopardy/protocol settings/groups/scoring.ts). Nothing moves: the same buzz
    // winner still holds the floor, no score changes, nobody is locked out, and the host
    // judges when the room has finished arguing. The event is still emitted so every surface
    // can say "over time" - that is the whole point of leaving the timer on screen.
    if (setup.settings.scoring.answerTimeoutOutcome === "host-decides") {
      events.push({ type: "answer-time-expired", entityId: winner.entityId });
      return null;
    }
    const delta = answerTimeoutDelta(
      draft.scores[winner.entityId] ?? 0,
      clue.value,
      setup.settings,
    );
    applyDelta(draft, winner.entityId, delta, "timeout", events);
    afterMiss(draft, setup, events, action.at, clue, winner.entityId, true);
    return null;
  }

  if (draft.phase === "wager-answering") {
    const clue = draft.clue;
    if (clue === null || clue.selectedBy === null || clue.wager === null) return "no-wager";
    const entityId = clue.selectedBy;
    const wager = clue.wager;
    // Same rule on a wager clue, and for a stronger reason: the stake is the player's own
    // number, so a clock ending it is the harshest possible way to lose a bet nobody judged.
    if (setup.settings.scoring.answerTimeoutOutcome === "host-decides") {
      events.push({ type: "answer-time-expired", entityId });
      return null;
    }
    const delta = answerTimeoutDelta(draft.scores[entityId] ?? 0, wager, setup.settings);
    applyDelta(draft, entityId, delta, "timeout", events);
    closeClue(draft, setup, events, action.at, "dead");
    return null;
  }

  if (draft.phase === "tiebreaker-answering") {
    // Timeout in the tiebreaker counts as a miss - same path as judging wrong.
    return handleJudge(draft, { type: "judge", at: action.at, verdict: "wrong" }, setup, events);
  }

  return "nothing-to-time-out";
}

/**
 * Manual mode (owner directive: no-phones fallback) - the host awards an entity directly
 * while buzzers are dead or nobody has won the buzz. Correct closes the clue exactly like a
 * judged buzz; wrong deducts and locks out but leaves the clue open for another award.
 */
export function handleHostAward(
  draft: GameState,
  action: Extract<GameAction, { type: "host-award" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "reading" && draft.phase !== "armed") return "no-open-clue";
  const clue = draft.clue;
  if (clue === null) return "no-clue";
  if (!draft.entityOrder.includes(action.entityId)) return "unknown-entity";
  if (action.verdict === "correct") {
    afterCorrect(draft, setup, events, action.at, action.entityId, clue.value);
    return null;
  }
  const delta = wrongAnswerDelta(
    draft.scores[action.entityId] ?? 0,
    clue.value,
    setup.settings.scoring.wrongAnswerPenalty,
  );
  applyDelta(draft, action.entityId, delta, "wrong", events);
  if (setup.settings.buzzing.wrongAnswererLockedOut) {
    if (!clue.lockedOutEntities.includes(action.entityId)) {
      clue.lockedOutEntities.push(action.entityId);
    }
  }
  return null;
}

export function handleCancelClue(
  draft: GameState,
  action: Extract<GameAction, { type: "cancel-clue" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  const cluePhases: GameState["phase"][] = [
    "reading",
    "armed",
    "answering",
    "wagering",
    "wager-answering",
    "all-answering",
    "all-judging",
  ];
  if (!cluePhases.includes(draft.phase)) return "no-open-clue";
  closeClue(draft, setup, events, action.at, "cancelled");
  return null;
}

/**
 * Typed answers (#21 typed / #22 everyone-answers). With a buzz winner: only their phone's
 * text is recorded (auto-judge upstream proposes, the host's judge action disposes). In
 * everyone-answers: first submission per entity counts, window auto-closes when every
 * entity is in.
 */
export function handleSubmitTypedAnswer(
  draft: GameState,
  action: Extract<GameAction, { type: "submit-typed-answer" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  const entityId = entityForPlayer(draft, action.playerId);
  if (entityId === null) return "unknown-player";
  const clue = draft.clue;
  if (clue === null) return "no-clue";

  if (draft.phase === "answering") {
    if (setup.settings.answerMode.answerCapture !== "typed") return "verbal-capture";
    if (clue.buzzWinner?.playerId !== action.playerId) return "not-buzz-winner";
    clue.submissions[entityId] = { playerId: action.playerId, text: action.text, at: action.at };
    events.push({
      type: "answer-submitted",
      playerId: action.playerId,
      entityId,
      text: action.text,
    });
    return null;
  }

  if (draft.phase === "all-answering") {
    if (clue.submissions[entityId] !== undefined) return "already-answered";
    clue.submissions[entityId] = { playerId: action.playerId, text: action.text, at: action.at };
    events.push({
      type: "answer-submitted",
      playerId: action.playerId,
      entityId,
      text: action.text,
    });
    if (Object.keys(clue.submissions).length >= draft.entityOrder.length) {
      return closeEveryoneAnswers(draft, setup, events, action.at);
    }
    return null;
  }

  return "not-answering";
}

export function closeEveryoneAnswers(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
): string | null {
  const clue = draft.clue;
  if (clue === null) return "no-clue";
  const submittedCount = Object.keys(clue.submissions).length;
  events.push({ type: "answers-closed", submittedCount });
  if (submittedCount === 0) {
    closeClue(draft, setup, events, at, "dead");
    return null;
  }
  draft.phase = "all-judging";
  return null;
}
