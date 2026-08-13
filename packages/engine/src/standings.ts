// End-of-game resolution: placements, winners, tie handling (#37), degenerate finishes
// (#38), and entry into the sudden-death tiebreaker. finishGame is the single funnel every
// path to game-over goes through (board rounds exhausted, final judged, tiebreaker won).
import type { GameEvent, StandingsEntry } from "./events.ts";
import type { GameSetup } from "./setup.ts";
import type { GameState } from "./state.ts";

function entityName(state: GameState, entityId: string): string {
  return state.teams[entityId]?.name ?? state.players[entityId]?.name ?? entityId;
}

/**
 * Standings sorted by score descending; ties share a placement number (1, 1, 3...). A
 * promoted tiebreaker winner sorts above the entities it tied with.
 */
export function computeStandings(
  state: GameState,
  promotedWinner: string | null = null,
): StandingsEntry[] {
  const sorted = state.entityOrder.toSorted((left, right) => {
    if (left === promotedWinner) return -1;
    if (right === promotedWinner) return 1;
    return (state.scores[right] ?? 0) - (state.scores[left] ?? 0);
  });
  const entries: StandingsEntry[] = [];
  for (const [index, entityId] of sorted.entries()) {
    const score = state.scores[entityId] ?? 0;
    const previous = entries[index - 1];
    const tiedWithPrevious =
      previous !== undefined && previous.score === score && previous.entityId !== promotedWinner;
    entries.push({
      entityId,
      name: entityName(state, entityId),
      score,
      placement: tiedWithPrevious ? previous.placement : index + 1,
    });
  }
  return entries;
}

/**
 * Resolve the game or enter the tiebreaker. Order of checks: the all-non-positive rule
 * (#38) trumps tie handling - there is nothing to break a tie FOR when no one may win.
 */
export function finishGame(draft: GameState, setup: GameSetup, events: GameEvent[]): void {
  const standings = computeStandings(draft);
  const leaders = standings.filter((entry) => entry.placement === 1).map((entry) => entry.entityId);

  const allNonPositive = standings.every((entry) => entry.score <= 0);
  if (allNonPositive && setup.settings.end.allNonPositiveFinish === "no-winner") {
    draft.phase = "game-over";
    draft.winners = [];
    events.push({ type: "game-over", standings, winners: [], note: "no-winner" });
    return;
  }

  if (leaders.length > 1) {
    const tieRule = setup.settings.end.tieForFirst;
    if (tieRule === "sudden-death") {
      draft.phase = "tiebreaker-reading";
      draft.tiebreaker = {
        participants: leaders,
        eliminated: [],
        buzzWinner: null,
        armedAt: null,
      };
      events.push({ type: "tiebreaker-started", participants: leaders });
      return;
    }
    draft.phase = "game-over";
    draft.winners = leaders;
    events.push({
      type: "game-over",
      standings,
      winners: leaders,
      note: tieRule === "co-champions" ? "co-champions" : "shared-placement",
    });
    return;
  }

  draft.phase = "game-over";
  draft.winners = leaders;
  events.push({ type: "game-over", standings, winners: leaders, note: "clean" });
}

/** Game over via a won sudden-death clue: the winner promotes above the entities it tied with. */
export function finishTiebreaker(
  draft: GameState,
  winnerEntityId: string,
  events: GameEvent[],
): void {
  const standings = computeStandings(draft, winnerEntityId);
  draft.phase = "game-over";
  draft.tiebreaker = null;
  draft.winners = [winnerEntityId];
  events.push({ type: "game-over", standings, winners: [winnerEntityId], note: "sudden-death" });
}
