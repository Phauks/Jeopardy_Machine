// The arming window: the DO's short-lived holding pen for one arming's buzzes, and the
// per-connection round-trip measurements that make reordering them safe. Pure functions and
// plain data only - the DO owns storage, sockets and the clock; the ordering arithmetic lives
// one layer further out in @jeopardy/protocol's room/buzz-fairness.ts, which both this module
// and the bots' race harness rank with, so the server and the harness can never disagree
// about who should have won.
//
// Why a window exists at all: reordering requires waiting. A slower phone's EARLIER press
// physically arrives after a faster phone's later one, so a room that adjudicates the instant
// the first buzz lands has already thrown the information away. The wait is bounded twice -
// by the host's setting, and by the point at which no later arrival could still win.
//
// Everything here is storage-shaped (JSON, no class instances) because the whole window is
// persisted: hibernation can evict the instance between the arm and the buzz, and losing a
// queued press would mean a clue nobody won.
import { limits } from "@jeopardy/protocol/limits";
import {
  adjudicationDeadlineMs,
  creditedReactionMs,
  orderBuzzesByFairness,
} from "@jeopardy/protocol/room/buzz-fairness";
import type { BuzzTiming } from "@jeopardy/protocol/room/buzz-fairness";

export type PendingBuzz = {
  playerId: string;
  /** Whose socket it came in on - the key the round-trip measurement is stored under. */
  connectionId: string;
  /** Server arrival, stamped at the top of onMessage before any await could skew it. */
  arrivalAt: number;
  /** The client's claim, or null when it sent none (an unwired client is never penalized). */
  claimedElapsedMs: number | null;
  sequence: number;
};

export type ArmWindow = {
  armId: number;
  /** Server clock at the moment the arm went out - t0 for every measurement in the window. */
  armedAt: number;
  rebound: boolean;
  /** How long the room may hold buzzes (settings.buzzing.compensationWindowMs); 0 = off. */
  windowMs: number;
  /** connectionId -> measured round trip, from the arm-ack of THIS arming only. */
  roundTrips: Record<string, number>;
  pending: PendingBuzz[];
  /** Server time the queue must be adjudicated at; null while nothing is queued. */
  adjudicateAt: number | null;
};

export function openArmWindow(options: {
  armId: number;
  armedAt: number;
  rebound: boolean;
  windowMs: number;
}): ArmWindow {
  return {
    armId: options.armId,
    armedAt: options.armedAt,
    rebound: options.rebound,
    windowMs: options.windowMs,
    roundTrips: {},
    pending: [],
    adjudicateAt: null,
  };
}

/**
 * Record one connection's round trip from its arm-ack. FIRST ack wins: a client cannot
 * improve its measurement by acking repeatedly, and a duplicate ack (retry, double-tap) is
 * simply ignored. Absurd samples are dropped rather than trusted - beyond
 * limits.buzz.roundTripSampleMaxMs it is a broken connection or a client stalling on purpose,
 * and either way "no measurement" (= no compensation) is the honest answer.
 */
export function recordRoundTrip(window: ArmWindow, connectionId: string, ackAt: number): boolean {
  if (window.roundTrips[connectionId] !== undefined) return false;
  const sample = ackAt - window.armedAt;
  if (sample < 0 || sample > limits.buzz.roundTripSampleMaxMs) return false;
  window.roundTrips[connectionId] = sample;
  return true;
}

/** The window's pending buzzes as the ordering module's input shape. */
export function armWindowTimings(window: ArmWindow): BuzzTiming[] {
  return window.pending.map((buzz) => ({
    playerId: buzz.playerId,
    observedMs: Math.max(buzz.arrivalAt - window.armedAt, 0),
    claimedElapsedMs: buzz.claimedElapsedMs,
    roundTripMs: window.roundTrips[buzz.connectionId] ?? null,
    sequence: buzz.sequence,
  }));
}

/**
 * Queue a buzz and recompute when the room must stop waiting. Two ceilings, whichever comes
 * first:
 *
 * - the fairness deadline: once the leader's credited reaction is R, no arrival after
 *   armedAt + R + maxCompensation could be credited faster, so the race is already decided;
 * - the host's window: never hold buzzes longer than settings.buzzing.compensationWindowMs
 *   past the FIRST press, because a room that waits too long feels broken.
 *
 * The deadline only ever moves earlier (a faster credited press shortens it), so a late
 * arrival can never extend the wait for everyone else.
 */
export function queueBuzz(window: ArmWindow, buzz: PendingBuzz): ArmWindow {
  window.pending.push(buzz);
  const timings = armWindowTimings(window);
  const best = Math.min(...timings.map((timing) => creditedReactionMs(timing)));
  const firstArrivalAt = window.pending[0]?.arrivalAt ?? buzz.arrivalAt;
  const byFairness = window.armedAt + adjudicationDeadlineMs(best);
  const byWindow = firstArrivalAt + window.windowMs;
  const deadline = Math.min(byFairness, byWindow);
  window.adjudicateAt =
    window.adjudicateAt === null ? deadline : Math.min(window.adjudicateAt, deadline);
  return window;
}

export type AdjudicatedBuzz = {
  playerId: string;
  connectionId: string;
  /** The credited press time in server terms - what the engine action is stamped with. */
  at: number;
  creditedReactionMs: number;
  arrivalAt: number;
};

/**
 * The window's buzzes in the order the engine must see them, each with the press time it is
 * credited with. The engine still receives one ordered list and still crowns the first valid
 * entry (boundary 2.1); all M6 changed is which list.
 *
 * The stamped `at` is armedAt + credited reaction, clamped to the arrival time so a press can
 * never be recorded as happening after the server heard about it. That is also what makes the
 * early-buzz lockout comparison honest: a penalty that expires at T is measured against when
 * the thumb moved, not when the packet landed.
 */
export function adjudicateArmWindow(window: ArmWindow): AdjudicatedBuzz[] {
  const byConnection = new Map(window.pending.map((buzz) => [buzz.sequence, buzz]));
  return orderBuzzesByFairness(armWindowTimings(window)).map((timing) => {
    const buzz = byConnection.get(timing.sequence);
    const credited = creditedReactionMs(timing);
    const arrivalAt = buzz?.arrivalAt ?? window.armedAt + timing.observedMs;
    return {
      playerId: timing.playerId,
      connectionId: buzz?.connectionId ?? "",
      at: Math.min(window.armedAt + credited, arrivalAt),
      creditedReactionMs: credited,
      arrivalAt,
    };
  });
}
