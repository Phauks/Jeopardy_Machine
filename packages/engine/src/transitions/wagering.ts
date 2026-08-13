// Wager-cell betting (#25-#27). The wager commits BEFORE the clue shows (TV rule) and the
// range is validated here - an out-of-range bet is a rejection, not a clamp, so the host
// UI must re-prompt rather than silently bet something else.
import { maximumWager } from "../flow.ts";
import type { GameAction } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { GameState } from "../state.ts";

function commit(draft: GameState, events: GameEvent[], amount: number, forced: boolean): void {
  const clue = draft.clue;
  if (clue === null || clue.selectedBy === null) return;
  clue.wager = amount;
  draft.phase = "wager-answering";
  events.push({ type: "wager-committed", entityId: clue.selectedBy, amount, forced });
  events.push({
    type: "clue-presented",
    isWagerClue: true,
    everyoneAnswers: false, // wager clues are always a solo answer, even in everyone-answers games
  });
}

export function handleCommitWager(
  draft: GameState,
  action: Extract<GameAction, { type: "commit-wager" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "wagering") return "not-wagering";
  const clue = draft.clue;
  if (clue === null || clue.selectedBy === null) return "no-wager-clue";
  const minimum = setup.settings.wagers.minimumWager;
  const maximum = maximumWager(setup, draft.roundIndex, draft.scores[clue.selectedBy] ?? 0);
  if (action.amount < minimum || action.amount > maximum) return "wager-out-of-range";
  commit(draft, events, action.amount, false);
  return null;
}

/** Wager-entry timer expiry (#27): the minimum bet commits so the game keeps moving. */
export function handleWagerTimeout(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "wagering") return "not-wagering";
  const clue = draft.clue;
  if (clue === null || clue.selectedBy === null) return "no-wager-clue";
  commit(draft, events, setup.settings.wagers.minimumWager, true);
  return null;
}
