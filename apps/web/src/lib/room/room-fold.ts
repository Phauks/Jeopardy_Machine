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

/**
 * Every timer kind, as data, so a `snapshot.timers` entry can be checked against the set the
 * engine actually has. `Record<TimerKind, true>` rather than an array: adding a kind to the
 * engine's union without adding it here is a compile error, which is the only version of this
 * list worth having.
 */
const knownTimerKinds: Record<TimerKind, true> = {
  "auto-arm": true,
  "selection-shot-clock": true,
  "buzz-window": true,
  "answer-window": true,
  "everyone-answers-window": true,
  "wager-entry": true,
  "final-wager": true,
  "final-writing": true,
  "round-time-limit": true,
};

/**
 * Turn the room's live countdowns (`snapshot.timers`, REMAINING milliseconds) into the hints
 * surfaces already render. This is what stops a reconnecting phone or a reopened host console
 * showing a frozen clock: the engine's `timer-set` events say a window opened, and a client
 * that arrived after they were broadcast has no way to learn about them at all (user-flows C6).
 *
 * `durationMs` is set to the remaining time on purpose. The room reports what is LEFT, never
 * what was originally set, and the two clocks are not synchronized - so a bar seeded this way
 * starts full and empties exactly when the window closes. It renders "how long you have",
 * which is the true statement; it does not pretend to know how much has already gone.
 *
 * Kinds this build does not recognise are dropped rather than guessed at: the wire type is a
 * string so an older client meets a newer room's timer without failing the whole snapshot.
 */
export function pendingTimersFromRoom(
  timers: readonly { kind: string; remainingMs: number }[],
  at: number,
): PendingTimerView[] {
  const hints: PendingTimerView[] = [];
  for (const timer of timers) {
    if (!Object.hasOwn(knownTimerKinds, timer.kind)) continue;
    hints.push({
      kind: timer.kind as TimerKind,
      durationMs: timer.remainingMs,
      firesAt: at + timer.remainingMs,
    });
  }
  return hints;
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
