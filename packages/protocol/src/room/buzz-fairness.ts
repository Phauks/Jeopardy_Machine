// Buzz latency compensation - the ordering arithmetic, pure (docs/decisions/2026-08-17-buzz-
// latency-compensation.md). This module decides NOTHING about the game: it turns a set of
// buzzes that arrived at a server into the order they SHOULD be adjudicated in, and the DO
// then feeds @jeopardy/engine that ordered list. The adjudication state machine itself is
// untouched and unbranched (docs/design/expansion-and-boundaries.md boundary 2.1: fairness
// compensation is a SETTING upstream of the one state machine, never an alternative to it).
//
// The problem: with phones over Wi-Fi, server-arrival order measures the network as much as
// the thumb. A phone with a 300ms round trip loses to a 30ms phone that pressed 100ms later,
// every time, and nothing on any screen explains why.
//
// The measure we want instead is REACTION TIME: milliseconds between a phone rendering the
// arm and its human pressing. That is the TV-equivalent quantity - on the show the enable
// lights come on for everyone simultaneously, so the only thing being measured is the thumb.
//
// Three numbers per buzz, and what each is worth:
//
// | Number              | Who produced it            | Trustworthy?                          |
// | ------------------- | -------------------------- | ------------------------------------- |
// | observedMs          | the server (arrival - arm) | yes - server clock, both ends         |
// | roundTripMs         | the server (arm -> ack)    | yes, but a client can INFLATE it by   |
// |                     |                            | acking late                           |
// | claimedElapsedMs    | the client                 | no - a phone can send any number      |
//
// So the credited reaction is the MAXIMUM of the client's claim and what physics allows:
//
//   credited = max(claimedElapsedMs, observedMs - allowance),  allowance = min(roundTrip, cap)
//
// - Honest phone: claim ~= observed - actual network, allowance ~= actual network, so the two
//   terms agree and it is credited its true reaction. This is the whole point.
// - Phone that claims 0 (or omits the claim entirely): credited = observed - allowance. Lying
//   buys EXACTLY what an honest phone on the same connection is already given, and no more.
// - Phone that stalls its ack to inflate its own measured round trip: allowance is clamped at
//   the cap, so the total gain is bounded by the cap - and the same clamp is what stops a
//   genuinely 800ms-laggy phone from being handed a 800ms head start it could then exploit.
// - Phone that claims a huge elapsed: the max() makes it slower. Lying upward is always legal
//   and always self-defeating, which is the correct shape for this kind of claim.
//
// What an adversary CAN still do, stated plainly: gain up to `maxCompensationMs` over its
// true reaction, i.e. beat an honest rival who pressed up to a quarter second earlier. That
// is not a bug that can be fixed by better arithmetic - it is the price of compensating an
// unverifiable handicap at all, and it is why the credit is capped rather than uncapped. What
// an adversary CANNOT do: exceed that bound, win a race it entered after the window closed,
// or affect any buzz but its own.
import { limits } from "../limits.ts";

/** One buzz as the server saw it, with the client's (untrusted) claim attached. */
export type BuzzTiming = {
  playerId: string;
  /** Server clock: buzz arrival minus the moment the arm was broadcast. Never negative. */
  observedMs: number;
  /** The client's "ms since I rendered the arm"; null when it sent none (old/unwired client). */
  claimedElapsedMs: number | null;
  /** Server-measured round trip for this connection at THIS arming; null when unmeasured. */
  roundTripMs: number | null;
  /** Server arrival sequence, the final tie-break: earlier number = arrived first. */
  sequence: number;
};

export type FairnessOptions = {
  /** Trust ceiling; defaults to limits.buzz.maxCompensationMs. */
  maxCompensationMs?: number;
};

/**
 * How much network handicap this buzz may be credited: its measured round trip, clamped to
 * the ceiling nobody can lift. An unmeasured connection is credited NOTHING - refusing to ack
 * must never be the profitable move.
 */
export function compensationAllowanceMs(timing: BuzzTiming, options: FairnessOptions = {}): number {
  const ceiling = options.maxCompensationMs ?? limits.buzz.maxCompensationMs;
  const roundTrip = timing.roundTripMs;
  if (roundTrip === null || !Number.isFinite(roundTrip) || roundTrip <= 0) return 0;
  return Math.min(roundTrip, ceiling);
}

/**
 * The estimated reaction time this buzz is ranked by - lower wins. See the header for the
 * derivation; the clamp is the entire security argument, so it lives in one expression.
 */
export function creditedReactionMs(timing: BuzzTiming, options: FairnessOptions = {}): number {
  const allowance = compensationAllowanceMs(timing, options);
  const observed = Math.max(timing.observedMs, 0);
  const claimed =
    timing.claimedElapsedMs === null || !Number.isFinite(timing.claimedElapsedMs)
      ? 0
      : Math.max(timing.claimedElapsedMs, 0);
  // Never credit a reaction faster than the arrival minus the allowed network, and never
  // slower than the phone itself admits to. Bounded above by the observed arrival: a claim
  // cannot make a press LATER than the moment the server heard about it.
  return Math.min(Math.max(claimed, observed - allowance), observed);
}

/**
 * The buzzes in adjudication order: credited reaction ascending, server arrival as the
 * tie-break (a dead-heat down to the millisecond is decided by the network, which is as close
 * to a coin flip as this system has - and unlike an rng draw it is replayable from the log).
 */
export function orderBuzzesByFairness(
  timings: readonly BuzzTiming[],
  options: FairnessOptions = {},
): BuzzTiming[] {
  return [...timings].toSorted((left, right) => {
    const difference = creditedReactionMs(left, options) - creditedReactionMs(right, options);
    if (difference !== 0) return difference;
    return left.sequence - right.sequence;
  });
}

/**
 * The moment (ms after the arm broadcast) at which no later arrival could still win, given
 * the best credited reaction seen so far. A buzz arriving at observed O is credited at least
 * O - cap, so once O - cap exceeds the leader's credited reaction the race is decided and the
 * room can stop waiting. This is what keeps the added delay proportional to how fast somebody
 * actually was, instead of always costing a full window.
 */
export function adjudicationDeadlineMs(
  bestCreditedMs: number,
  options: FairnessOptions = {},
): number {
  const ceiling = options.maxCompensationMs ?? limits.buzz.maxCompensationMs;
  return Math.max(bestCreditedMs, 0) + ceiling;
}
