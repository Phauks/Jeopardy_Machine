// The seam between the room transport and the pure engine: stamping relayed actions with
// server truth (arrival time, session identity) and translating the engine's timer-set
// hints into the expiry actions the alarm must dispatch later. Pure functions only - the DO
// calls these; nothing here touches partyserver or storage.
import { gameActionSchema } from "@jeopardy/engine/actions";
import { actionAuthority } from "@jeopardy/protocol/room/authority";
import type { GameAction, GameActionType } from "@jeopardy/engine/actions";
import type { GameState } from "@jeopardy/engine/state";
import type { TimerKind } from "@jeopardy/engine/events";

// timer-set kind -> the action the driver owes the engine when the clock runs out
// (packages/engine/src/events.ts documents each pairing; this table is the driver side).
export const timerExpiryAction: Record<TimerKind, GameActionType> = {
  "auto-arm": "arm-buzzers",
  "selection-shot-clock": "selection-timeout",
  "buzz-window": "buzz-timeout",
  "answer-window": "answer-timeout",
  "everyone-answers-window": "answer-timeout",
  "wager-entry": "wager-timeout",
  "final-wager": "final-wager-timeout",
  "final-writing": "final-writing-timeout",
  "round-time-limit": "round-timeout",
};

export type StampContext = {
  role: "host" | "player";
  // The sender's seat and scoring entity (player role only; null for host).
  playerId: string | null;
  entityId: string | null;
  // Server arrival time - the ONLY time the engine ever sees (arrival order is the buzz
  // ordering truth until M6 fairness compensation reorders upstream).
  at: number;
  state: GameState;
};

export type StampResult =
  | { ok: true; action: GameAction }
  | { ok: false; reason: "unauthorized" | "malformed"; detail: string };

// Stamp a relayed action with server truth, enforcing the authority matrix
// (protocol room/authority.ts). Player senders can NEVER speak for another seat: their
// playerId/entityId fields are overwritten from the session, not trusted. Host senders
// pass identity fields through (the console acting on a player's behalf, user-flows C4).
export function stampRelayedAction(
  raw: Record<string, unknown>,
  context: StampContext,
): StampResult {
  const type = typeof raw["type"] === "string" ? raw["type"] : "";
  const authority = actionAuthority[type];
  if (authority === undefined || authority === "server-only") {
    return { ok: false, reason: "unauthorized", detail: `clients cannot send ${type}` };
  }
  if (authority === "host" && context.role !== "host") {
    return { ok: false, reason: "unauthorized", detail: `${type} is host-only` };
  }
  if (authority === "player" && context.role !== "player") {
    return { ok: false, reason: "unauthorized", detail: `${type} needs a player seat` };
  }

  const candidate: Record<string, unknown> = { ...raw, at: context.at };
  if (context.role === "player") {
    // Identity overwrite table: which field carries the sender's identity per action shape.
    if (type === "buzz" || type === "submit-typed-answer") {
      candidate["playerId"] = context.playerId;
    }
    if (type === "select-cell" || type === "commit-final-wager" || type === "submit-final-answer") {
      candidate["entityId"] = context.entityId;
    }
    if (type === "commit-wager") {
      // The engine binds the wager to the clue's selector without an actor field, so the
      // transport must prove the sender IS that selector (or the host, who skips this).
      const selector = context.state.clue?.selectedBy ?? null;
      if (selector === null || selector !== context.entityId) {
        return { ok: false, reason: "unauthorized", detail: "not the wagering entity" };
      }
    }
  }

  const parsed = gameActionSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "malformed",
      detail: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  return { ok: true, action: parsed.data };
}

// Identity edits freeze while an adjudication is on screen (owner directive, user-flows
// "Post-join customization"): renaming mid-buzz would relabel the display under the host.
const identityLockedPhases = new Set<GameState["phase"]>([
  "armed",
  "answering",
  "wager-answering",
  "tiebreaker-armed",
  "tiebreaker-answering",
]);

export function identityEditsLocked(state: GameState | null): boolean {
  return state !== null && identityLockedPhases.has(state.phase);
}
