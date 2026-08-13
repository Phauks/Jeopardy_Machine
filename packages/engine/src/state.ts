// GameState: everything mutable about a live game, as plain JSON-safe data. Invariant that
// everything else hangs off: state is a pure fold of the action log over the initial state -
// createInitialState(setup) + actionLog replayed through transition() reproduces this exact
// object (rngState included). That makes undo a replay, crash recovery a replay, and every
// bug report a fixture.
import { rngStateFromSeed } from "./rng.ts";
import type { GameAction } from "./actions.ts";
import type { GameSetup } from "./setup.ts";

export type GamePhase =
  | "lobby"
  | "awaiting-selection" // board up, someone must pick a cell
  | "reading" // clue shown, buzzers dead (early buzzes penalized here)
  | "armed" // buzz window open
  | "answering" // buzz winner holds the floor, host judges
  | "wagering" // wager cell hit: the selector commits an amount
  | "wager-answering" // wager committed, clue shown, only the selector answers
  | "all-answering" // #22 everyone-answers: every phone types within the window
  | "all-judging" // #22: submissions in, host verdicts each entity
  | "round-break" // between rounds / before final / before game over
  | "final-wagers"
  | "final-writing"
  | "final-reveal"
  | "tiebreaker-reading" // #37 sudden death reuses the buzz machinery, no scores
  | "tiebreaker-armed"
  | "tiebreaker-answering"
  | "game-over";

export type PlayerState = {
  id: string;
  name: string;
  /** null outside teams mode. */
  teamId: string | null;
  connected: boolean;
};

export type TeamState = {
  id: string;
  name: string;
  memberIds: string[];
  /** Rotating-captain buzzer mode (#35): index into memberIds, advanced per clue. */
  captainRotation: number;
};

export type CellStatus = "hidden" | "played";

export type RoundBoardState = {
  /** status[categoryIndex][rowIndex]. */
  status: CellStatus[][];
  /** "category:row" keys of hidden wager cells (placed at start-game or authored). */
  wagerCells: string[];
  /** #6: set by round-timeout mid-clue so the round ends when the clue resolves. */
  timeExpired: boolean;
};

export type ClueState = {
  roundIndex: number;
  category: number;
  row: number;
  /** Face value (already multiplied); the stake for non-wager clues. */
  value: number;
  isWagerClue: boolean;
  /** Committed wager amount; null until commit-wager. */
  wager: number | null;
  /** Entity that selected the cell (answers alone on a wager clue). */
  selectedBy: string | null;
  /** Entities barred from this clue (#16 wrong answerers; tiebreaker eliminations). */
  lockedOutEntities: string[];
  /**
   * Early-buzz penalties (#12): participant key -> locked-until timestamp. Keyed by playerId
   * normally, by teamId under team-wide penalties (#36).
   */
  earlyLockedUntil: Record<string, number>;
  /** The adjudicated buzz winner for the CURRENT arming; exactly one buzz-won per arming. */
  buzzWinner: { playerId: string; entityId: string } | null;
  /** Timestamp of the current arming; null while reading. */
  armedAt: number | null;
  /** How many times this clue has armed (1 + rebounds) - the one-buzz-won-per-arming counter. */
  armingCount: number;
  /** #22 everyone-answers submissions: entityId -> first submission. */
  submissions: Record<string, { playerId: string; text: string; at: number }>;
  /** #22: entity -> verdict during all-judging. */
  entityVerdicts: Record<string, "correct" | "wrong">;
  /** #22: when the answering window opened (speed-weighted scoring measures from here). */
  answersOpenedAt: number | null;
};

export type FinalRoundState = {
  eligible: string[];
  /** Entity -> committed wager. */
  wagers: Record<string, number>;
  /** Entity -> answer text (empty submissions allowed; absent entity = never answered). */
  answers: Record<string, { text: string; at: number }>;
  /** Scores frozen when the final started - the reveal order and drama math use these. */
  prefinalScores: Record<string, number>;
  /** Reveal plan (#33): batched entities judge in any order, then individual in order. */
  individualOrder: string[];
  batchedEntities: string[];
  /** Index into individualOrder: next entity to reveal. */
  revealIndex: number;
  judged: Record<string, "correct" | "wrong">;
};

export type TiebreakerState = {
  participants: string[];
  /** Eliminated from the current tiebreaker clue (wrong answer); reset per clue. */
  eliminated: string[];
  /** Buzz winner of the current tiebreaker arming; the sudden-death clue carries no value. */
  buzzWinner: { playerId: string; entityId: string } | null;
  armedAt: number | null;
};

export type GameState = {
  phase: GamePhase;
  players: Record<string, PlayerState>;
  teams: Record<string, TeamState>;
  /** Scoring-entity ids in join order - rotation order (#7 rotate) and tie-shuffle basis. */
  entityOrder: string[];
  scores: Record<string, number>;
  /** Index into the PLAYED rounds (setup rounds capped by settings #1). */
  roundIndex: number;
  boards: RoundBoardState[];
  /** Whoever picks next (#7); null = host picks / nobody yet. */
  controlEntity: string | null;
  /** Round one's first selector, kept for #9 same-as-round-one. */
  firstSelectorRoundOne: string | null;
  clue: ClueState | null;
  /** What the current round-break leads to. */
  breakNextStage: "round" | "final" | "game-over" | null;
  final: FinalRoundState | null;
  tiebreaker: TiebreakerState | null;
  /** Winners at game-over ([] = no winner); null until then. */
  winners: string[] | null;
  /** Append-only accepted-action log; undo pops the tail and replays. */
  actionLog: GameAction[];
  rngState: number;
};

export function createInitialState(setup: GameSetup): GameState {
  return {
    phase: "lobby",
    players: {},
    teams: {},
    entityOrder: [],
    scores: {},
    roundIndex: 0,
    boards: [],
    controlEntity: null,
    firstSelectorRoundOne: null,
    clue: null,
    breakNextStage: null,
    final: null,
    tiebreaker: null,
    winners: null,
    actionLog: [],
    rngState: rngStateFromSeed(setup.seed),
  };
}

/** The scoring entity a player acts as: their team in teams mode, themselves otherwise. */
export function entityForPlayer(state: GameState, playerId: string): string | null {
  const player = state.players[playerId];
  if (player === undefined) return null;
  return player.teamId ?? player.id;
}

export function cellKey(category: number, row: number): string {
  return `${String(category)}:${String(row)}`;
}
