// Seeded bot behavior: every decision a bot makes (buzz or not, how fast, what to wager)
// draws from the engine's own PRNG helpers, so a bot swarm with pinned seeds replays the
// same choices in every run - the reproducibility directive extends to the simulation layer.
import { drawRandom } from "@jeopardy/engine/rng";
import { rngStateFromSeed } from "@jeopardy/engine/rng";

export type BotBehavior = {
  // Probability [0,1] the bot buzzes at all on a given arming.
  buzzProbability: number;
  // Uniform latency range between seeing buzzers-armed and pressing, in ms. Models human
  // reaction spread; tests pin min=max for deterministic ordering assertions.
  buzzLatencyMinMs: number;
  buzzLatencyMaxMs: number;
  // Fraction [0,1] of the allowed maximum the bot wagers on wager cells and in the final.
  wagerFraction: number;
  // Typed-answer text (everyone-answers mode and the final round).
  answerText: string;
  // M6 latency compensation, client half (docs/decisions/2026-08-17-buzz-latency-
  // compensation.md). A real phone always does both of these; a bot can refuse either, which
  // is how the race harness plays the adversary against the real server:
  //
  // - acknowledgeArming: answer the arm-window message, which is what lets the server measure
  //   this connection's round trip. Off = the phone that will not be measured (and is
  //   therefore compensated for nothing).
  // - elapsedClaim: what the buzz says about its own reaction time. "honest" is the truth,
  //   "zero" is the liar claiming an instant thumb, "none" sends no claim at all.
  acknowledgeArming: boolean;
  elapsedClaim: "honest" | "zero" | "none";
};

export const defaultBehavior: BotBehavior = {
  buzzProbability: 0.9,
  buzzLatencyMinMs: 120,
  buzzLatencyMaxMs: 900,
  wagerFraction: 0.5,
  answerText: "what is a bot answer",
  acknowledgeArming: true,
  elapsedClaim: "honest",
};

// A mutable seeded stream: same seed, same draw sequence. Kept separate from the engine's
// state-in/state-out style because a bot is a driver (it owns its clock and its rng), not a
// pure transition.
export class SeededStream {
  private state: number;

  constructor(seed: string) {
    this.state = rngStateFromSeed(seed);
  }

  /** Uniform in [0, 1). */
  next(): number {
    const draw = drawRandom(this.state);
    this.state = draw.nextState;
    return draw.value;
  }

  nextInRange(minimum: number, maximum: number): number {
    return minimum + this.next() * (maximum - minimum);
  }
}
