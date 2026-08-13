// Board-control resolution (settings rows #7-#9): who holds the pick, who opens a round,
// and what auto-sweep plays next. Pure lookups over state - the assignment itself happens in
// the flow helpers.
import { drawInteger } from "./rng.ts";
import { cellKey } from "./state.ts";
import type { Settings } from "@jeopardy/protocol";
import type { GameState } from "./state.ts";

export type SelectorDraw = {
  entityId: string | null;
  nextRngState: number;
};

/** First selector of round one (#8): a seeded draw, or null for host-picks. */
export function firstSelectorRoundOne(state: GameState, settings: Settings): SelectorDraw {
  if (settings.boardControl.firstSelectorRoundOne === "host-picks") {
    return { entityId: null, nextRngState: state.rngState };
  }
  const draw = drawInteger(state.rngState, state.entityOrder.length);
  return { entityId: state.entityOrder[draw.value] ?? null, nextRngState: draw.nextState };
}

/**
 * First selector of any later round (#9). lowest-score is the TV rule; exact ties resolve
 * by a seeded draw among the tied (the show uses podium position, which we do not have).
 * same-as-round-one falls back to a fresh draw when that entity has since left.
 */
export function firstSelectorLaterRound(state: GameState, settings: Settings): SelectorDraw {
  if (settings.boardControl.firstSelectorRoundTwo === "same-as-round-one") {
    const previous = state.firstSelectorRoundOne;
    if (previous !== null && state.entityOrder.includes(previous)) {
      return { entityId: previous, nextRngState: state.rngState };
    }
    return firstSelectorRoundOne(state, settings);
  }
  let lowest = Infinity;
  for (const entityId of state.entityOrder) {
    const score = state.scores[entityId] ?? 0;
    if (score < lowest) lowest = score;
  }
  const tied = state.entityOrder.filter((entityId) => (state.scores[entityId] ?? 0) === lowest);
  if (tied.length === 1) return { entityId: tied[0] ?? null, nextRngState: state.rngState };
  const draw = drawInteger(state.rngState, tied.length);
  return { entityId: tied[draw.value] ?? null, nextRngState: draw.nextState };
}

/** Rotation order (#7 rotate): the entity after the current holder in join order. */
export function nextEntityInRotation(state: GameState): string | null {
  const order = state.entityOrder;
  if (order.length === 0) return null;
  const currentIndex = state.controlEntity === null ? -1 : order.indexOf(state.controlEntity);
  return order[(currentIndex + 1) % order.length] ?? null;
}

/**
 * Auto-sweep (#7): the next unplayed cell, sweeping each category top-to-bottom before
 * moving right - the "no choosing" mode that trades strategy for pace.
 */
export function nextSweepCell(state: GameState): { category: number; row: number } | null {
  const board = state.boards[state.roundIndex];
  if (board === undefined) return null;
  for (let category = 0; category < board.status.length; category += 1) {
    const column = board.status[category] ?? [];
    for (let row = 0; row < column.length; row += 1) {
      if (column[row] === "hidden") return { category, row };
    }
  }
  return null;
}

/** All still-hidden cells of the current round - the shot-clock auto-pick pool (#10). */
export function hiddenCells(state: GameState): { category: number; row: number }[] {
  const board = state.boards[state.roundIndex];
  if (board === undefined) return [];
  const cells: { category: number; row: number }[] = [];
  for (let category = 0; category < board.status.length; category += 1) {
    const column = board.status[category] ?? [];
    for (let row = 0; row < column.length; row += 1) {
      if (column[row] === "hidden") cells.push({ category, row });
    }
  }
  return cells;
}

/** Is the given cell a hidden wager cell in the current round? */
export function isWagerCell(state: GameState, category: number, row: number): boolean {
  const board = state.boards[state.roundIndex];
  return board !== undefined && board.wagerCells.includes(cellKey(category, row));
}
