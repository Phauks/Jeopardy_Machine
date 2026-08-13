// Events a transition emits alongside the new state: the engine's narration for drivers
// (host console, board display, room audio, bots). Events are DERIVED - replaying the action
// log regenerates them - so they are never stored in GameState. Two contracts matter:
//
// - buzz-won fires EXACTLY ONCE per arming (owner directive "Only the winning buzz is
//   heard"): room audio keys off this event alone, so overlapping buzz sounds are
//   structurally impossible. buzz-rejected is per-phone silent feedback, never room audio.
// - timer-set is a scheduling HINT: the driver owns the clock and answers with the named
//   expiry action; the engine never times anything itself.
import type { GameActionType, Verdict } from "./actions.ts";

export type TimerKind =
  | "auto-arm" // #11 auto-after-delay: dispatch arm-buzzers when it fires
  | "selection-shot-clock" // #10 -> selection-timeout
  | "buzz-window" // #13 -> buzz-timeout
  | "answer-window" // #14 -> answer-timeout
  | "everyone-answers-window" // #22 -> answer-timeout
  | "wager-entry" // #27 -> wager-timeout
  | "final-wager" // #27 reused for the final -> final-wager-timeout
  | "final-writing" // #32 -> final-writing-timeout
  | "round-time-limit"; // #6 -> round-timeout

export type StandingsEntry = {
  entityId: string;
  name: string;
  score: number;
  /** 1-based; tied entities share a placement number. */
  placement: number;
};

export type FinalRevealEntry = {
  entityId: string;
  answerText: string | null;
  wager: number;
};

export type GameEvent =
  | { type: "action-rejected"; action: GameActionType; reason: string }
  | { type: "player-joined"; playerId: string; entityId: string; lateJoin: boolean; score: number }
  // host-prompt late-join policy (#43): the engine seats them at 0 and asks the host to set
  // the real score via score-set - the override IS the mechanism, not an afterthought.
  | { type: "late-join-score-needed"; playerId: string; entityId: string }
  | { type: "player-left"; playerId: string }
  | { type: "game-started"; entityCount: number }
  | { type: "round-started"; roundIndex: number }
  | {
      type: "control-assigned";
      entityId: string | null; // null: host picks (#7 host-picks) or nobody holds control yet
      reason: "first-selector" | "correct-answer" | "rotation" | "carried" | "wager-holder";
    }
  | {
      type: "cell-selected";
      roundIndex: number;
      category: number;
      row: number;
      value: number;
      autoSelected: boolean; // #7 auto-sweep / #10 shot-clock expiry pick
    }
  | { type: "wager-cell-hit"; label: string; entityId: string; minimum: number; maximum: number }
  | { type: "wager-committed"; entityId: string; amount: number; forced: boolean }
  | { type: "clue-presented"; isWagerClue: boolean; everyoneAnswers: boolean }
  | { type: "timer-set"; kind: TimerKind; durationMs: number; at: number }
  | { type: "buzzers-armed"; rebound: boolean; armedAt: number }
  | { type: "early-buzz"; playerId: string; entityId: string; lockedUntil: number }
  | { type: "buzz-won"; playerId: string; entityId: string; at: number }
  | {
      type: "buzz-rejected";
      playerId: string;
      reason:
        | "not-armed"
        | "early-lockout"
        | "too-late"
        | "locked-out"
        | "not-captain"
        | "unknown-player";
    }
  | { type: "answers-open"; at: number }
  | { type: "answer-submitted"; playerId: string; entityId: string; text: string }
  | { type: "answers-closed"; submittedCount: number }
  | {
      type: "judged";
      entityId: string;
      verdict: Verdict | "timeout";
      delta: number;
      score: number;
    }
  | { type: "rebound-armed"; remainingEntities: string[] }
  | {
      type: "clue-finished";
      resolution: "correct" | "dead" | "cancelled";
      // #42: how a dead clue's answer reaches the room; null when someone got it.
      reveal: "auto-display" | "host-reads" | null;
    }
  | { type: "cell-reopened"; category: number; row: number }
  | { type: "score-adjusted"; entityId: string; delta: number; score: number }
  | { type: "round-ended"; roundIndex: number; unplayedCells: number }
  | { type: "round-break"; nextStage: "round" | "final" | "game-over" }
  | { type: "final-skipped"; reason: "disabled" | "not-authored" | "nobody-eligible" }
  | {
      type: "final-wagers-open";
      // Per-entity allowed range (#30/#31) - the host mirror shows these, phones get theirs.
      ranges: { entityId: string; minimum: number; maximum: number }[];
    }
  | { type: "final-wager-committed"; entityId: string; forced: boolean }
  | { type: "final-writing-open"; eligible: string[] }
  | { type: "final-answer-submitted"; entityId: string }
  | {
      type: "final-reveal-started";
      // #33: individual entries reveal one at a time lowest-pre-final-score-first; batched
      // entries land as one group (top-contenders batches the field, leaderboard batches all).
      individualOrder: string[];
      batched: FinalRevealEntry[];
    }
  | { type: "final-reveal-next"; entry: FinalRevealEntry; prefinalScore: number }
  | {
      type: "final-judged";
      entityId: string;
      verdict: "correct" | "wrong";
      delta: number;
      score: number;
    }
  | { type: "tiebreaker-started"; participants: string[] }
  | { type: "tiebreaker-clue-dealt"; eliminated: string[] }
  | {
      type: "game-over";
      standings: StandingsEntry[];
      winners: string[]; // empty = no winner (#38 no-winner)
      note: "clean" | "co-champions" | "shared-placement" | "sudden-death" | "no-winner";
    }
  | { type: "undo-applied"; undoneAction: GameActionType };
