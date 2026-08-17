// The event fold: engine narration -> the view's ephemeral layer, as pure functions.
//
// Both room stores need exactly this, and they used to be one implementation short of it: the
// local-sim store folded events inline while the ws store was a stub, so the moment the socket
// landed there would have been two copies of "what does buzz-won mean for this phone". They
// are the same answer, so they are one function - the mock's tests and the wire's tests hold
// the SAME code to the same behavior, which is the only way the two stores can stay
// indistinguishable to a surface (docs/design/surfaces.md, the room-store seam).
//
// What lives here is the state the engine does NOT carry: this phone's buzz verdict, the
// judged flash, the wager ranges a timer-set/wager-cell-hit announced, and the pending timer
// hints. Everything else a surface renders comes from GameState, which the room owns.
import type { GameEvent, TimerKind } from "@jeopardy/engine/events";
import type { GameState } from "@jeopardy/engine/state";
import type {
  LastJudgedView,
  MyBuzzView,
  PendingTimerView,
  WagerRangeView,
} from "#lib/room/room-view.ts";

/** The slice of RoomView that is derived from events rather than from engine state. */
export type RoomFoldState = {
  myBuzz: MyBuzzView;
  pendingTimers: PendingTimerView[];
  lastJudged: LastJudgedView | null;
  wagerRange: WagerRangeView | null;
  finalWagerRanges: WagerRangeView[];
};

export function emptyFold(): RoomFoldState {
  return {
    myBuzz: { status: "idle" },
    pendingTimers: [],
    lastJudged: null,
    wagerRange: null,
    finalWagerRanges: [],
  };
}

/**
 * Which timer a phase can legitimately be waiting on. Exhaustive by construction, so a new
 * engine phase has to declare what it waits for rather than inheriting somebody else's clock.
 * `round-time-limit` rides alongside the per-clue windows because it spans the whole round.
 */
export function timerKindsFor(phase: GameState["phase"]): TimerKind[] {
  const round: TimerKind[] = ["round-time-limit"];
  switch (phase) {
    case "awaiting-selection":
      return [...round, "selection-shot-clock"];
    case "reading":
    case "tiebreaker-reading":
      return [...round, "auto-arm"];
    case "armed":
    case "tiebreaker-armed":
      return [...round, "buzz-window"];
    case "answering":
    case "tiebreaker-answering":
    case "wager-answering":
      return [...round, "answer-window"];
    case "wagering":
      return [...round, "wager-entry"];
    case "all-answering":
      return [...round, "everyone-answers-window"];
    case "final-wagers":
      return ["final-wager"];
    case "final-writing":
      return ["final-writing"];
    case "all-judging":
    case "final-reveal":
    case "round-break":
    case "game-over":
    case "lobby":
      return [];
  }
}

/**
 * Drop timer hints the new phase cannot be waiting on.
 *
 * The engine emits `timer-set` when a window OPENS and says nothing when one stops mattering -
 * it does not have to, because whoever owns the clock (the DO's alarm book in a real room, the
 * local-sim store's setTimeout in a mock one) cancels them on the phase change. Keeping them
 * all made `pendingTimers` accumulate: an answer window still "pending" through the rebound
 * after a wrong answer, a wager-entry window still pending while the wagerer was already
 * answering. Nothing rendered them, so nothing noticed - until the console grew a countdown at
 * the 2026-08-16 host pass and started showing the host the wrong clock.
 */
export function prunePendingTimers(
  timers: readonly PendingTimerView[],
  phase: GameState["phase"],
): PendingTimerView[] {
  const allowed = timerKindsFor(phase);
  return timers.filter((timer) => allowed.includes(timer.kind));
}

export type FoldContext = {
  /** This connection's seat, or null for host/display/spectator - decides "was that me". */
  myPlayerId: string | null;
  /** When the batch happened, for hints and flashes the event itself does not stamp. */
  at: number;
};

/**
 * Fold ONE engine event into the ephemeral layer. Returns a fresh object when something
 * changed and the same one when nothing did, so a caller assigning it to `$state.raw` gets a
 * reactive update exactly when there is one.
 */
export function foldEvent(
  state: RoomFoldState,
  event: GameEvent,
  context: FoldContext,
): RoomFoldState {
  const mine = (playerId: string): boolean =>
    context.myPlayerId !== null && playerId === context.myPlayerId;
  switch (event.type) {
    case "timer-set":
      return {
        ...state,
        pendingTimers: [
          ...state.pendingTimers.filter((entry) => entry.kind !== event.kind),
          {
            kind: event.kind,
            durationMs: event.durationMs,
            firesAt: context.at + event.durationMs,
          },
        ],
      };
    case "buzzers-armed":
      // A fresh arming resets everyone's per-phone verdict; my early lockout survives on
      // purpose - the penalty ring outlives the re-arm it was earned before.
      if (state.myBuzz.status === "rejected" && state.myBuzz.reason === "early-lockout") {
        return state;
      }
      return { ...state, myBuzz: { status: "idle" } };
    case "early-buzz":
      if (!mine(event.playerId)) return state;
      return {
        ...state,
        myBuzz: { status: "rejected", reason: "early-lockout", lockedUntil: event.lockedUntil },
      };
    case "buzz-won":
      if (!mine(event.playerId)) return state;
      return { ...state, myBuzz: { status: "won", at: event.at } };
    case "buzz-rejected":
      if (!mine(event.playerId) || event.reason === "unknown-player") return state;
      return {
        ...state,
        myBuzz: { status: "rejected", reason: event.reason, lockedUntil: null },
      };
    case "judged":
    case "final-judged":
      return {
        ...state,
        lastJudged: {
          entityId: event.entityId,
          verdict: event.verdict,
          delta: event.delta,
          at: context.at,
        },
      };
    case "wager-cell-hit":
      return {
        ...state,
        wagerRange: {
          entityId: event.entityId,
          minimum: event.minimum,
          maximum: event.maximum,
          label: event.label,
        },
      };
    case "wager-committed":
      return { ...state, wagerRange: null };
    case "final-wagers-open":
      return {
        ...state,
        finalWagerRanges: event.ranges.map((range) => ({ ...range, label: "Final wager" })),
      };
    case "cell-selected":
      return { ...state, myBuzz: { status: "idle" }, lastJudged: null };
    case "clue-finished":
      return { ...state, wagerRange: null, pendingTimers: [] };
    case "round-break":
    case "game-over":
      return { ...state, pendingTimers: [] };
    default:
      return state;
  }
}
