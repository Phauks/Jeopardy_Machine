// Host escape hatches that are ALWAYS available (matrix row 20 is deliberately not a
// setting): direct score surgery, any time, any phase. Undo lives in transition.ts because
// it replays through the dispatcher itself.
import type { GameAction } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameState } from "../state.ts";

export function handleScoreAdjust(
  draft: GameState,
  action: Extract<GameAction, { type: "score-adjust" }>,
  events: GameEvent[],
): string | null {
  if (!draft.entityOrder.includes(action.entityId)) return "unknown-entity";
  const score = (draft.scores[action.entityId] ?? 0) + action.delta;
  draft.scores[action.entityId] = score;
  events.push({ type: "score-adjusted", entityId: action.entityId, delta: action.delta, score });
  return null;
}

export function handleScoreSet(
  draft: GameState,
  action: Extract<GameAction, { type: "score-set" }>,
  events: GameEvent[],
): string | null {
  if (!draft.entityOrder.includes(action.entityId)) return "unknown-entity";
  const previous = draft.scores[action.entityId] ?? 0;
  draft.scores[action.entityId] = action.score;
  events.push({
    type: "score-adjusted",
    entityId: action.entityId,
    delta: action.score - previous,
    score: action.score,
  });
  return null;
}

/** Deal the next sudden-death clue after a dead one (#37): eliminations reset per clue. */
export function handleTiebreakerNextClue(draft: GameState, events: GameEvent[]): string | null {
  if (draft.phase !== "tiebreaker-reading" && draft.phase !== "tiebreaker-armed") {
    return "not-tiebreaker";
  }
  const tiebreaker = draft.tiebreaker;
  if (tiebreaker === null) return "no-tiebreaker";
  draft.phase = "tiebreaker-reading";
  tiebreaker.eliminated = [];
  tiebreaker.buzzWinner = null;
  tiebreaker.armedAt = null;
  events.push({ type: "tiebreaker-clue-dealt", eliminated: [] });
  return null;
}
