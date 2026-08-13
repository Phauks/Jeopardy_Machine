// The final round (#29-#33): eligibility, secret simultaneous wagers, the writing window,
// and the reveal - individual entries in lowest-pre-final-score-first order for drama, with
// batching for big fields (sequentially revealing 100 players is not drama, it is a queue).
import { finishGame } from "../standings.ts";
import type { GameAction } from "../actions.ts";
import type { FinalRevealEntry, GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { GameState } from "../state.ts";

// #33 top-contenders: this many leaders reveal individually; at or below the threshold the
// whole field reveals individually (batching three of five players saves nothing).
const topContendersIndividualCount = 3;
const topContendersMinimumFieldToBatch = 5;

/** Allowed wager range per entity (#30/#31). */
export function finalWagerRange(
  setup: GameSetup,
  score: number,
): { minimum: number; maximum: number } {
  if (setup.settings.final.wagerRule === "fixed-stake") {
    const stake = setup.settings.final.fixedStakeAmount;
    return { minimum: stake, maximum: stake };
  }
  // zero-to-score (TV): nobody can finish the final below zero. Under everyone-eligibility a
  // non-positive entity still gets a token stake to play for (the wagers minimum, matching
  // the anatomy doc's "grant excluded players a token stake" house variant).
  const tokenStake =
    setup.settings.final.eligibility === "everyone" ? setup.settings.wagers.minimumWager : 0;
  return { minimum: 0, maximum: Math.max(score, tokenStake, 0) };
}

export function startFinal(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
): void {
  const eligible =
    setup.settings.final.eligibility === "everyone"
      ? [...draft.entityOrder]
      : draft.entityOrder.filter((entityId) => (draft.scores[entityId] ?? 0) > 0);
  if (eligible.length === 0) {
    events.push({ type: "final-skipped", reason: "nobody-eligible" });
    finishGame(draft, setup, events);
    return;
  }

  draft.final = {
    eligible,
    wagers: {},
    answers: {},
    prefinalScores: { ...draft.scores },
    individualOrder: [],
    batchedEntities: [],
    revealIndex: 0,
    judged: {},
  };

  // Fixed stake (#31): everyone's risk is identical and known, so the wager phase would be
  // an empty ceremony - commit for all and go straight to writing.
  if (setup.settings.final.wagerRule === "fixed-stake") {
    for (const entityId of eligible) {
      draft.final.wagers[entityId] = setup.settings.final.fixedStakeAmount;
      events.push({ type: "final-wager-committed", entityId, forced: true });
    }
    openWriting(draft, setup, events, at);
    return;
  }

  draft.phase = "final-wagers";
  events.push({
    type: "final-wagers-open",
    ranges: eligible.map((entityId) => {
      const range = finalWagerRange(setup, draft.final?.prefinalScores[entityId] ?? 0);
      return { entityId, minimum: range.minimum, maximum: range.maximum };
    }),
  });
  const wagerTimer = setup.settings.wagers.wagerTimerMs;
  if (wagerTimer !== null) {
    events.push({ type: "timer-set", kind: "final-wager", durationMs: wagerTimer, at });
  }
}

function openWriting(draft: GameState, setup: GameSetup, events: GameEvent[], at: number): void {
  const final = draft.final;
  if (final === null) return;
  draft.phase = "final-writing";
  events.push({ type: "final-writing-open", eligible: [...final.eligible] });
  events.push({
    type: "timer-set",
    kind: "final-writing",
    durationMs: setup.settings.final.writingTimerMs,
    at,
  });
}

export function handleCommitFinalWager(
  draft: GameState,
  action: Extract<GameAction, { type: "commit-final-wager" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "final-wagers") return "not-final-wagers";
  const final = draft.final;
  if (final === null) return "no-final";
  if (!final.eligible.includes(action.entityId)) return "not-eligible";
  const range = finalWagerRange(setup, final.prefinalScores[action.entityId] ?? 0);
  if (action.amount < range.minimum || action.amount > range.maximum) {
    return "wager-out-of-range";
  }
  // Re-commits overwrite until the phase closes - wagers are secret, changing your mind is
  // legal until the music starts.
  final.wagers[action.entityId] = action.amount;
  events.push({ type: "final-wager-committed", entityId: action.entityId, forced: false });
  if (final.eligible.every((entityId) => final.wagers[entityId] !== undefined)) {
    openWriting(draft, setup, events, action.at);
  }
  return null;
}

export function handleFinalWagerTimeout(
  draft: GameState,
  action: Extract<GameAction, { type: "final-wager-timeout" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "final-wagers") return "not-final-wagers";
  const final = draft.final;
  if (final === null) return "no-final";
  for (const entityId of final.eligible) {
    if (final.wagers[entityId] === undefined) {
      // Silence wagers the range minimum (zero under the TV rule): risk nothing by default.
      final.wagers[entityId] = finalWagerRange(setup, final.prefinalScores[entityId] ?? 0).minimum;
      events.push({ type: "final-wager-committed", entityId, forced: true });
    }
  }
  openWriting(draft, setup, events, action.at);
  return null;
}

export function handleSubmitFinalAnswer(
  draft: GameState,
  action: Extract<GameAction, { type: "submit-final-answer" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "final-writing") return "not-final-writing";
  const final = draft.final;
  if (final === null) return "no-final";
  if (!final.eligible.includes(action.entityId)) return "not-eligible";
  // Overwrites allowed until time expires (TV: edit until the music ends).
  final.answers[action.entityId] = { text: action.text, at: action.at };
  events.push({ type: "final-answer-submitted", entityId: action.entityId });
  if (final.eligible.every((entityId) => final.answers[entityId] !== undefined)) {
    startReveal(draft, setup, events);
  }
  return null;
}

export function handleFinalWritingTimeout(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "final-writing") return "not-final-writing";
  startReveal(draft, setup, events);
  return null;
}

function revealEntry(draft: GameState, entityId: string): FinalRevealEntry {
  const final = draft.final;
  return {
    entityId,
    answerText: final?.answers[entityId]?.text ?? null,
    wager: final?.wagers[entityId] ?? 0,
  };
}

function startReveal(draft: GameState, setup: GameSetup, events: GameEvent[]): void {
  const final = draft.final;
  if (final === null) return;
  // Reveal order (#33): ascending pre-final score, ties broken by join order (TV uses
  // podium position; join order is our stable equivalent).
  const ascending = final.eligible.toSorted((left, right) => {
    const scoreDelta = (final.prefinalScores[left] ?? 0) - (final.prefinalScores[right] ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return draft.entityOrder.indexOf(left) - draft.entityOrder.indexOf(right);
  });

  const style = setup.settings.final.revealStyle;
  if (style === "lowest-first") {
    final.individualOrder = ascending;
    final.batchedEntities = [];
  } else if (style === "leaderboard") {
    final.individualOrder = [];
    final.batchedEntities = ascending;
  } else if (ascending.length < topContendersMinimumFieldToBatch) {
    final.individualOrder = ascending;
    final.batchedEntities = [];
  } else {
    final.individualOrder = ascending.slice(-topContendersIndividualCount);
    final.batchedEntities = ascending.slice(0, -topContendersIndividualCount);
  }

  draft.phase = "final-reveal";
  final.revealIndex = 0;
  events.push({
    type: "final-reveal-started",
    individualOrder: [...final.individualOrder],
    batched: final.batchedEntities.map((entityId) => revealEntry(draft, entityId)),
  });
  const first = final.individualOrder[0];
  if (first !== undefined && final.batchedEntities.length === 0) {
    events.push({
      type: "final-reveal-next",
      entry: revealEntry(draft, first),
      prefinalScore: final.prefinalScores[first] ?? 0,
    });
  }
}

/**
 * Judging during the reveal: batched entities judge in any order FIRST; individual entities
 * must then follow the reveal order exactly (the engine is the drama's stage manager).
 */
export function handleJudgeFinalEntity(
  draft: GameState,
  action: Extract<GameAction, { type: "judge-entity" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "final-reveal") return "not-final-reveal";
  const final = draft.final;
  if (final === null) return "no-final";
  if (final.judged[action.entityId] !== undefined) return "already-judged";

  const batchedRemaining = final.batchedEntities.filter(
    (entityId) => final.judged[entityId] === undefined,
  );
  if (batchedRemaining.length > 0) {
    if (!batchedRemaining.includes(action.entityId)) return "batch-first";
  } else {
    const expected = final.individualOrder[final.revealIndex];
    if (expected === undefined) return "nothing-to-judge";
    if (action.entityId !== expected) return "out-of-reveal-order";
  }

  const wager = final.wagers[action.entityId] ?? 0;
  // The wager IS the risk: a wrong final always deducts it, even in no-penalty games -
  // otherwise final wagers are free money. floor-at-zero still floors (#17 spirit).
  const currentScore = draft.scores[action.entityId] ?? 0;
  let delta = action.verdict === "correct" ? wager : -wager;
  if (action.verdict === "wrong" && setup.settings.scoring.wrongAnswerPenalty === "floor-at-zero") {
    delta = Math.max(currentScore - wager, 0) - currentScore;
  }
  const score = currentScore + delta;
  draft.scores[action.entityId] = score;
  final.judged[action.entityId] = action.verdict;
  events.push({
    type: "final-judged",
    entityId: action.entityId,
    verdict: action.verdict,
    delta,
    score,
  });

  // Advance the individual reveal pointer and pre-announce the next podium.
  if (batchedRemaining.length === 0 || batchedRemaining.length === 1) {
    while (
      final.individualOrder[final.revealIndex] !== undefined &&
      final.judged[final.individualOrder[final.revealIndex] ?? ""] !== undefined
    ) {
      final.revealIndex += 1;
    }
    const next = final.individualOrder[final.revealIndex];
    if (next !== undefined) {
      events.push({
        type: "final-reveal-next",
        entry: revealEntry(draft, next),
        prefinalScore: final.prefinalScores[next] ?? 0,
      });
    }
  }

  if (final.eligible.every((entityId) => final.judged[entityId] !== undefined)) {
    draft.final = null;
    finishGame(draft, setup, events);
  }
  return null;
}
