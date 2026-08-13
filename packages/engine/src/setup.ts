// The static per-game inputs to every transition: resolved settings, the concrete board
// material (values only - the engine never sees prompt/answer text; content stays in the
// content layer per guiding principle 6), whether a final clue exists, and the seed. The
// setup is deliberately NOT part of GameState: it never changes mid-game, so state stays a
// pure product of setup + action log (the replay/undo invariant in transition.ts).
import { presetRowValues, resolveGameRules } from "@jeopardy/protocol";
import type { GameDefinitionBody, Settings } from "@jeopardy/protocol";

export type CellSetup = {
  /** Fully resolved score value for this cell (row value x round multiplier, or authored). */
  value: number;
  /** Authored wager cell (protocol cell.wager) - truth when the round places manually. */
  authoredWager: boolean;
};

export type RoundSetup = {
  /** cells[categoryIndex][rowIndex]; rectangular per round. */
  cells: CellSetup[][];
  /**
   * auto: the engine places hidden wager cells at start-game from settings rows #23/#24.
   * manual: exactly the authoredWager cells are wager cells (authored data wins).
   */
  wagerPlacement: "auto" | "manual";
  /** The round's top row value AFTER multiplier - the wager maximum floor under the TV rule (#26). */
  topRowValue: number;
};

export type GameSetup = {
  settings: Settings;
  rounds: RoundSetup[];
  /** False when the game definition authored no final slot - skips the final regardless of #29. */
  hasFinalClue: boolean;
  /** Seed for all engine randomness; the same seed + action log is the identical game. */
  seed: string;
};

/** Rounds actually played: the authored rounds capped by settings row #1. */
export function playedRoundCount(setup: GameSetup): number {
  return Math.min(setup.rounds.length, setup.settings.structure.roundCount);
}

/**
 * Collapse a game definition body to the engine's board material. Value resolution: an
 * authored cell value is truth as-is; otherwise row value from the definition's value scheme
 * times the round's authored multiplier. Content items are deliberately left behind - the
 * hosting layer maps (round, category, row) back to prompts itself.
 */
export function setupFromGameDefinition(body: GameDefinitionBody, seed: string): GameSetup {
  const settings = resolveGameRules(body.rules);
  const rounds = body.rounds.map((round) => {
    const rowCount = Math.max(...round.categories.map((category) => category.cells.length));
    const rowValues =
      body.valueScheme.kind === "preset"
        ? presetRowValues(body.valueScheme.preset, rowCount)
        : body.valueScheme.rowValues;
    const cells = round.categories.map((category) =>
      category.cells.map((cell, rowIndex) => ({
        value: cell.value ?? Math.round((rowValues[rowIndex] ?? 0) * round.valueMultiplier),
        authoredWager: cell.wager,
      })),
    );
    return {
      cells,
      wagerPlacement: round.wagerPlacement,
      topRowValue: Math.round((rowValues[rowCount - 1] ?? 0) * round.valueMultiplier),
    };
  });
  return { settings, rounds, hasFinalClue: body.final !== null, seed };
}

export type PlainBoardSetup = {
  columns: number;
  rows: number;
  /** Row values lowest first; defaults to the tv preset ladder for the row count. */
  rowValues?: number[];
  valueMultiplier?: number;
  wagerPlacement?: "auto" | "manual";
  /** [categoryIndex, rowIndex] pairs to mark as authored wager cells. */
  authoredWagers?: [number, number][];
};

/**
 * Board material without a game definition - the shape tests, fixtures, and the hotseat page
 * build from. Same resolution rules as setupFromGameDefinition.
 */
export function plainRoundSetup(board: PlainBoardSetup): RoundSetup {
  const rowValues = board.rowValues ?? presetRowValues("tv", board.rows);
  const multiplier = board.valueMultiplier ?? 1;
  const authored = new Set((board.authoredWagers ?? []).map(([column, row]) => `${column}:${row}`));
  const cells = Array.from({ length: board.columns }, (_unusedColumn, categoryIndex) =>
    Array.from({ length: board.rows }, (_unusedRow, rowIndex) => ({
      value: Math.round((rowValues[rowIndex] ?? 0) * multiplier),
      authoredWager: authored.has(`${categoryIndex}:${rowIndex}`),
    })),
  );
  return {
    cells,
    wagerPlacement: board.wagerPlacement ?? "auto",
    topRowValue: Math.round((rowValues[board.rows - 1] ?? 0) * multiplier),
  };
}
