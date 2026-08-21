// The engine's single entry point: (state, action, setup) -> { state, events }. Total by
// design - an invalid or ill-timed action returns the SAME state object (reference equality
// is the contract tests rely on) plus an action-rejected event; the engine must never throw
// mid-game at a live event.
//
// Accepted actions append to state.actionLog, which makes three things the same mechanism:
// undo (replay the log minus its tail), crash recovery (replay the whole log), and the
// simulation fixtures (a JSON action array IS a game). Rejected actions and undo itself are
// never logged, so the log only ever contains actions that replay cleanly.
import { createInitialState } from "./state.ts";
import { handleArmBuzzers, handleBuzz, handleBuzzTimeout } from "./transitions/buzzing.ts";
import { handleCloseAnswers, handleJudgeSubmission } from "./transitions/everyone-answers.ts";
import {
  handleCommitFinalWager,
  handleFinalWagerTimeout,
  handleFinalWritingTimeout,
  handleJudgeFinalEntity,
  handleSubmitFinalAnswer,
} from "./transitions/final.ts";
import { handleScoreAdjust, handleScoreSet, handleTiebreakerNextClue } from "./transitions/host.ts";
import {
  handleAnswerTimeout,
  handleCancelClue,
  handleHostAward,
  handleJudge,
  handleSubmitTypedAnswer,
} from "./transitions/judging.ts";
import { handlePlayerJoin, handlePlayerLeave, handleStartGame } from "./transitions/lobby.ts";
import {
  handleEndGame,
  handleEndRound,
  handleProceed,
  handleRoundTimeout,
} from "./transitions/rounds.ts";
import {
  handleReopenCell,
  handleSelectCell,
  handleSelectionTimeout,
} from "./transitions/selection.ts";
import { handleCommitWager, handleWagerTimeout } from "./transitions/wagering.ts";
import type { GameAction } from "./actions.ts";
import type { GameEvent } from "./events.ts";
import type { GameSetup } from "./setup.ts";
import type { GameState } from "./state.ts";

export type TransitionResult = {
  state: GameState;
  events: GameEvent[];
};

/** Route one action to its handler on a mutable draft. Returns a rejection reason or null. */
function dispatch(
  draft: GameState,
  action: GameAction,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  switch (action.type) {
    case "player-join":
      return handlePlayerJoin(draft, action, setup, events);
    case "player-leave":
      return handlePlayerLeave(draft, action, events);
    case "start-game":
      return handleStartGame(draft, action, setup, events);
    case "select-cell":
      return handleSelectCell(draft, action, setup, events);
    case "selection-timeout":
      return handleSelectionTimeout(draft, action, setup, events);
    case "arm-buzzers":
      return handleArmBuzzers(draft, action, setup, events);
    case "buzz":
      return handleBuzz(draft, action, setup, events);
    case "buzz-timeout":
      return handleBuzzTimeout(draft, action, setup, events);
    case "judge":
      return handleJudge(draft, action, setup, events);
    case "answer-timeout":
      return handleAnswerTimeout(draft, action, setup, events);
    case "submit-typed-answer":
      return handleSubmitTypedAnswer(draft, action, setup, events);
    case "close-answers":
      return handleCloseAnswers(draft, action, setup, events);
    case "judge-entity":
      // Two homes for per-entity verdicts: the everyone-answers judging pass and the final
      // reveal. Phase decides; each handler rejects the other's phase.
      return draft.phase === "final-reveal"
        ? handleJudgeFinalEntity(draft, action, setup, events)
        : handleJudgeSubmission(draft, action, setup, events);
    case "commit-wager":
      return handleCommitWager(draft, action, setup, events);
    case "wager-timeout":
      return handleWagerTimeout(draft, setup, events);
    case "host-award":
      return handleHostAward(draft, action, setup, events);
    case "cancel-clue":
      return handleCancelClue(draft, action, setup, events);
    case "reopen-cell":
      return handleReopenCell(draft, action, events);
    case "score-adjust":
      return handleScoreAdjust(draft, action, events);
    case "score-set":
      return handleScoreSet(draft, action, events);
    case "end-round":
      return handleEndRound(draft, setup, events);
    case "end-game":
      return handleEndGame(draft, setup, events);
    case "round-timeout":
      return handleRoundTimeout(draft, setup, events);
    case "proceed":
      return handleProceed(draft, action, setup, events);
    case "commit-final-wager":
      return handleCommitFinalWager(draft, action, setup, events);
    case "final-wager-timeout":
      return handleFinalWagerTimeout(draft, action, setup, events);
    case "submit-final-answer":
      return handleSubmitFinalAnswer(draft, action, setup, events);
    case "final-writing-timeout":
      return handleFinalWritingTimeout(draft, setup, events);
    case "tiebreaker-next-clue":
      return handleTiebreakerNextClue(draft, events);
    case "undo":
      // Handled in transition() itself - undo needs the dispatcher for its replay.
      return "unreachable";
  }
}

export function transition(
  state: GameState,
  action: GameAction,
  setup: GameSetup,
): TransitionResult {
  if (action.type === "undo") {
    if (state.actionLog.length === 0) {
      return {
        state,
        events: [{ type: "action-rejected", action: "undo", reason: "nothing-to-undo" }],
      };
    }
    // Undo = replay the log minus its last entry over a fresh initial state. O(log) per
    // undo is fine at live-game scale (hundreds of actions), and replay-instead-of-diff
    // guarantees the result is EXACTLY the prior state - rngState, lockouts, and all.
    const undone = state.actionLog[state.actionLog.length - 1];
    let replayed = createInitialState(setup);
    for (const logged of state.actionLog.slice(0, -1)) {
      replayed = transition(replayed, logged, setup).state;
    }
    return {
      state: replayed,
      events: [{ type: "undo-applied", undoneAction: undone?.type ?? "undo" }],
    };
  }

  const draft = structuredClone(state);
  const events: GameEvent[] = [];
  const rejection = dispatch(draft, action, setup, events);
  if (rejection !== null) {
    // The draft is discarded: rejection means NO state change and no log entry. Feedback
    // events a handler pushed before rejecting (buzz-rejected, for the loser's own phone)
    // still deliver - they describe the rejection, not a state change.
    return {
      state,
      events: [...events, { type: "action-rejected", action: action.type, reason: rejection }],
    };
  }
  draft.actionLog.push(action);
  return { state: draft, events };
}
