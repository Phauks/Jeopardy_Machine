// Seeded, splittable-free PRNG for everything the engine randomizes: wager-cell placement,
// first-selector draws, and tiebreak coin flips. The generator STATE lives in GameState and
// every draw returns the next state alongside the value, so a transition consuming randomness
// stays a pure function and the same seed + action log always replays to the identical game
// (docs/research/00-user-directives.md "Development simulation": seeded reproducibility is a
// directive, not a nicety). Never used for anything security-relevant.

// xmur3: cheap avalanche hash from an arbitrary seed string to a 32-bit generator state, so
// human-friendly seeds ("club-night-rehearsal-1") work as well as numbers.
export function rngStateFromSeed(seed: string): number {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^= hash >>> 16) >>> 0;
}

export type RandomDraw = {
  /** Uniform in [0, 1). */
  value: number;
  /** The generator state AFTER this draw - store it back into GameState. */
  nextState: number;
};

// mulberry32: tiny, fast, passes gjrand; one 32-bit word of state is all the engine carries.
export function drawRandom(rngState: number): RandomDraw {
  let mixed = (rngState + 0x6d2b79f5) >>> 0;
  const nextState = mixed;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return { value: ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296, nextState };
}

export type IntegerDraw = {
  value: number;
  nextState: number;
};

/** Uniform integer in [0, maxExclusive). maxExclusive must be a positive integer. */
export function drawInteger(rngState: number, maxExclusive: number): IntegerDraw {
  const { value, nextState } = drawRandom(rngState);
  return { value: Math.floor(value * maxExclusive), nextState };
}

/**
 * Weighted index draw: weights need not sum to anything in particular; zero-weight entries
 * are never chosen. At least one weight must be positive.
 */
export function drawWeightedIndex(rngState: number, weights: readonly number[]): IntegerDraw {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const { value, nextState } = drawRandom(rngState);
  let remaining = value * total;
  for (let index = 0; index < weights.length; index += 1) {
    remaining -= weights[index] ?? 0;
    if (remaining < 0) return { value: index, nextState };
  }
  // Floating-point edge: fall back to the last positively-weighted index.
  for (let index = weights.length - 1; index >= 0; index -= 1) {
    if ((weights[index] ?? 0) > 0) return { value: index, nextState };
  }
  return { value: 0, nextState };
}
