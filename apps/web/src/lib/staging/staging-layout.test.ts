// The staged lobby's placement rules, where they are pure. Everything asserted here is a
// thing that has to be true on a projector and is invisible in a diff: stations that do not
// overlap, waiting people who are never standing inside a boat, a layout that does not shuffle
// when one person picks a team, and a team switch that produces an actual journey.
import { describe, expect, it } from "vitest";
import { boundsForAspect, maxDioramaAvatars, seededRandom } from "#lib/diorama/wander.ts";
import {
  holdingPosition,
  occupantSpacing,
  partitionForStaging,
  placeStaging,
  stagingBands,
  stationAnchors,
  stationGrid,
} from "#lib/staging/staging-layout.ts";
import {
  easeStationPosition,
  holdingBobOffset,
  stationSlideSpeed,
  stepStagedAgent,
} from "#lib/staging/staging-motion.ts";
import { seatForMember } from "#lib/staging/staging-theme.ts";
import { stagingThemes } from "#lib/staging/staging-theme-registry.ts";
import { boatsStagingTheme } from "#lib/staging/staging-themes/boats.ts";
import { campfiresStagingTheme } from "#lib/staging/staging-themes/campfires.ts";
import type { StagedTarget, StagingStation } from "#lib/staging/staging-layout.ts";
import type { StagingTheme } from "#lib/staging/staging-theme.ts";
import type { WanderAgent } from "#lib/diorama/wander.ts";

const bounds = boundsForAspect(16 / 9);

function stationsOf(count: number, membersEach = 0): StagingStation[] {
  return Array.from({ length: count }, (_station, index) => ({
    stationId: `team-${String(index)}`,
    label: `Team ${String(index)}`,
    colorHex: "#ff8800",
    memberIds: Array.from(
      { length: membersEach },
      (_member, seat) => `p-${String(index)}-${String(seat)}`,
    ),
  }));
}

describe("the stage splits into a holding band and a station band", () => {
  it("puts the holding area nearest the camera and the stations behind it", () => {
    const bands = stagingBands(bounds);
    expect(bands.holding.nearZ).toBe(bounds.halfDepth);
    expect(bands.holding.farZ).toBeLessThan(bands.holding.nearZ);
    expect(bands.stations.nearZ).toBe(bands.holding.farZ);
    expect(bands.stations.farZ).toBe(-bounds.halfDepth);
  });

  it("never lets a waiting occupant stand in the station band", () => {
    const divide = stagingBands(bounds).stations.nearZ;
    for (let slot = 0; slot < 30; slot += 1) {
      const spot = holdingPosition(slot, bounds, seededRandom(slot + 1));
      expect(spot.z, `slot ${String(slot)}`).toBeGreaterThan(divide);
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(bounds.halfWidth);
    }
  });
});

/**
 * Every team count a room can plausibly reach, plus the ones past it. The bug the owner
 * reported ("boats overlap each other") was invisible at two and three teams and catastrophic
 * at twelve, which is exactly why the assertion below runs over a range instead of a case.
 */
const teamCounts = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20];
/** Two canvas shapes: a 16:9 projector and a wide letterbox band under a title card. */
const penShapes = [
  ["16:9 projector", boundsForAspect(16 / 9)],
  ["wide band", boundsForAspect(3.2)],
] as const;

/** Do two stations' footprints overlap? Separating-axis, which is what "no overlap" means. */
function footprintsOverlap(
  left: { x: number; z: number; scale: number },
  right: { x: number; z: number; scale: number },
  theme: StagingTheme,
): boolean {
  const epsilon = 1e-9;
  const width = ((theme.stationFootprint.width * (left.scale + right.scale)) / 2) * (1 - epsilon);
  const depth = ((theme.stationFootprint.depth * (left.scale + right.scale)) / 2) * (1 - epsilon);
  return Math.abs(left.x - right.x) < width && Math.abs(left.z - right.z) < depth;
}

describe.each(stagingThemes.map((theme) => [theme.id, theme] as const))(
  "%s: station packing",
  (_id, theme) => {
    // THE OVERLAP GATE (owner report, 2026-08-16). Not "the positions differ" - two boats a
    // centimetre apart have different positions and are the same catamaran. The assertion is
    // that no two station FOOTPRINTS intersect, at every count and on every canvas shape,
    // which is the property a projector actually shows.
    describe.each(penShapes)("%s", (_shape, pen) => {
      it.each(teamCounts)("keeps %i stations clear of each other", (count) => {
        const anchors = stationAnchors(stationsOf(count), theme, pen);
        expect(anchors).toHaveLength(count);
        for (let left = 0; left < anchors.length; left += 1) {
          for (let right = left + 1; right < anchors.length; right += 1) {
            const first = anchors[left];
            const second = anchors[right];
            if (first === undefined || second === undefined) continue;
            expect(
              footprintsOverlap(first, second, theme),
              `${first.stationId} overlaps ${second.stationId} at ${String(count)} teams`,
            ).toBe(false);
          }
        }
      });

      it.each(teamCounts)("keeps all %i stations inside the pen and the station band", (count) => {
        const band = stagingBands(pen).stations;
        for (const anchor of stationAnchors(stationsOf(count), theme, pen)) {
          const halfWidth = (theme.stationFootprint.width * anchor.scale) / 2;
          const halfDepth = (theme.stationFootprint.depth * anchor.scale) / 2;
          expect(Math.abs(anchor.x) + halfWidth).toBeLessThanOrEqual(pen.halfWidth + 1e-9);
          // Never into the water in front, never through the back wall behind.
          expect(anchor.z + halfDepth).toBeLessThanOrEqual(band.nearZ + 1e-9);
          expect(anchor.z - halfDepth).toBeGreaterThanOrEqual(band.farZ - 1e-9);
        }
      });
    });

    it("shrinks the stations only as far as it has to, and never past the theme's size", () => {
      // Few teams get the theme's authored size; many teams get a uniform, monotonic squeeze.
      expect(stationGrid(2, theme, bounds).scale).toBe(1);
      let previous = 1;
      for (const count of teamCounts) {
        const { scale } = stationGrid(count, theme, bounds);
        expect(scale, `${String(count)} teams`).toBeGreaterThan(0);
        expect(scale, `${String(count)} teams`).toBeLessThanOrEqual(1);
        expect(scale, `${String(count)} teams`).toBeLessThanOrEqual(previous + 1e-9);
        previous = scale;
      }
    });

    it("wraps to a second row rather than shrinking the first into a strip", () => {
      const many = stationAnchors(stationsOf(9), theme, bounds);
      const rows = new Set(many.map((anchor) => anchor.z));
      expect(rows.size).toBeGreaterThan(1);
    });

    it("seats every member somewhere, wrapping past the seat count without stacking", () => {
      const seats = Array.from({ length: theme.seatOffsets.length * 2 + 1 }, (_, index) =>
        seatForMember(theme, index),
      );
      const distinct = new Set(seats.map((seat) => `${String(seat.x)}:${String(seat.z)}`));
      expect(distinct.size).toBe(seats.length);
    });

    it("keeps even a badly overcrowded crew on its own station", () => {
      // Twenty people on one station is not a designed case, it is a Friday. What must never
      // happen is a member drifting onto the NEIGHBOURING station, which the seat-wrap nudge
      // used to do without a bound.
      for (let index = 0; index < 20; index += 1) {
        const seat = seatForMember(theme, index);
        expect(Math.abs(seat.x), `seat ${String(index)}`).toBeLessThanOrEqual(
          theme.stationFootprint.width / 2,
        );
        expect(Math.abs(seat.z), `seat ${String(index)}`).toBeLessThanOrEqual(
          theme.stationFootprint.depth / 2,
        );
      }
    });
  },
);

describe("the crowd in the holding area", () => {
  it("has a slot for every avatar the diorama will draw, so nobody stands inside anybody", () => {
    // The grid used to be a hard 3 rows of 6 - eighteen slots for a crowd of up to
    // `maxDioramaAvatars`, so the nineteenth waiting player was placed EXACTLY on the first.
    const spots = Array.from({ length: maxDioramaAvatars }, (_slot, index) =>
      holdingPosition(index, bounds),
    );
    for (let left = 0; left < spots.length; left += 1) {
      for (let right = left + 1; right < spots.length; right += 1) {
        const first = spots[left];
        const second = spots[right];
        if (first === undefined || second === undefined) continue;
        expect(
          Math.hypot(first.x - second.x, first.z - second.z),
          `slots ${String(left)} and ${String(right)}`,
        ).toBeGreaterThanOrEqual(occupantSpacing - 1e-9);
      }
    }
  });

  it("keeps that personal space under the worst jitter the scatter can produce", () => {
    // The jitter exists so a filling room never looks mechanically spaced, and it is bounded
    // by whatever is left over once everybody has their space - so the guarantee survives it.
    // Driven with the extremes rather than a seed: 0 and 1 are the worst two neighbours.
    const extremes = [() => 0, () => 1];
    for (let slot = 0; slot + 1 < maxDioramaAvatars; slot += 1) {
      for (const first of extremes) {
        for (const second of extremes) {
          const left = holdingPosition(slot, bounds, first);
          const right = holdingPosition(slot + 1, bounds, second);
          const below = holdingPosition(slot + 6, bounds, second);
          expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeGreaterThanOrEqual(
            occupantSpacing - 1e-9,
          );
          expect(Math.hypot(left.x - below.x, left.z - below.z)).toBeGreaterThanOrEqual(
            occupantSpacing - 1e-9,
          );
        }
      }
    }
  });
});

describe("a crew stays aboard its own station", () => {
  it.each(teamCounts)("at %i teams, nobody is standing in a neighbour's boat", (count) => {
    const stations = stationsOf(count, 7);
    const anchors = new Map(
      stationAnchors(stations, boatsStagingTheme, bounds).map((anchor) => [
        anchor.stationId,
        anchor,
      ]),
    );
    for (const target of placeStaging(stations, [], boatsStagingTheme, bounds)) {
      if (target.stationId === null) continue;
      const anchor = anchors.get(target.stationId);
      expect(anchor).toBeDefined();
      if (anchor === undefined) continue;
      expect(target.scale).toBe(anchor.scale);
      expect(Math.abs(target.x - anchor.x)).toBeLessThanOrEqual(
        (boatsStagingTheme.stationFootprint.width * anchor.scale) / 2 + 1e-9,
      );
      expect(Math.abs(target.z - anchor.z)).toBeLessThanOrEqual(
        (boatsStagingTheme.stationFootprint.depth * anchor.scale) / 2 + 1e-9,
      );
    }
  });
});

function spotOf(targets: readonly StagedTarget[], id: string): StagedTarget | undefined {
  return targets.find((target) => target.entityId === id);
}

function agentAt(x: number, z: number): WanderAgent {
  return {
    entityId: "swimmer",
    x,
    z,
    heading: 0,
    targetHeading: 0,
    mode: "idle",
    modeUntil: 0,
    speed: 1,
    beatUntil: 0,
  };
}

describe("what happens to the stage when a team is created", () => {
  // REVERSAL, 2026-08-16 (staging-layout.ts records why). The old rule was "a station keeps
  // its exact spot when a new team is created", and it cannot coexist with guaranteed
  // clearance: the grid that fits N stations is not the grid that fits N+1. What replaces it
  // is a weaker promise that is actually keepable, and a motion rule that makes it read.
  it("keeps every station's identity and order - only the geometry re-packs", () => {
    const before = stationAnchors(stationsOf(3), boatsStagingTheme, bounds);
    const after = stationAnchors(stationsOf(4), boatsStagingTheme, bounds);
    expect(after.map((anchor) => anchor.stationId).slice(0, 3)).toEqual(
      before.map((anchor) => anchor.stationId),
    );
  });

  it("re-packs at all only when the grid actually changes shape", () => {
    // Six and seven boats want different grids; six twice wants the same one, and an
    // unchanged grid must produce byte-identical anchors or the stage would jitter on every
    // roster message.
    expect(stationAnchors(stationsOf(6), boatsStagingTheme, bounds)).toEqual(
      stationAnchors(stationsOf(6), boatsStagingTheme, bounds),
    );
    const six = stationGrid(6, boatsStagingTheme, bounds);
    const seven = stationGrid(7, boatsStagingTheme, bounds);
    expect({ columns: seven.columns, rows: seven.rows }).not.toEqual({
      columns: six.columns,
      rows: six.rows,
    });
  });

  it("moves a station to its new spot rather than teleporting it there", () => {
    // The whole reason the reversal is acceptable: diorama-scene.ts eases stations through
    // this, so the harbour visibly makes room instead of rearranging between two frames.
    const start = { x: -2, z: -1 };
    const target = { x: 1.5, z: -1 };
    const oneFrame = easeStationPosition(start, target, 1 / 60);
    expect(oneFrame.x).toBeCloseTo(start.x + stationSlideSpeed / 60, 6);
    expect(oneFrame.x).toBeLessThan(target.x);

    let position = start;
    let frames = 0;
    while (Math.hypot(target.x - position.x, target.z - position.z) > 1e-6 && frames < 600) {
      position = easeStationPosition(position, target, 1 / 60);
      frames += 1;
    }
    // Visible - a couple of seconds for 3.5 units - and it always arrives exactly.
    expect(frames).toBeGreaterThan(60);
    expect(position).toEqual(target);
    // ...except under reduced motion, where the layout survives and the journey does not.
    expect(easeStationPosition(start, target, 1 / 60, true)).toEqual(target);
  });

  it("does not move anyone already waiting when someone else boards", () => {
    const waiting = ["a", "b", "c", "d"];
    const before = placeStaging([], waiting, boatsStagingTheme, bounds);
    const after = placeStaging(
      [{ stationId: "t", label: "T", colorHex: "#fff", memberIds: ["b"] }],
      ["a", "c", "d"],
      boatsStagingTheme,
      bounds,
    );
    // "a" was first in the queue before and after, so its slot is unchanged.
    expect(spotOf(after, "a")?.x).toBe(spotOf(before, "a")?.x);
    expect(spotOf(after, "b")?.stationId).toBe("t");
  });
});

describe("placeStaging", () => {
  const stations = stationsOf(3, 2);
  const waiting = ["w-1", "w-2", "w-3"];
  const targets = placeStaging(stations, waiting, boatsStagingTheme, bounds);

  it("places every occupant exactly once", () => {
    expect(targets).toHaveLength(3 * 2 + waiting.length);
    expect(new Set(targets.map((target) => target.entityId)).size).toBe(targets.length);
  });

  it("marks waiting occupants with a null station and seated ones with theirs", () => {
    for (const id of waiting) {
      expect(targets.find((target) => target.entityId === id)?.stationId).toBeNull();
    }
    expect(targets.find((target) => target.entityId === "p-0-0")?.stationId).toBe("team-0");
  });

  it("seats members on their own station, not somebody else's", () => {
    const anchors = stationAnchors(stations, boatsStagingTheme, bounds);
    for (const anchor of anchors) {
      const seated = targets.filter((target) => target.stationId === anchor.stationId);
      for (const target of seated) {
        expect(Math.abs(target.x - anchor.x)).toBeLessThanOrEqual(
          boatsStagingTheme.stationFootprint.width / 2,
        );
      }
    }
  });

  it("is deterministic without a random source, and jittered with one", () => {
    const plain = placeStaging(stations, waiting, boatsStagingTheme, bounds);
    expect(plain).toEqual(targets);
    const jittered = placeStaging(stations, waiting, boatsStagingTheme, bounds, seededRandom(7));
    expect(jittered).not.toEqual(plain);
    // Same seed, same room, twice - a reopened display arranges identically.
    expect(placeStaging(stations, waiting, boatsStagingTheme, bounds, seededRandom(7))).toEqual(
      jittered,
    );
  });
});

describe("partitionForStaging", () => {
  it("splits by station and preserves join order within each", () => {
    const { members, waiting } = partitionForStaging(
      [
        { entityId: "a", stationId: "x" },
        { entityId: "b", stationId: null },
        { entityId: "c", stationId: "x" },
      ],
      ["x", "y"],
    );
    expect(members.get("x")).toEqual(["a", "c"]);
    expect(members.get("y")).toEqual([]);
    expect(waiting).toEqual(["b"]);
  });

  it("leaves members of a vanished station waiting rather than dropping them", () => {
    const { waiting } = partitionForStaging([{ entityId: "a", stationId: "gone" }], ["x"]);
    expect(waiting).toEqual(["a"]);
  });
});

describe("the move onto a station is a journey, not a teleport", () => {
  const options = { frozen: false, celebratingEntityIds: new Set<string>() };
  const target: StagedTarget = {
    entityId: "swimmer",
    stationId: "t",
    x: 2,
    z: -1.5,
    heading: 0,
    scale: 1,
  };

  it("walks toward the seat and arrives, taking real time to do it", () => {
    let agent = agentAt(-2, 2.5);
    let frames = 0;
    while (Math.hypot(target.x - agent.x, target.z - agent.z) > 0.05 && frames < 600) {
      agent = stepStagedAgent(agent, target, 1 / 60, options);
      frames += 1;
    }
    // Far enough that the crossing is visible: several seconds, not a frame.
    expect(frames).toBeGreaterThan(60);
    expect(frames).toBeLessThan(600);
    expect(agent.x).toBeCloseTo(target.x, 1);
    expect(agent.z).toBeCloseTo(target.z, 1);
    // The step that carries an agent inside the epsilon is still a step; the NEXT one settles
    // it onto the seat exactly and drops it out of the walk clip.
    expect(stepStagedAgent(agent, target, 1 / 60, options).mode).toBe("idle");
  });

  it("plays the walk clip while travelling and faces the way it is going", () => {
    const stepped = stepStagedAgent(agentAt(-2, 2.5), target, 1 / 60, options);
    expect(stepped.mode).toBe("walk");
    // Travelling +X and -Z: heading eases toward atan2(dx, dz), which is past a quarter turn.
    expect(stepped.heading).not.toBe(0);
  });

  it("never overshoots, however absurd the frame delta", () => {
    const stepped = stepStagedAgent(agentAt(-2, 2.5), target, 30, options);
    expect(stepped.x).toBeCloseTo(target.x, 5);
    expect(stepped.z).toBeCloseTo(target.z, 5);
  });

  it("adopts the seat's own facing once seated, not the travel direction", () => {
    const seated = stepStagedAgent(agentAt(2, -1.5), { ...target, heading: Math.PI }, 1, options);
    expect(seated.heading).toBeCloseTo(Math.PI, 5);
    expect(seated.mode).toBe("idle");
  });

  it("stands everyone still on their spot under reduced motion", () => {
    const frozen = stepStagedAgent(agentAt(-2, 2.5), target, 1 / 60, {
      ...options,
      frozen: true,
    });
    expect(frozen.x).toBe(target.x);
    expect(frozen.z).toBe(target.z);
    expect(frozen.heading).toBe(target.heading);
    expect(frozen.mode).toBe("idle");
  });

  it("lets a celebration outrank the walk", () => {
    const celebrating = stepStagedAgent(agentAt(-2, 2.5), target, 1 / 60, {
      frozen: false,
      celebratingEntityIds: new Set(["swimmer"]),
    });
    expect(celebrating.mode).toBe("celebrate");
  });
});

describe("treading water", () => {
  it("bobs deterministically per entity, and out of phase with its neighbours", () => {
    const one = holdingBobOffset("alice", 1.2, false);
    expect(holdingBobOffset("alice", 1.2, false)).toBe(one);
    expect(holdingBobOffset("bob", 1.2, false)).not.toBe(one);
    expect(Math.abs(one)).toBeLessThanOrEqual(0.035);
  });

  it("is exactly zero under reduced motion - bobbing is ambient motion", () => {
    expect(holdingBobOffset("alice", 1.2, true)).toBe(0);
  });
});

describe("the theme interface holds its own shape", () => {
  it.each(stagingThemes.map((theme) => [theme.id, theme] as const))(
    "%s declares a holding area, a station, seats, and where its colour goes",
    (_id, theme) => {
      expect(theme.stationNoun.length).toBeGreaterThan(0);
      expect(theme.holdingAreaNoun.length).toBeGreaterThan(0);
      expect(theme.seatOffsets.length).toBeGreaterThan(0);
      expect(theme.stationParts.length).toBeGreaterThan(0);
      // Recolour is the cheap variant only if the team colour actually reaches the station.
      const roles = new Set(theme.stationParts.map((part) => part.color));
      expect(roles.has("team")).toBe(true);
      // ...and the room's own accent has to appear somewhere, so a lobby of six team colours
      // still reads as one venue.
      expect(roles.has("accent")).toBe(true);
      // No theme may name a colour of its own: every part goes through a role.
      for (const part of theme.stationParts) {
        expect(typeof part.color).toBe("string");
      }
    },
  );

  it("ships two themes that genuinely differ, which is what proves the seam", () => {
    expect(boatsStagingTheme.holdingSurface).not.toBeNull();
    expect(campfiresStagingTheme.holdingSurface).toBeNull();
    expect(boatsStagingTheme.holdingMotion).not.toBe(campfiresStagingTheme.holdingMotion);
    expect(boatsStagingTheme.seatOffsets.length).not.toBe(campfiresStagingTheme.seatOffsets.length);
  });
});
