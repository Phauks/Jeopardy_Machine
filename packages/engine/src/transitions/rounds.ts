// Round boundaries: the host's force-end, the wall-clock limit (#6), and proceeding out of
// a round break into the next round, the final, or the end of the game.
import { firstSelectorLaterRound } from "../control.ts";
import { endRound, startRound } from "../flow.ts";
import { computeStandings, finishGame } from "../standings.ts";
import { startFinal } from "./final.ts";
import type { GameAction } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { GameState } from "../state.ts";

export function handleEndRound(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "awaiting-selection") return "not-selecting";
  endRound(draft, setup, events);
  return null;
}

/**
 * "Stop here and show the scores" (owner, 2026-08-20: "there is no end game button for the
 * host"). Until this existed the only way out of a running game was to play the board to the
 * end - `end-round` finishes a ROUND and leaves whatever comes after it still ahead - so a
 * quiz night that had run long had no ending at all, and the honest workaround was closing
 * the room, which is not an ending: it is everybody's screen going dark with no scores on it.
 *
 * Two deliberate choices about what it does NOT do:
 *
 * It does not run the tie rules. `finishGame` would open sudden death on a tie for first, and
 * a host who is stopping the game is not asking for one more clue - the tie stands, shared,
 * and the standings say so. That is why this writes the phase itself rather than calling
 * `finishGame`, and why "ended-early" is its own note (events.ts).
 *
 * It does not undo anything. Scores are exactly what they were a moment ago, mid-clue
 * included: a clue that was open when the host stopped is simply never judged, which is what
 * happened in the room.
 */
export function handleEndGame(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  // A game that has not begun has no scores to show, and one already over has shown them.
  if (draft.phase === "lobby") return "not-started";
  if (draft.phase === "game-over") return "already-over";
  const standings = computeStandings(draft);
  // Same degenerate-finish rule the ordinary path applies (#38): if nobody may win, nobody
  // wins here either. A host ending early does not create a champion the settings forbid.
  const allNonPositive = standings.every((entry) => entry.score <= 0);
  const winners =
    allNonPositive && setup.settings.end.allNonPositiveFinish === "no-winner"
      ? []
      : standings.filter((entry) => entry.placement === 1).map((entry) => entry.entityId);
  draft.phase = "game-over";
  draft.breakNextStage = null;
  draft.tiebreaker = null;
  draft.winners = winners;
  events.push({ type: "game-over", standings, winners, note: "ended-early" });
  return null;
}

/**
 * Round time limit (#6). Mid-clue the round MUST NOT die under the players (a buzz already
 * won deserves its judging), so the expiry latches and the round ends when the clue closes.
 */
export function handleRoundTimeout(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  const board = draft.boards[draft.roundIndex];
  if (board === undefined) return "no-round";
  if (draft.phase === "awaiting-selection") {
    endRound(draft, setup, events);
    return null;
  }
  const cluePhases: GameState["phase"][] = [
    "reading",
    "armed",
    "answering",
    "wagering",
    "wager-answering",
    "all-answering",
    "all-judging",
  ];
  if (cluePhases.includes(draft.phase)) {
    board.timeExpired = true;
    return null;
  }
  return "no-round-running";
}

export function handleProceed(
  draft: GameState,
  action: Extract<GameAction, { type: "proceed" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "round-break") return "not-in-break";
  const nextStage = draft.breakNextStage;
  draft.breakNextStage = null;
  if (nextStage === "round") {
    draft.roundIndex += 1;
    startRound(draft, setup, events, action.at, firstSelectorLaterRound(draft, setup.settings));
    return null;
  }
  if (nextStage === "final") {
    startFinal(draft, setup, events, action.at);
    return null;
  }
  finishGame(draft, setup, events);
  return null;
}
