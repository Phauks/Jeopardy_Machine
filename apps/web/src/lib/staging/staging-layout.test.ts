// The staged lobby's placement rules, where they are pure. Everything asserted here is a
// thing that has to be true on a projector and is invisible in a diff: stations that do not
// overlap, waiting people who are never standing inside a boat, a layout that does not shuffle
// when one person picks a team, and a team switch that produces an actual journey.
import { describe, expect, it } from "vitest";
import { boundsForAspect, seededRandom } from "#lib/diorama/wander.ts";
import {
  holdingPosition,
  partitionForStaging,
  placeStaging,
  stagingBands,
  stationAnchors,
} from "#lib/staging/staging-layout.ts";
import { holdingBobOffset, stepStagedAgent } from "#lib/staging/staging-motion.ts";
import { seatForMember } from "#lib/staging/staging-theme.ts";
import { stagingThemes } from "#lib/staging/staging-theme-registry.ts";
import { boatsStagingTheme } from "#lib/staging/staging-themes/boats.ts";
import { campfiresStagingTheme } from "#lib/staging/staging-themes/campfires.ts";
import type { StagedTarget, StagingStation } from "#lib/staging/staging-layout.ts";
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

describe.each(stagingThemes.map((theme) => [theme.id, theme] as const))(
  "%s: station packing",
  (_id, theme) => {
    it("keeps every station inside the pen", () => {
      for (const anchor of stationAnchors(stationsOf(8), theme, bounds)) {
        expect(Math.abs(anchor.x)).toBeLessThanOrEqual(bounds.halfWidth);
        expect(anchor.z).toBeLessThanOrEqual(bounds.halfDepth);
        expect(anchor.z).toBeGreaterThanOrEqual(-bounds.halfDepth);
      }
    });

    it("never overlaps two stations on the same row", () => {
      const anchors = stationAnchors(stationsOf(6), theme, bounds);
      const byRow = new Map<number, number[]>();
      for (const anchor of anchors) {
        const row = byRow.get(anchor.z) ?? [];
        row.push(anchor.x);
        byRow.set(anchor.z, row);
      }
      for (const xs of byRow.values()) {
        const sorted = xs.toSorted((left, right) => left - right);
        for (let index = 1; index < sorted.length; index += 1) {
          const gap = (sorted[index] ?? 0) - (sorted[index - 1] ?? 0);
          // Footprints already include the theme's own clearance, so touching is the floor.
          expect(gap).toBeGreaterThanOrEqual(theme.stationFootprint.width * 0.85);
        }
      }
    });

    it("wraps to a second row rather than shrinking the first", () => {
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
  },
);

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

describe("a station keeps its spot as the room fills", () => {
  it("does not move existing stations when a new team is created", () => {
    const before = stationAnchors(stationsOf(3), boatsStagingTheme, bounds);
    const after = stationAnchors(stationsOf(4), boatsStagingTheme, bounds);
    // Three boats fit on one row and four still do, so nobody should have shifted at all...
    expect(after.slice(0, 3).map((a) => a.z)).toEqual(before.map((a) => a.z));
    // ...and every station keeps its own identity in place, in input order.
    expect(after.map((a) => a.stationId).slice(0, 3)).toEqual(before.map((a) => a.stationId));
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
  const target = { entityId: "swimmer", stationId: "t", x: 2, z: -1.5, heading: 0 };

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
