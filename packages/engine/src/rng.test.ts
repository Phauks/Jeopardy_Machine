import { describe, expect, it } from "vitest";
import { drawInteger, drawRandom, drawWeightedIndex, rngStateFromSeed } from "./rng.ts";

describe("seeded rng", () => {
  it("same seed yields the same state, different seeds diverge", () => {
    expect(rngStateFromSeed("club-night")).toBe(rngStateFromSeed("club-night"));
    expect(rngStateFromSeed("club-night")).not.toBe(rngStateFromSeed("club-nite"));
  });

  it("draws are deterministic per state and advance the state", () => {
    const state = rngStateFromSeed("determinism");
    const first = drawRandom(state);
    const again = drawRandom(state);
    expect(first).toEqual(again);
    expect(first.nextState).not.toBe(state);
    const second = drawRandom(first.nextState);
    expect(second.value).not.toBe(first.value);
  });

  it("values stay in [0, 1) and integers in range", () => {
    let state = rngStateFromSeed("range");
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const draw = drawRandom(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      const integer = drawInteger(state, 7);
      expect(integer.value).toBeGreaterThanOrEqual(0);
      expect(integer.value).toBeLessThan(7);
      state = draw.nextState;
    }
  });

  it("weighted draw never picks zero-weight entries and roughly follows the weights", () => {
    let state = rngStateFromSeed("weights");
    const counts = [0, 0, 0, 0, 0];
    const weights = [0, 9, 26, 39, 26];
    for (let iteration = 0; iteration < 4000; iteration += 1) {
      const draw = drawWeightedIndex(state, weights);
      state = draw.nextState;
      counts[draw.value] = (counts[draw.value] ?? 0) + 1;
    }
    expect(counts[0]).toBe(0);
    // Row 4 (index 3) carries the largest weight; loose bound, not a statistics exam.
    expect(counts[3]).toBeGreaterThan(counts[1] ?? 0);
    expect(counts[3]).toBeGreaterThan(counts[2] ?? 0);
    expect(counts[3]).toBeGreaterThan(counts[4] ?? 0);
  });
});
