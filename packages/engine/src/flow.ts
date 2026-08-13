// Shared game-flow spine: presenting a clue, closing it, ending a round, starting one.
// Handler modules compose these; they mutate the draft state and append events (the draft
// convention is set in transition.ts - handlers receive a structuredClone and may mutate).
import { isWagerCell, nextEntityInRotation, nextSweepCell } from "./control.ts";
import { playedRoundCount } from "./setup.ts";
import type { GameEvent } from "./events.ts";
import type { GameSetup } from "./setup.ts";
import type { GameState } from "./state.ts";

export function cellValue(
  setup: GameSetup,
  roundIndex: number,
  category: number,
  row: number,
): number {
  return setup.rounds[roundIndex]?.cells[category]?.[row]?.value ?? 0;
}

/** The wager ceiling for the current round (#26). */
export function maximumWager(setup: GameSetup, roundIndex: number, score: number): number {
  const rule = setup.settings.wagers.maximumWagerRule;
  if (rule === "unlimited") return 1_000_000_000;
  const floor = setup.settings.wagers.minimumWager;
  if (rule === "score-only") return Math.max(score, floor);
  return Math.max(score, setup.rounds[roundIndex]?.topRowValue ?? 0, floor);
}

/** Enter awaiting-selection, emitting the shot-clock hint (#10) when configured. */
export function enterAwaitingSelection(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
): void {
  draft.phase = "awaiting-selection";
  const shotClock = setup.settings.boardControl.selectionShotClockMs;
  if (shotClock !== null) {
    events.push({ type: "timer-set", kind: "selection-shot-clock", durationMs: shotClock, at });
  }
}

/**
 * Present the cell at (category, row): wager cells detour through the wagering phase, plain
 * clues enter reading. selectedBy is the controlling entity - on a wager cell with NO
 * controlling entity (host-picks or auto-sweep games) the cell plays as a plain clue, since
 * a wager needs a bettor; the host retains score-adjust as the escape hatch.
 */
export function presentClue(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
  category: number,
  row: number,
  autoSelected: boolean,
): void {
  const value = cellValue(setup, draft.roundIndex, category, row);
  const selectedBy = draft.controlEntity;
  const wagerCell = isWagerCell(draft, category, row) && selectedBy !== null;
  draft.clue = {
    roundIndex: draft.roundIndex,
    category,
    row,
    value,
    isWagerClue: wagerCell,
    wager: null,
    selectedBy,
    lockedOutEntities: [],
    earlyLockedUntil: {},
    buzzWinner: null,
    armedAt: null,
    armingCount: 0,
    submissions: {},
    entityVerdicts: {},
    answersOpenedAt: null,
  };
  events.push({
    type: "cell-selected",
    roundIndex: draft.roundIndex,
    category,
    row,
    value,
    autoSelected,
  });

  if (wagerCell && selectedBy !== null) {
    draft.phase = "wagering";
    const score = draft.scores[selectedBy] ?? 0;
    events.push({
      type: "wager-cell-hit",
      label: setup.settings.wagers.label,
      entityId: selectedBy,
      minimum: setup.settings.wagers.minimumWager,
      maximum: maximumWager(setup, draft.roundIndex, score),
    });
    const wagerTimer = setup.settings.wagers.wagerTimerMs;
    if (wagerTimer !== null) {
      events.push({ type: "timer-set", kind: "wager-entry", durationMs: wagerTimer, at });
    }
    return;
  }

  draft.phase = "reading";
  const everyoneAnswers = setup.settings.answerMode.everyoneAnswers !== "off";
  events.push({ type: "clue-presented", isWagerClue: false, everyoneAnswers });
  if (setup.settings.buzzing.armMode === "auto-after-delay") {
    events.push({
      type: "timer-set",
      kind: "auto-arm",
      durationMs: setup.settings.buzzing.autoArmDelayMs,
      at,
    });
  }
}

/**
 * Close the current clue: mark the cell played, advance rotations, and route to whatever
 * comes next (next sweep cell, selection, round end). `resolution` and `reveal` feed the
 * clue-finished event (#42 decides how a dead clue's answer reaches the room).
 */
export function closeClue(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
  resolution: "correct" | "dead" | "cancelled",
): void {
  const clue = draft.clue;
  if (clue === null) return;
  const board = draft.boards[clue.roundIndex];
  const column = board?.status[clue.category];
  if (column !== undefined) column[clue.row] = "played";
  draft.clue = null;

  // Rotating-captain buzzers (#35) advance once per played clue, so every member gets turns.
  for (const team of Object.values(draft.teams)) team.captainRotation += 1;

  const reveal = resolution === "dead" ? setup.settings.presentation.deadClueReveal : null;
  events.push({ type: "clue-finished", resolution, reveal });

  // Board control (#7): last-correct is assigned at judging time; rotation advances here so
  // cancelled and dead clues rotate too (every played clue is a turn).
  if (setup.settings.boardControl.nextSelector === "rotate") {
    draft.controlEntity = nextEntityInRotation(draft);
    events.push({ type: "control-assigned", entityId: draft.controlEntity, reason: "rotation" });
  }

  const remaining =
    board === undefined ? 0 : board.status.flat().filter((status) => status === "hidden").length;
  if (remaining === 0 || board?.timeExpired === true) {
    endRound(draft, setup, events);
    return;
  }

  if (setup.settings.boardControl.nextSelector === "auto-sweep") {
    const next = nextSweepCell(draft);
    if (next !== null) {
      presentClue(draft, setup, events, at, next.category, next.row, true);
      return;
    }
  }
  enterAwaitingSelection(draft, setup, events, at);
}

/** What follows the current round: another board round, the final, or the end of the game. */
export function nextStageAfterRound(
  draft: GameState,
  setup: GameSetup,
): "round" | "final" | "game-over" {
  if (draft.roundIndex + 1 < playedRoundCount(setup)) return "round";
  if (setup.settings.final.enabled && setup.hasFinalClue) return "final";
  return "game-over";
}

/** End the current board round into a round break (host proceeds from there). */
export function endRound(draft: GameState, setup: GameSetup, events: GameEvent[]): void {
  const board = draft.boards[draft.roundIndex];
  const unplayed =
    board === undefined ? 0 : board.status.flat().filter((status) => status === "hidden").length;
  events.push({ type: "round-ended", roundIndex: draft.roundIndex, unplayedCells: unplayed });
  const nextStage = nextStageAfterRound(draft, setup);
  draft.phase = "round-break";
  draft.breakNextStage = nextStage;
  events.push({ type: "round-break", nextStage });
}

/** Start the board round at draft.roundIndex: assign the opening selector (#8/#9), arm timers. */
export function startRound(
  draft: GameState,
  setup: GameSetup,
  events: GameEvent[],
  at: number,
  selector: { entityId: string | null; nextRngState: number },
): void {
  draft.rngState = selector.nextRngState;
  draft.breakNextStage = null;
  events.push({ type: "round-started", roundIndex: draft.roundIndex });
  const timeLimit = setup.settings.structure.roundTimeLimitMs;
  if (timeLimit !== null) {
    events.push({ type: "timer-set", kind: "round-time-limit", durationMs: timeLimit, at });
  }
  draft.controlEntity = selector.entityId;
  if (draft.roundIndex === 0) draft.firstSelectorRoundOne = selector.entityId;
  events.push({ type: "control-assigned", entityId: selector.entityId, reason: "first-selector" });

  if (setup.settings.boardControl.nextSelector === "auto-sweep") {
    draft.controlEntity = null;
    const next = nextSweepCell(draft);
    if (next !== null) {
      presentClue(draft, setup, events, at, next.category, next.row, true);
      return;
    }
  }
  enterAwaitingSelection(draft, setup, events, at);
}
