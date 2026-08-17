// The harness judging itself. These tests pin what the fairness report MEANS, so that when a
// workerd race asserts "the room agreed with the prediction" the prediction is known to be the
// thing worth agreeing with (M6, docs/decisions/2026-08-17-buzz-latency-compensation.md).
import { describe, expect, it } from "vitest";
import { formatRaceReport, judgeRace, predictRace, reportRaces } from "./race.ts";
import type { Racer } from "./race.ts";

// The scenario the milestone exists for: the slower connection pressed FIRST.
const slowButEarlier: Racer = { nickname: "Ada", roundTripMs: 300, reactionMs: 180 };
const fastButLater: Racer = { nickname: "Bo", roundTripMs: 30, reactionMs: 260 };

describe("race prediction", () => {
  it("names the three different answers a race can have", () => {
    const prediction = predictRace([slowButEarlier, fastButLater]);
    expect(prediction.byArrival).toBe("Bo"); // 290ms vs 480ms on the wire
    expect(prediction.byReaction).toBe("Ada"); // 180ms vs 260ms of thumb
    expect(prediction.byCompensation).toBe("Ada");
    expect(prediction.networkDecidedIt).toBe(true);
  });

  it("leaves an evenly-matched race alone: no network gap, no reordering", () => {
    const prediction = predictRace([
      { nickname: "Ada", roundTripMs: 40, reactionMs: 210 },
      { nickname: "Bo", roundTripMs: 40, reactionMs: 260 },
    ]);
    expect(prediction.networkDecidedIt).toBe(false);
    expect(prediction.byCompensation).toBe(prediction.byArrival);
  });

  it("does not hand the race to a phone that lies but refuses to be measured", () => {
    // No ack means no measured round trip, which means no compensation - so the liar is
    // ranked by arrival and the honest slow phone still beats it.
    const prediction = predictRace([
      { ...slowButEarlier },
      {
        nickname: "Cheat",
        roundTripMs: 300,
        reactionMs: 400,
        elapsedClaim: "zero",
        acknowledgesArming: false,
      },
    ]);
    expect(prediction.byCompensation).toBe("Ada");
  });

  it("bounds what a measured liar can steal - and says so out loud", () => {
    // The liar is measured (it acked) and claims a zero reaction. It is credited
    // arrival-minus-round-trip, which IS its true reaction: the lie buys nothing here.
    const honest: Racer = { nickname: "Ada", roundTripMs: 60, reactionMs: 200 };
    const liar: Racer = {
      nickname: "Cheat",
      roundTripMs: 60,
      reactionMs: 260,
      elapsedClaim: "zero",
    };
    expect(predictRace([honest, liar]).byCompensation).toBe("Ada");
  });
});

describe("race report", () => {
  it("separates 'the room was wrong' from 'the room was right and the liar won'", () => {
    const fair = judgeRace({
      label: "slow-but-earlier",
      racers: [slowButEarlier, fastButLater],
      winner: "Ada",
    });
    expect(fair.matchedPrediction).toBe(true);
    expect(fair.fastestThumbWon).toBe(true);
    expect(fair.changedTheOutcome).toBe(true);

    const broken = judgeRace({
      label: "slow-but-earlier",
      racers: [slowButEarlier, fastButLater],
      winner: "Bo",
    });
    expect(broken.matchedPrediction).toBe(false); // the server disagreed with the arithmetic
    expect(broken.fastestThumbWon).toBe(false);
  });

  it("aggregates a run into the numbers the milestone is measured by", () => {
    const report = reportRaces([
      { label: "a", racers: [slowButEarlier, fastButLater], winner: "Ada" },
      { label: "b", racers: [slowButEarlier, fastButLater], winner: "Ada" },
      {
        label: "c",
        racers: [
          { nickname: "Ada", roundTripMs: 40, reactionMs: 200 },
          { nickname: "Bo", roundTripMs: 40, reactionMs: 300 },
        ],
        winner: "Ada",
      },
    ]);
    expect(report.races).toBe(3);
    expect(report.fastestThumbWins).toBe(3);
    expect(report.networkDecidedRaces).toBe(2);
    expect(report.outcomesChanged).toBe(2);
    expect(report.mispredictions).toBe(0);
    const text = formatRaceReport(report);
    expect(text).toContain("3 races");
    expect(text).toContain("compensation changed 2");
  });
});
