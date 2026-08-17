// The fairness arithmetic under honest AND adversarial inputs. The claim this file has to
// earn is narrow and exact (docs/decisions/2026-08-17-buzz-latency-compensation.md): a client
// controls one of the three numbers, and the clamp is what makes that safe. Every "cheater"
// case below is written as the attack it is, with the bound it must not exceed.
import { describe, expect, it } from "vitest";
import { limits } from "../limits.ts";
import {
  adjudicationDeadlineMs,
  compensationAllowanceMs,
  creditedReactionMs,
  orderBuzzesByFairness,
} from "./buzz-fairness.ts";
import type { BuzzTiming } from "./buzz-fairness.ts";

// One phone's buzz, described the way a venue would: how fast the network is, how fast the
// thumb was, and what the phone chose to claim.
function buzzFrom(options: {
  playerId: string;
  roundTripMs: number;
  reactionMs: number;
  sequence: number;
  /** What the phone SAYS its reaction was; defaults to the truth. */
  claimedElapsedMs?: number | null;
  /** What the server measured; defaults to the real round trip (an honest, prompt ack). */
  measuredRoundTripMs?: number | null;
}): BuzzTiming {
  return {
    playerId: options.playerId,
    // Arrival = the arm going out, plus the trip to the phone, plus the thumb, plus the trip
    // back. Which is exactly `roundTrip + reaction` measured from the broadcast.
    observedMs: options.roundTripMs + options.reactionMs,
    claimedElapsedMs:
      options.claimedElapsedMs === undefined ? options.reactionMs : options.claimedElapsedMs,
    roundTripMs:
      options.measuredRoundTripMs === undefined ? options.roundTripMs : options.measuredRoundTripMs,
    sequence: options.sequence,
  };
}

describe("credited reaction: honest phones", () => {
  it("recovers the true reaction time from a slow connection", () => {
    const slow = buzzFrom({ playerId: "p1", roundTripMs: 220, reactionMs: 180, sequence: 1 });
    expect(slow.observedMs).toBe(400); // arrival order would call this a 400ms press
    expect(creditedReactionMs(slow)).toBe(180); // compensation calls it what it was
  });

  it("credits a fast connection exactly what it earned - no penalty for being fast", () => {
    const fast = buzzFrom({ playerId: "p1", roundTripMs: 20, reactionMs: 300, sequence: 1 });
    expect(creditedReactionMs(fast)).toBe(300);
  });

  it("compensates only up to the ceiling for a connection worse than the ceiling", () => {
    // A 600ms round trip is beyond what any client may be credited: 250ms of it is cancelled
    // and the phone still carries the rest. Honest but unverifiable, so only partly trusted.
    const dire = buzzFrom({ playerId: "p1", roundTripMs: 600, reactionMs: 200, sequence: 1 });
    expect(compensationAllowanceMs(dire)).toBe(limits.buzz.maxCompensationMs);
    expect(creditedReactionMs(dire)).toBe(800 - 250);
  });

  it("falls back to arrival order for a phone that never acked (no measurement, no credit)", () => {
    const unmeasured = buzzFrom({
      playerId: "p1",
      roundTripMs: 200,
      reactionMs: 100,
      sequence: 1,
      measuredRoundTripMs: null,
      claimedElapsedMs: null,
    });
    expect(compensationAllowanceMs(unmeasured)).toBe(0);
    expect(creditedReactionMs(unmeasured)).toBe(unmeasured.observedMs);
  });

  it("uses the client's claim to correct a round trip inflated by the client's own jank", () => {
    // The phone was busy painting and acked 120ms late, so the measured round trip is 120ms
    // too generous. Its honest elapsed claim pulls the credit back to the truth.
    const janky = buzzFrom({
      playerId: "p1",
      roundTripMs: 60,
      reactionMs: 200,
      sequence: 1,
      measuredRoundTripMs: 180,
    });
    expect(creditedReactionMs(janky)).toBe(200);
  });
});

describe("credited reaction: adversarial claims", () => {
  const ceiling = limits.buzz.maxCompensationMs;

  it("gains a liar nothing beyond what an honest phone on that connection already gets", () => {
    const honest = buzzFrom({ playerId: "p1", roundTripMs: 80, reactionMs: 400, sequence: 1 });
    const liar = buzzFrom({
      playerId: "p2",
      roundTripMs: 80,
      reactionMs: 400,
      sequence: 2,
      claimedElapsedMs: 0,
    });
    // The invariant, not the arithmetic: the lie is floored by physics, so it lands on the
    // same credited reaction the honest phone beside it is given.
    expect(creditedReactionMs(liar)).toBe(liar.observedMs - 80);
    expect(creditedReactionMs(liar)).toBe(creditedReactionMs(honest));
  });

  it("bounds the whole attack surface: claiming zero can never beat the ceiling", () => {
    // Sweep every plausible connection and every plausible reaction; the credited reaction of
    // a phone claiming 0 is never more than the ceiling below its true reaction.
    for (const roundTripMs of [0, 15, 60, 150, 250, 400, 900]) {
      for (const reactionMs of [0, 50, 200, 600, 1500]) {
        const truthful = buzzFrom({ playerId: "p1", roundTripMs, reactionMs, sequence: 1 });
        const cheat = buzzFrom({
          playerId: "p2",
          roundTripMs,
          reactionMs,
          sequence: 2,
          claimedElapsedMs: 0,
        });
        const gain = creditedReactionMs(truthful) - creditedReactionMs(cheat);
        expect(gain, `rtt ${String(roundTripMs)} reaction ${String(reactionMs)}`).toBe(0);
        expect(creditedReactionMs(cheat)).toBeGreaterThanOrEqual(reactionMs - ceiling);
      }
    }
  });

  it("bounds the stalled-ack attack: inflating the measurement buys at most the ceiling", () => {
    // The strongest cheat available: claim zero reaction AND stall the ack so the measured
    // round trip is enormous. Both clamps engage; the gain stops at the ceiling.
    const stalled = buzzFrom({
      playerId: "p1",
      roundTripMs: 40,
      reactionMs: 500,
      sequence: 1,
      claimedElapsedMs: 0,
      measuredRoundTripMs: 5000,
    });
    expect(creditedReactionMs(stalled)).toBe(540 - ceiling);
    expect(500 - creditedReactionMs(stalled)).toBeLessThanOrEqual(ceiling);
  });

  it("never lets a claim make a press faster than physics or later than its own arrival", () => {
    const impossible: BuzzTiming = {
      playerId: "p1",
      observedMs: 120,
      claimedElapsedMs: -5000,
      roundTripMs: 30,
      sequence: 1,
    };
    expect(creditedReactionMs(impossible)).toBe(90);
    const sandbagging: BuzzTiming = {
      playerId: "p2",
      observedMs: 120,
      claimedElapsedMs: 9000,
      roundTripMs: 30,
      sequence: 2,
    };
    expect(creditedReactionMs(sandbagging)).toBe(120);
  });

  it("ignores nonsense numbers instead of trusting them (NaN, negative, infinite)", () => {
    const garbage: BuzzTiming = {
      playerId: "p1",
      observedMs: 300,
      claimedElapsedMs: Number.NaN,
      roundTripMs: Number.POSITIVE_INFINITY,
      sequence: 1,
    };
    expect(compensationAllowanceMs(garbage)).toBe(0);
    expect(creditedReactionMs(garbage)).toBe(300);
    expect(compensationAllowanceMs({ ...garbage, roundTripMs: -50 })).toBe(0);
  });
});

describe("ordering", () => {
  it("crowns the slow-connection phone that pressed first over the fast one that pressed later", () => {
    // The headline scenario, and the one arrival order gets wrong: 180ms thumb on 300ms Wi-Fi
    // vs 260ms thumb on 30ms Wi-Fi. Arrival says the fast phone; reaction says the first thumb.
    const slowButEarlier = buzzFrom({
      playerId: "slow",
      roundTripMs: 300,
      reactionMs: 180,
      sequence: 2,
    });
    const fastButLater = buzzFrom({
      playerId: "fast",
      roundTripMs: 30,
      reactionMs: 260,
      sequence: 1,
    });
    expect(fastButLater.observedMs).toBeLessThan(slowButEarlier.observedMs); // arrival: fast wins
    expect(orderBuzzesByFairness([fastButLater, slowButEarlier])[0]?.playerId).toBe("slow");
  });

  it("keeps arrival order when the connections are equal (fair Wi-Fi changes nothing)", () => {
    const first = buzzFrom({ playerId: "a", roundTripMs: 40, reactionMs: 200, sequence: 1 });
    const second = buzzFrom({ playerId: "b", roundTripMs: 40, reactionMs: 260, sequence: 2 });
    expect(orderBuzzesByFairness([second, first]).map((entry) => entry.playerId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("breaks a dead heat by arrival - deterministic and replayable from the log", () => {
    const left = buzzFrom({ playerId: "a", roundTripMs: 50, reactionMs: 200, sequence: 7 });
    const right = buzzFrom({ playerId: "b", roundTripMs: 50, reactionMs: 200, sequence: 3 });
    expect(orderBuzzesByFairness([left, right])[0]?.playerId).toBe("b");
    // Same inputs, same answer, every time: no rng in the ordering path.
    expect(orderBuzzesByFairness([right, left])[0]?.playerId).toBe("b");
  });

  it("does not reorder a phone that refused to be measured ahead of a measured one", () => {
    const measured = buzzFrom({
      playerId: "measured",
      roundTripMs: 250,
      reactionMs: 150,
      sequence: 2,
    });
    const silent = buzzFrom({
      playerId: "silent",
      roundTripMs: 250,
      reactionMs: 150,
      sequence: 1,
      measuredRoundTripMs: null,
      claimedElapsedMs: 0,
    });
    expect(orderBuzzesByFairness([silent, measured])[0]?.playerId).toBe("measured");
  });
});

describe("adjudication deadline", () => {
  it("stops waiting once no later arrival could still win", () => {
    // A 40ms reaction leads: anything arriving after 40 + ceiling is credited slower even in
    // the best case, so the room crowns the winner then instead of holding a full window.
    expect(adjudicationDeadlineMs(40)).toBe(40 + limits.buzz.maxCompensationMs);
    expect(adjudicationDeadlineMs(-10)).toBe(limits.buzz.maxCompensationMs);
  });

  it("is never shorter than the credit it has to be able to overturn", () => {
    for (const best of [0, 100, 900]) {
      expect(adjudicationDeadlineMs(best) - best).toBe(limits.buzz.maxCompensationMs);
    }
  });
});
