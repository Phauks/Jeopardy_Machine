// Round boundaries: the host's force-end, the wall-clock limit (#6), and proceeding out of
// a round break into the next round, the final, or the end of the game.
import { firstSelectorLaterRound } from "../control.ts";
import { endRound, startRound } from "../flow.ts";
import { finishGame } from "../standings.ts";
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
