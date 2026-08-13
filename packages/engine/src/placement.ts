// Hidden wager-cell auto-placement (settings rows #23/#24), drawn from the seeded generator
// at start-game so the whole board layout is reproducible from the seed.
import { drawInteger, drawWeightedIndex } from "./rng.ts";
import { cellKey } from "./state.ts";
import type { Settings } from "@jeopardy/protocol";
import type { RoundSetup } from "./setup.ts";

// Aired-show row distribution for 5-row boards (docs/research/01-game-anatomy.md section 2:
// ~13,600 placements, seasons 1-31): never row 1, row 4 heaviest. Indexed from the TOP row.
const airedRowWeightsForFiveRows = [0, 9, 26, 39, 26];

function rowWeights(rowCount: number, mode: Settings["wagers"]["autoPlacement"]): number[] {
  if (mode === "weighted-realistic" && rowCount === 5) return airedRowWeightsForFiveRows;
  // Non-5-row boards have no aired statistics; both modes fall back to uniform over
  // rows 2..n (the "never the top row" rule still holds - it is the one universal).
  return Array.from({ length: rowCount }, (_, index) => (index === 0 ? 0 : 1));
}

export type PlacementDraw = {
  /** cellKey() strings of the placed wager cells. */
  wagerCells: string[];
  nextRngState: number;
};

/**
 * Place `count` wager cells on one round's board. TV constraint: multiple wager cells land
 * in DIFFERENT categories; when count exceeds the column count the constraint relaxes for
 * the overflow (a 3-column board can still host 4 wager cells).
 */
export function placeWagerCells(
  round: RoundSetup,
  count: number,
  mode: Settings["wagers"]["autoPlacement"],
  rngState: number,
): PlacementDraw {
  const columnCount = round.cells.length;
  const rowCount = round.cells[0]?.length ?? 0;
  const weights = rowWeights(rowCount, mode);
  const chosen = new Set<string>();
  const usedCategories = new Set<number>();
  let state = rngState;
  while (chosen.size < count) {
    const openCategories = Array.from({ length: columnCount }, (_, index) => index).filter(
      (index) => !usedCategories.has(index),
    );
    if (openCategories.length === 0) usedCategories.clear();
    const pool =
      openCategories.length > 0
        ? openCategories
        : Array.from({ length: columnCount }, (_, index) => index);
    const categoryDraw = drawInteger(state, pool.length);
    state = categoryDraw.nextState;
    const category = pool[categoryDraw.value] ?? 0;
    const rowDraw = drawWeightedIndex(state, weights);
    state = rowDraw.nextState;
    const key = cellKey(category, rowDraw.value);
    if (chosen.has(key)) continue; // same-category redraws only happen in the overflow case
    chosen.add(key);
    usedCategories.add(category);
  }
  return { wagerCells: [...chosen], nextRngState: state };
}

/** Wager-cell count for a round index: #23 is defined for two rounds; extra rounds reuse round two's. */
export function wagerCountForRound(roundIndex: number, settings: Settings): number {
  return roundIndex === 0 ? settings.wagers.countRoundOne : settings.wagers.countRoundTwo;
}
