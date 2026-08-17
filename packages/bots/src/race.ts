// The fairness harness: what a buzz race SHOULD produce, what it did produce, and whether
// compensation is what made the difference (M6, docs/decisions/2026-08-17-buzz-latency-
// compensation.md). This is how the word "fair" stops being a claim in a README and becomes a
// number a test can fail on.
//
// The predictions are computed with the SERVER'S OWN ordering module
// (@jeopardy/protocol/room/buzz-fairness) rather than a second implementation, so a harness
// that agrees with the room proves the room, and a harness that disagrees is a real bug rather
// than two arithmetics drifting apart. What the harness contributes is the ground truth a
// server can never have: it knows each racer's real reaction time and real network, because it
// chose them.
import { orderBuzzesByFairness } from "@jeopardy/protocol/room/buzz-fairness";
import type { BuzzTiming } from "@jeopardy/protocol/room/buzz-fairness";

/** One phone in a race, described by the truth the harness controls. */
export type Racer = {
  nickname: string;
  /** Simulated round trip of its connection. */
  roundTripMs: number;
  /** The truth: milliseconds between seeing the arm and pressing. */
  reactionMs: number;
  /** What it tells the server about that (see BotBehavior.elapsedClaim). */
  elapsedClaim?: "honest" | "zero" | "none";
  /** Whether it answers the arm broadcast, i.e. whether the server can measure it at all. */
  acknowledgesArming?: boolean;
};

export type RacePrediction = {
  /** Who wins on raw server-arrival order - the M3 behavior, and the unfairness M6 fixes. */
  byArrival: string;
  /** Who SHOULD win: the fastest actual thumb. */
  byReaction: string;
  /** Who the compensation arithmetic crowns, given what each racer chose to report. */
  byCompensation: string;
  /** True when arrival order and reaction order disagree - i.e. the race is worth running. */
  networkDecidedIt: boolean;
};

function timingsFor(racers: readonly Racer[]): BuzzTiming[] {
  return racers.map((racer, index) => {
    const claim = racer.elapsedClaim ?? "honest";
    return {
      playerId: racer.nickname,
      // Arrival, in the server's frame: down + thumb + up, which is round trip + reaction.
      observedMs: racer.roundTripMs + racer.reactionMs,
      claimedElapsedMs: claim === "none" ? null : claim === "zero" ? 0 : racer.reactionMs,
      roundTripMs: (racer.acknowledgesArming ?? true) ? racer.roundTripMs : null,
      sequence: index,
    };
  });
}

function fastestBy(racers: readonly Racer[], score: (racer: Racer) => number): string {
  let best = racers[0];
  if (best === undefined) return "";
  for (const racer of racers) {
    if (score(racer) < score(best)) best = racer;
  }
  return best.nickname;
}

export function predictRace(racers: readonly Racer[]): RacePrediction {
  const byArrival = fastestBy(racers, (racer) => racer.roundTripMs + racer.reactionMs);
  const byReaction = fastestBy(racers, (racer) => racer.reactionMs);
  const ordered = orderBuzzesByFairness(timingsFor(racers));
  return {
    byArrival,
    byReaction,
    byCompensation: ordered[0]?.playerId ?? "",
    networkDecidedIt: byArrival !== byReaction,
  };
}

export type RaceOutcome = {
  label: string;
  racers: readonly Racer[];
  /** Who the ROOM actually crowned (the nickname on the buzz-won message). */
  winner: string;
};

export type RaceVerdict = RaceOutcome &
  RacePrediction & {
    /** The room agreed with the compensation arithmetic - the server is behaving. */
    matchedPrediction: boolean;
    /** The fastest thumb won, whoever's Wi-Fi it was on - the property being sold. */
    fastestThumbWon: boolean;
    /** Compensation changed who won, versus the arrival order that would have decided it. */
    changedTheOutcome: boolean;
  };

export function judgeRace(outcome: RaceOutcome): RaceVerdict {
  const prediction = predictRace(outcome.racers);
  return {
    ...outcome,
    ...prediction,
    matchedPrediction: outcome.winner === prediction.byCompensation,
    fastestThumbWon: outcome.winner === prediction.byReaction,
    changedTheOutcome: outcome.winner !== prediction.byArrival,
  };
}

export type RaceReport = {
  verdicts: RaceVerdict[];
  races: number;
  /** Races where the fastest thumb won. */
  fastestThumbWins: number;
  /** Races the network would have decided, had nothing compensated for it. */
  networkDecidedRaces: number;
  /** Races where compensation actually moved the crown. */
  outcomesChanged: number;
  /** Races where the room disagreed with the arithmetic - always a bug, never a tuning issue. */
  mispredictions: number;
};

export function reportRaces(outcomes: readonly RaceOutcome[]): RaceReport {
  const verdicts = outcomes.map(judgeRace);
  return {
    verdicts,
    races: verdicts.length,
    fastestThumbWins: verdicts.filter((verdict) => verdict.fastestThumbWon).length,
    networkDecidedRaces: verdicts.filter((verdict) => verdict.networkDecidedIt).length,
    outcomesChanged: verdicts.filter((verdict) => verdict.changedTheOutcome).length,
    mispredictions: verdicts.filter((verdict) => !verdict.matchedPrediction).length,
  };
}

/** The report as a table a human reads in a terminal or a failing test's output. */
export function formatRaceReport(report: RaceReport): string {
  const lines = [
    "race                      winner        arrival       thumb         verdict",
    "------------------------- ------------- ------------- ------------- -------",
  ];
  for (const verdict of report.verdicts) {
    lines.push(
      [
        verdict.label.padEnd(25).slice(0, 25),
        verdict.winner.padEnd(13).slice(0, 13),
        verdict.byArrival.padEnd(13).slice(0, 13),
        verdict.byReaction.padEnd(13).slice(0, 13),
        verdict.matchedPrediction ? (verdict.fastestThumbWon ? "fair" : "as-claimed") : "MISMATCH",
      ].join(" "),
    );
  }
  lines.push(
    "",
    `${String(report.races)} races - fastest thumb won ${String(report.fastestThumbWins)}, ` +
      `network would have decided ${String(report.networkDecidedRaces)}, ` +
      `compensation changed ${String(report.outcomesChanged)}, ` +
      `server/harness mismatches ${String(report.mispredictions)}`,
  );
  return lines.join("\n");
}
