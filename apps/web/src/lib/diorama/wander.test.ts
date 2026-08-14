// The diorama's movement rules, tested where they are pure. Everything asserted here is a
// promise the decision doc makes about the scene (docs/decisions/2026-08-14-avatars-in-motion.md):
// avatars stay on the stage, reduced motion stops them dead, a beat is visible and temporary,
// and the same seed lays a room out the same way twice.
import { describe, expect, it } from "vitest";
import {
  angleDelta,
  clampToBounds,
  defaultWanderBounds,
  maxDioramaAvatars,
  seededRandom,
  slotPosition,
  spawnAgents,
  startBeat,
  stepAgent,
} from "#lib/diorama/wander.ts";
import type { StepOptions, WanderAgent, WanderBounds } from "#lib/diorama/wander.ts";

const noCelebration: StepOptions = { frozen: false, celebratingEntityIds: new Set() };
const bounds: WanderBounds = defaultWanderBounds;

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `player-${String(index)}`);
}

/** Run a whole crowd for `seconds` at 60fps and hand back where everyone ended up. */
function simulate(agents: WanderAgent[], seconds: number, options = noCelebration): WanderAgent[] {
  const delta = 1 / 60;
  let current = agents;
  for (let step = 0; step * delta < seconds; step++) {
    const now = step * delta;
    const random = seededRandom(step + 1);
    current = current.map((agent) => stepAgent(agent, delta, now, bounds, random, options));
  }
  return current;
}

describe("angleDelta", () => {
  it("returns the SHORT way round, so a turn never takes the long path", () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    // From just below +pi to just above -pi is a small step, not a near-full circle.
    expect(angleDelta(3, -3)).toBeCloseTo(Math.PI * 2 - 6);
    expect(Math.abs(angleDelta(3, -3))).toBeLessThan(Math.PI);
  });
});

describe("spawnAgents", () => {
  it("places everyone inside the bounds", () => {
    const agents = spawnAgents(ids(12), bounds, seededRandom(7));
    for (const agent of agents) {
      expect(Math.abs(agent.x)).toBeLessThanOrEqual(bounds.halfWidth);
      expect(Math.abs(agent.z)).toBeLessThanOrEqual(bounds.halfDepth);
    }
  });

  it("caps the crowd, because a 100-player room must not become 100 skinned meshes", () => {
    expect(spawnAgents(ids(100), bounds, seededRandom(7))).toHaveLength(maxDioramaAvatars);
  });

  it("lays the same room out identically for the same seed (a reopened display looks the same)", () => {
    const first = spawnAgents(ids(8), bounds, seededRandom(42));
    const second = spawnAgents(ids(8), bounds, seededRandom(42));
    expect(second).toEqual(first);
  });

  it("spreads avatars out rather than stacking them on the origin", () => {
    const agents = spawnAgents(ids(9), bounds, seededRandom(3));
    const positions = new Set(agents.map((agent) => `${agent.x.toFixed(2)},${agent.z.toFixed(2)}`));
    expect(positions.size).toBe(agents.length);
  });

  it("keeps every pair of arrivals at least an avatar's width apart", () => {
    // The bug this pins: a per-arrival spawn that always computed slot 0 stacked the entire
    // room on one spot. Avatars are normalised to 1 unit tall and read about as wide, so
    // anything under ~0.6 units apart is visible overlap on the big screen.
    const agents = spawnAgents(ids(maxDioramaAvatars), bounds, seededRandom(3));
    for (const [index, agent] of agents.entries()) {
      for (const other of agents.slice(index + 1)) {
        const distance = Math.hypot(agent.x - other.x, agent.z - other.z);
        expect(distance, `${agent.entityId} vs ${other.entityId}`).toBeGreaterThan(0.35);
      }
    }
  });

  it("fills the FRONT of the stage first, where a small room is most readable", () => {
    const [first, seventh] = [
      slotPosition(0, bounds),
      slotPosition(6, bounds), // one full row back
    ];
    expect(first.z).toBeGreaterThan(seventh.z);
  });

  it("wraps slot indices rather than walking off the grid forever", () => {
    expect(slotPosition(maxDioramaAvatars, bounds)).toEqual(slotPosition(0, bounds));
  });
});

describe("stepAgent bounds", () => {
  it("keeps a whole crowd on the stage across a long stroll", () => {
    const agents = simulate(spawnAgents(ids(16), bounds, seededRandom(11)), 120);
    for (const agent of agents) {
      expect(Math.abs(agent.x), agent.entityId).toBeLessThanOrEqual(bounds.halfWidth);
      expect(Math.abs(agent.z), agent.entityId).toBeLessThanOrEqual(bounds.halfDepth);
    }
  });

  it("turns an agent walking straight at a wall back toward the middle", () => {
    // Facing +X, hard against the right wall.
    const pinned: WanderAgent = {
      entityId: "wall-walker",
      x: bounds.halfWidth,
      z: 0,
      heading: Math.PI / 2,
      targetHeading: Math.PI / 2,
      mode: "walk",
      modeUntil: 999,
      speed: 0.8,
      beatUntil: 0,
    };
    const next = stepAgent(pinned, 1 / 60, 1, bounds, seededRandom(5), noCelebration);
    expect(next.x).toBeLessThanOrEqual(bounds.halfWidth);
    // A new heading was chosen that points back into the pen (negative X = sin < 0).
    expect(Math.sin(next.targetHeading)).toBeLessThan(0);
  });

  it("cannot be pushed out by an absurd frame delta (a tabbed-away display coming back)", () => {
    const agents = spawnAgents(ids(6), bounds, seededRandom(2));
    for (const spawned of agents) {
      const agent: WanderAgent = { ...spawned, mode: "walk", modeUntil: 1000 };
      const next = stepAgent(agent, 30, 1, bounds, seededRandom(9), noCelebration);
      expect(Math.abs(next.x)).toBeLessThanOrEqual(bounds.halfWidth);
      expect(Math.abs(next.z)).toBeLessThanOrEqual(bounds.halfDepth);
    }
  });

  it("clampToBounds is the only way a position is produced, and it is idempotent", () => {
    const outside = { ...spawnAgents(["x"], bounds, seededRandom(1))[0] } as WanderAgent;
    outside.x = 99;
    outside.z = -99;
    const once = clampToBounds(outside, bounds);
    expect(clampToBounds(once, bounds)).toEqual(once);
    expect(once.x).toBe(bounds.halfWidth);
    expect(once.z).toBe(-bounds.halfDepth);
  });
});

describe("stepAgent under reduced motion", () => {
  it("stops the crowd exactly where it stands and puts everyone on idle", () => {
    const start: WanderAgent[] = spawnAgents(ids(10), bounds, seededRandom(4)).map((agent) =>
      Object.assign(agent, { mode: "walk" as const }),
    );
    const frozen: StepOptions = { frozen: true, celebratingEntityIds: new Set() };
    const after = simulate(start, 30, frozen);
    after.forEach((agent, index) => {
      const before = start[index];
      expect(before).toBeDefined();
      expect(agent.x).toBe(before?.x);
      expect(agent.z).toBe(before?.z);
      expect(agent.mode).toBe("idle");
    });
  });
});

describe("reactions", () => {
  it("a beat turns the avatar to the camera and celebrates, then expires", () => {
    const [agent] = spawnAgents(["buzzer"], bounds, seededRandom(6));
    expect(agent).toBeDefined();
    if (agent === undefined) return;
    const beating = startBeat(agent, 10, 2);
    expect(beating.mode).toBe("celebrate");

    // Mid-beat: heading eases toward 0 (facing the camera), never away from it.
    let current = beating;
    for (let step = 0; step < 30; step++) {
      current = stepAgent(current, 1 / 60, 10.5, bounds, seededRandom(1), noCelebration);
    }
    expect(current.mode).toBe("celebrate");
    expect(Math.abs(angleDelta(current.heading, 0))).toBeLessThan(
      Math.abs(angleDelta(beating.heading, 0)) + 1e-9,
    );

    // After it expires the agent rejoins the stroll rather than dancing forever.
    const afterBeat = stepAgent(current, 1 / 60, 13, bounds, seededRandom(1), noCelebration);
    expect(afterBeat.mode).not.toBe("celebrate");
  });

  it("a celebrating entity outranks everything, including reduced motion's idle", () => {
    const [agent] = spawnAgents(["winner"], bounds, seededRandom(8));
    expect(agent).toBeDefined();
    if (agent === undefined) return;
    const options: StepOptions = { frozen: true, celebratingEntityIds: new Set(["winner"]) };
    const next = stepAgent(agent, 1 / 60, 1, bounds, seededRandom(1), options);
    expect(next.mode).toBe("celebrate");
    // ...but it still does not travel: a celebration is danced on the spot.
    expect(next.x).toBe(agent.x);
    expect(next.z).toBe(agent.z);
  });

  it("leaves non-celebrating entities alone while others celebrate", () => {
    const agents = spawnAgents(["winner", "bystander"], bounds, seededRandom(8));
    const options: StepOptions = { frozen: false, celebratingEntityIds: new Set(["winner"]) };
    const stepped = agents.map((agent) =>
      stepAgent(agent, 1 / 60, 1, bounds, seededRandom(1), options),
    );
    expect(stepped[0]?.mode).toBe("celebrate");
    expect(stepped[1]?.mode).not.toBe("celebrate");
  });
});

describe("stepAgent purity", () => {
  it("never mutates the agent it was given", () => {
    const [agent] = spawnAgents(["pure"], bounds, seededRandom(12));
    expect(agent).toBeDefined();
    if (agent === undefined) return;
    const snapshot = structuredClone(agent);
    stepAgent(agent, 1 / 60, 99, bounds, seededRandom(1), noCelebration);
    expect(agent).toEqual(snapshot);
  });
});
