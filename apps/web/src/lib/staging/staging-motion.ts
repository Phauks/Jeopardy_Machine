// Getting there. The staged lobby's whole point is that a team change is a MOVE - you swim
// across and climb aboard, the room watches you do it - so an occupant is never teleported to
// a seat; they walk to it.
//
// Pure, and reusing the WanderAgent shape rather than inventing a second one: diorama-scene.ts
// already knows how to copy an agent's x/z/heading/mode onto an Object3D and crossfade the
// matching clip, and none of that should have to learn about staging. In staged mode the
// scene simply steps agents through here instead of through wander.ts.
import { angleDelta } from "#lib/diorama/wander.ts";
import type { WanderAgent } from "#lib/diorama/wander.ts";
import type { StagedTarget } from "#lib/staging/staging-layout.ts";

/** Units per second walking to a seat. Brisker than a stroll - this is a person with a plan. */
export const stagedWalkSpeed = 1.15;

/** Radians per second the heading eases at while staged. */
const stagedTurnRate = 4.2;

/** Within this distance the occupant is considered seated and takes the seat's own facing. */
const arrivalEpsilon = 0.05;

export type StagedStepOptions = {
  /**
   * prefers-reduced-motion, or any surface that must hold still. Everyone stands ON their
   * target, facing the right way, with no travel and no animation. The positions are still
   * correct - the freeze removes the journey, never the layout (guardrail 2 of
   * docs/decisions/2026-08-14-avatars-in-motion.md).
   */
  frozen: boolean;
  /** Entities celebrating outright (the winner scene) - they hold their spot and dance. */
  celebratingEntityIds: ReadonlySet<string>;
  /**
   * Scene-clock seconds, so a buzz beat (wander.ts's `startBeat`, which the staged lobby also
   * uses) can outrank the walk. Omitted means "no clock, no beats", which is what the pure
   * placement tests want.
   */
  now?: number;
};

/**
 * Advance one agent toward its target. Returns a new agent; never mutates the input.
 *
 * Rules in priority order: a celebration outranks everything; a frozen stage snaps to the
 * target; otherwise walk toward it, FACING THE WAY YOU ARE TRAVELLING - which is what makes a
 * team switch read as a deliberate move across the water rather than a slide - and adopt the
 * seat's own facing only once you arrive.
 */
export function stepStagedAgent(
  agent: WanderAgent,
  target: StagedTarget,
  deltaSeconds: number,
  options: StagedStepOptions,
): WanderAgent {
  if (options.celebratingEntityIds.has(agent.entityId)) {
    return { ...agent, x: target.x, z: target.z, mode: "celebrate", targetHeading: 0, heading: 0 };
  }
  // A beat holds the occupant where they are and turns them to the room. It outranks the walk
  // but not a celebration, the same priority order wander.ts uses for the free-roaming scene.
  if (agent.beatUntil > (options.now ?? 0)) {
    return { ...agent, mode: "celebrate", targetHeading: 0, heading: 0 };
  }
  if (options.frozen) {
    return {
      ...agent,
      x: target.x,
      z: target.z,
      heading: target.heading,
      targetHeading: target.heading,
      mode: "idle",
    };
  }

  const deltaX = target.x - agent.x;
  const deltaZ = target.z - agent.z;
  const distance = Math.hypot(deltaX, deltaZ);

  if (distance <= arrivalEpsilon) {
    return {
      ...agent,
      x: target.x,
      z: target.z,
      targetHeading: target.heading,
      heading: easeHeading(agent.heading, target.heading, deltaSeconds),
      mode: "idle",
    };
  }

  // atan2(x, z), not the usual atan2(z, x): three rotates about Y with 0 facing +Z, the same
  // convention wander.ts steps in, so a heading feeds straight into rotation.y.
  const travelHeading = Math.atan2(deltaX, deltaZ);
  const step = Math.min(distance, stagedWalkSpeed * deltaSeconds);
  const heading = easeHeading(agent.heading, travelHeading, deltaSeconds);
  return {
    ...agent,
    // Move along the TARGET direction rather than the (still turning) facing: an avatar that
    // walks where it is looking arcs away from its seat and takes a visible detour to get back.
    x: agent.x + (deltaX / distance) * step,
    z: agent.z + (deltaZ / distance) * step,
    heading,
    targetHeading: travelHeading,
    mode: "walk",
  };
}

function easeHeading(from: number, to: number, deltaSeconds: number): number {
  const delta = angleDelta(from, to);
  const maxTurn = stagedTurnRate * deltaSeconds;
  if (Math.abs(delta) <= maxTurn) return to;
  return from + Math.sign(delta) * maxTurn;
}

/**
 * Units per second a STATION slides when the stage re-packs. Slower than a person walks, so a
 * boat reads as a heavy thing being repositioned rather than as a chip sliding on a table.
 */
export const stationSlideSpeed = 0.9;

/**
 * Ease a station toward the anchor the layout gave it, and the counterpart to the reversal
 * recorded in staging-layout.ts (2026-08-16). Guaranteeing clearance at every team count means
 * the grid changes when a team is created, so stations DO move - and the difference between
 * that reading as "the harbour makes room" and as a glitch is entirely whether they slide or
 * jump. Pure, so the easing is unit-tested and diorama-scene.ts only copies the number.
 *
 * `frozen` snaps, for the same reason the walk does: prefers-reduced-motion removes journeys,
 * never layouts.
 */
export function easeStationPosition(
  current: { x: number; z: number },
  target: { x: number; z: number },
  deltaSeconds: number,
  frozen = false,
): { x: number; z: number } {
  if (frozen) return { x: target.x, z: target.z };
  const deltaX = target.x - current.x;
  const deltaZ = target.z - current.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const step = stationSlideSpeed * deltaSeconds;
  if (distance <= step || distance === 0) return { x: target.x, z: target.z };
  return { x: current.x + (deltaX / distance) * step, z: current.z + (deltaZ / distance) * step };
}

/** Deterministic per-entity phase offset, so a crowd never bobs in unison. */
function phaseFor(entityId: string): number {
  let hash = 0;
  for (let index = 0; index < entityId.length; index += 1) {
    hash = (hash * 31 + entityId.charCodeAt(index)) >>> 0;
  }
  return ((hash % 1000) / 1000) * Math.PI * 2;
}

/**
 * Vertical offset for someone waiting in a "bob" holding area - treading water. Applied by the
 * scene to the root's Y, which is why it is a number rather than part of the agent: nothing
 * else in the diorama has ever needed a Y, and giving every agent one for this would be a
 * worse trade than a function call per frame.
 *
 * Zero when frozen: bobbing is ambient motion, and ambient motion is exactly what
 * prefers-reduced-motion turns off.
 */
export function holdingBobOffset(
  entityId: string,
  elapsedSeconds: number,
  frozen: boolean,
  amplitude = 0.035,
): number {
  if (frozen) return 0;
  return Math.sin(elapsedSeconds * 1.7 + phaseFor(entityId)) * amplitude;
}
