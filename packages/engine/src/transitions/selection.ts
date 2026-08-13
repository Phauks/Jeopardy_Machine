// Cell selection (#7-#10) and the host's board repairs (reopen a played cell).
import { hiddenCells } from "../control.ts";
import { presentClue } from "../flow.ts";
import { drawInteger } from "../rng.ts";
import type { GameAction } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { GameState } from "../state.ts";

export function handleSelectCell(
  draft: GameState,
  action: Extract<GameAction, { type: "select-cell" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "awaiting-selection") return "not-selecting";
  if (action.entityId !== undefined) {
    // A participant selecting for themselves must hold control; the host (no entityId)
    // may always select on the controller's behalf (principle 4).
    if (setup.settings.boardControl.nextSelector === "host-picks") return "host-picks-only";
    if (draft.controlEntity !== action.entityId) return "not-your-turn";
  }
  const board = draft.boards[draft.roundIndex];
  const status = board?.status[action.category]?.[action.row];
  if (status === undefined) return "no-such-cell";
  if (status === "played") return "cell-already-played";
  presentClue(draft, setup, events, action.at, action.category, action.row, false);
  return null;
}

/** Shot clock expiry (#10): the engine picks a random hidden cell so the game keeps moving. */
export function handleSelectionTimeout(
  draft: GameState,
  action: Extract<GameAction, { type: "selection-timeout" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "awaiting-selection") return "not-selecting";
  const cells = hiddenCells(draft);
  const first = cells[0];
  if (first === undefined) return "no-cells-left";
  const draw = drawInteger(draft.rngState, cells.length);
  draft.rngState = draw.nextState;
  const cell = cells[draw.value] ?? first;
  presentClue(draft, setup, events, action.at, cell.category, cell.row, true);
  return null;
}

export function handleReopenCell(
  draft: GameState,
  action: Extract<GameAction, { type: "reopen-cell" }>,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "awaiting-selection") return "not-selecting";
  const column = draft.boards[draft.roundIndex]?.status[action.category];
  if (column === undefined || column[action.row] === undefined) return "no-such-cell";
  if (column[action.row] === "hidden") return "cell-not-played";
  column[action.row] = "hidden";
  events.push({ type: "cell-reopened", category: action.category, row: action.row });
  return null;
}
