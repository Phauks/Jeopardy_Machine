// The diorama's movement brain, deliberately with no three.js in it.
//
// Everything about where an avatar is and what it is doing is decided here, in plain numbers
// on a flat XZ plane; diorama-scene.ts only copies the result onto an Object3D and crossfades
// the matching animation clip. Splitting it this way is what lets the wander rules be unit
// tested (bounds are never left, reduced motion never moves anything, the same seed produces
// the same stroll) without a canvas, a GPU, or a browser.
//
// Units are the scene's world units - one Kenney avatar is roughly 1 unit tall.

/** The rectangle avatars stay inside, centred on the origin. */
export type WanderBounds = {
  halfWidth: number;
  halfDepth: number;
};

export type WanderMode = "idle" | "walk" | "celebrate";

export type WanderAgent = {
  /** The room entity this agent stands for - a player id, or a team id in teams mode. */
  entityId: string;
  x: number;
  z: number;
  /** Facing, in radians, measured the way three.js rotates about Y (0 faces +Z, the camera). */
  heading: number;
  /** Heading the agent is easing toward; a turn is gradual, never a snap. */
  targetHeading: number;
  mode: WanderMode;
  /** Scene-clock time (seconds) at which the current mode is up for reconsideration. */
  modeUntil: number;
  /** Units per second while walking - varied per agent so a crowd does not march in lockstep. */
  speed: number;
  /** Non-zero while reacting (a buzz beat): scene-clock seconds the beat ends at. */
  beatUntil: number;
};

/** A 0..1 source. Injected everywhere so tests can drive the wander with a fixed sequence. */
export type RandomSource = () => number;

/**
 * Half the world height the scene camera sees at the NEAR edge of the pen. A constant here
 * rather than a camera query so the pen sizing stays pure and testable; diorama-scene.ts owns
 * the camera it was derived from (34 degrees vertical, 5.9 units from the pen's front edge)
 * and its comment points back here.
 */
const nearVisibleHalfHeight = 1.8;

/**
 * The pen's depth is fixed; only its width follows the canvas. Deep enough that a full room
 * spreads over four rows of stage instead of lining up along one - the crowd should look like
 * people milling about, not a police lineup.
 */
const wanderHalfDepth = 2.8;

/**
 * The pen, in world units - where diorama-scene.ts normalises every avatar, from either pack,
 * to 0.8 units tall.
 *
 * Width follows the CANVAS ASPECT, because the diorama's canvas is whatever shape the surface
 * gives it: a 16:9 projector, a wide letterbox band under a title card, a dev preview. A
 * fixed-width pen would either let avatars stroll out of shot on a narrow canvas, or strand
 * the whole room in the middle third of a wide one with empty floor either side.
 */
export function boundsForAspect(aspect: number): WanderBounds {
  // 0.92 keeps a margin, so an avatar at the front corner is fully in frame rather than
  // clipped by the edge. The clamp stops a freak canvas from producing a pen nobody can see
  // across, or one so narrow the crowd overlaps.
  const halfWidth = nearVisibleHalfHeight * Math.max(0.5, aspect) * 0.92;
  return { halfWidth: Math.min(6, Math.max(2.4, halfWidth)), halfDepth: wanderHalfDepth };
}

/** The 16:9 pen - the shape most surfaces get, and what the tests measure against. */
export const defaultWanderBounds: WanderBounds = boundsForAspect(16 / 9);

/**
 * How many avatars the diorama will ever animate at once. A room may hold 100 players
 * (packages/protocol limits); a hundred skinned meshes on the laptop that is also driving a
 * projector is not a trade worth making for decoration, and past a couple of dozen the
 * diorama reads as a crowd either way. Overflow players simply are not shown - the roster and
 * score strip remain the complete, authoritative list of who is in the room.
 */
export const maxDioramaAvatars = 24;

const minIdleSeconds = 1.6;
const maxIdleSeconds = 4.5;
const minWalkSeconds = 2.2;
const maxWalkSeconds = 5;
const minSpeed = 0.45;
const maxSpeed = 0.85;
/** Radians per second the heading eases at - about a half turn per second. */
const turnRate = 2.6;

function between(random: RandomSource, low: number, high: number): number {
  return low + random() * (high - low);
}

/**
 * The FIXED grid the crowd spawns onto: `maxDioramaAvatars` slots laid across the pen, six to
 * a row, front rows first so a small room fills the readable front of the stage.
 *
 * Fixed rather than sized to the current player count on purpose. Players arrive one at a
 * time, and a grid that resized on each join would either move everyone already standing
 * (avatars teleporting as a friend joins) or - the bug this replaced - hand every arrival the
 * only slot of a one-person grid, stacking the whole room on one spot.
 */
const spawnColumns = 6;

export function slotPosition(slotIndex: number, bounds: WanderBounds): { x: number; z: number } {
  const rows = Math.ceil(maxDioramaAvatars / spawnColumns);
  const slot = ((slotIndex % maxDioramaAvatars) + maxDioramaAvatars) % maxDioramaAvatars;
  const column = slot % spawnColumns;
  const row = Math.floor(slot / spawnColumns);
  const spanX = (bounds.halfWidth * 2) / spawnColumns;
  const spanZ = (bounds.halfDepth * 2) / rows;
  return {
    x: -bounds.halfWidth + spanX * (column + 0.5),
    // Row 0 is the FRONT of the stage (largest z): with three players on screen you want them
    // near the camera, not lined up against the back wall.
    z: bounds.halfDepth - spanZ * (row + 0.5),
  };
}

/**
 * One agent, on its slot, jittered so a filling room never looks mechanically spaced.
 * `slotIndex` is the arrival's position in the crowd, so joins are incremental and nobody
 * already on stage is disturbed.
 */
export function spawnAgent(
  entityId: string,
  slotIndex: number,
  bounds: WanderBounds,
  random: RandomSource,
): WanderAgent {
  const slot = slotPosition(slotIndex, bounds);
  const heading = between(random, -Math.PI, Math.PI);
  return clampToBounds(
    {
      entityId,
      x: slot.x + between(random, -0.25, 0.25),
      z: slot.z + between(random, -0.15, 0.15),
      heading,
      targetHeading: heading,
      mode: "idle",
      // Stagger the first decision so the crowd does not all set off on the same frame.
      modeUntil: between(random, 0, maxIdleSeconds),
      speed: between(random, minSpeed, maxSpeed),
      beatUntil: 0,
    },
    bounds,
  );
}

/** A whole crowd at once - the shape the tests and any future batch spawn want. */
export function spawnAgents(
  entityIds: readonly string[],
  bounds: WanderBounds,
  random: RandomSource,
): WanderAgent[] {
  return entityIds
    .slice(0, maxDioramaAvatars)
    .map((entityId, index) => spawnAgent(entityId, index, bounds, random));
}

/** Pull an agent back inside the pen. Positions are only ever produced through this. */
export function clampToBounds(agent: WanderAgent, bounds: WanderBounds): WanderAgent {
  return {
    ...agent,
    x: Math.min(bounds.halfWidth, Math.max(-bounds.halfWidth, agent.x)),
    z: Math.min(bounds.halfDepth, Math.max(-bounds.halfDepth, agent.z)),
  };
}

/** Shortest signed angle from `from` to `to`, in (-pi, pi]. */
export function angleDelta(from: number, to: number): number {
  const raw = (to - from) % (Math.PI * 2);
  if (raw > Math.PI) return raw - Math.PI * 2;
  if (raw <= -Math.PI) return raw + Math.PI * 2;
  return raw;
}

export type StepOptions = {
  /**
   * Reduced motion, or any phase where the diorama must hold still: agents keep their mode
   * and their place, and the scene plays the idle clip. Decoration never overrides the OS
   * accessibility setting (guardrail 2 of the decision doc).
   */
  frozen: boolean;
  /** Entities celebrating outright - the winner screen. They stay put and dance. */
  celebratingEntityIds: ReadonlySet<string>;
};

/**
 * Advance one agent by `deltaSeconds`. Pure: returns the next state and never mutates the
 * input, so a test can step a fixed agent through a fixed random sequence and compare.
 *
 * The rules, in priority order: a celebration outranks everything; a buzz beat outranks
 * wandering; otherwise the agent alternates idle and walk on a self-scheduled timer, turning
 * away from a wall before it reaches one rather than sliding along it.
 */
export function stepAgent(
  agent: WanderAgent,
  deltaSeconds: number,
  now: number,
  bounds: WanderBounds,
  random: RandomSource,
  options: StepOptions,
): WanderAgent {
  if (options.celebratingEntityIds.has(agent.entityId)) {
    return {
      ...agent,
      mode: "celebrate",
      targetHeading: 0,
      heading: easeHeading(agent, 0, deltaSeconds),
    };
  }
  if (agent.beatUntil > now) {
    // A beat is a turn-to-camera plus the celebrate clip: the avatar acknowledges the room.
    return {
      ...agent,
      mode: "celebrate",
      targetHeading: 0,
      heading: easeHeading(agent, 0, deltaSeconds),
    };
  }
  if (options.frozen) {
    return agent.mode === "idle" ? agent : { ...agent, mode: "idle" };
  }

  let next: WanderAgent = { ...agent };
  if (next.mode === "celebrate") {
    // Coming out of a beat: stand still briefly before deciding again.
    next.mode = "idle";
    next.modeUntil = now + between(random, minIdleSeconds, maxIdleSeconds);
  }
  if (now >= next.modeUntil) {
    if (next.mode === "walk") {
      next.mode = "idle";
      next.modeUntil = now + between(random, minIdleSeconds, maxIdleSeconds);
    } else {
      next.mode = "walk";
      next.modeUntil = now + between(random, minWalkSeconds, maxWalkSeconds);
      next.targetHeading = between(random, -Math.PI, Math.PI);
      next.speed = between(random, minSpeed, maxSpeed);
    }
  }

  next.heading = easeHeading(next, next.targetHeading, deltaSeconds);
  if (next.mode !== "walk") return next;

  const stepX = Math.sin(next.heading) * next.speed * deltaSeconds;
  const stepZ = Math.cos(next.heading) * next.speed * deltaSeconds;
  const wouldX = next.x + stepX;
  const wouldZ = next.z + stepZ;
  // Turn BEFORE the wall, not at it: aiming back at the middle keeps the crowd distributed
  // instead of collecting along the edges the way a reflect-off-the-wall rule does.
  if (Math.abs(wouldX) > bounds.halfWidth || Math.abs(wouldZ) > bounds.halfDepth) {
    next.targetHeading = Math.atan2(-next.x, -next.z) + between(random, -0.6, 0.6);
    return clampToBounds(next, bounds);
  }
  next.x = wouldX;
  next.z = wouldZ;
  return clampToBounds(next, bounds);
}

function easeHeading(agent: WanderAgent, target: number, deltaSeconds: number): number {
  const delta = angleDelta(agent.heading, target);
  const maxTurn = turnRate * deltaSeconds;
  if (Math.abs(delta) <= maxTurn) return target;
  return agent.heading + Math.sign(delta) * maxTurn;
}

/** Mark an agent as reacting for `durationSeconds` - the buzz beat. */
export function startBeat(agent: WanderAgent, now: number, durationSeconds: number): WanderAgent {
  return { ...agent, beatUntil: now + durationSeconds, mode: "celebrate" };
}

/**
 * A tiny deterministic PRNG (mulberry32) so a diorama can be replayed exactly - the dev
 * preview page and the tests both want "the same room, arranged the same way".
 */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
