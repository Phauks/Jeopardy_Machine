// The rejoin probe's two pure pieces: what a verdict means, and how long a room has left.
//
// The countdown replaced "still live" on 2026-08-20 (owner: "instead of rejoining as a host
// saying still live, we should show the countdown until the room will expire"). "still live"
// answered a question nobody was asking - of course it is live, it is being offered, and the
// offer deletes itself the moment the probe says otherwise. The real question a host has when
// they see their own room sitting on the front page is how long they have before it expires.
import { describe, expect, it } from "vitest";
import {
  formatExpiryCountdown,
  probeRoomLiveness,
  verdictFor,
  verdictForStatus,
} from "#lib/lobby/room-liveness.ts";
import type { RoomLiveness } from "#lib/lobby/room-liveness.ts";

const now = 1_760_000_000_000;

describe("how long a room has left", () => {
  it("counts hours and minutes together, the way a person would say it", () => {
    expect(formatExpiryCountdown(now + 74 * 60_000, now)).toBe("1h 14m");
    expect(formatExpiryCountdown(now + 8 * 60_000, now)).toBe("8m");
    expect(formatExpiryCountdown(now + 59 * 60_000, now)).toBe("59m");
  });

  it("drops the minutes when there are none, rather than saying '2h 0m'", () => {
    expect(formatExpiryCountdown(now + 120 * 60_000, now)).toBe("2h");
  });

  it("says 'under a minute' rather than counting down to zero in front of somebody", () => {
    expect(formatExpiryCountdown(now + 30_000, now)).toBe("under a minute");
    expect(formatExpiryCountdown(now + 1, now)).toBe("under a minute");
  });

  // Two different nulls, and both mean "say nothing". An expired room is `gone` and its offer
  // is deleted, so a countdown reading zero beside "Rejoin" would be the offer arguing with
  // itself; an unknown deadline is a fact nobody has, and inventing one is worse than silence.
  it("says nothing for a deadline that has passed, or one nobody reported", () => {
    expect(formatExpiryCountdown(now, now)).toBeNull();
    expect(formatExpiryCountdown(now - 60_000, now)).toBeNull();
    expect(formatExpiryCountdown(null, now)).toBeNull();
  });
});

/** The probe against a stubbed endpoint that returns exactly this body. */
async function answer(body: RoomLiveness) {
  return probeRoomLiveness("BQKX7", () => Promise.resolve(Response.json(body)));
}

describe("what the probe makes of an answer", () => {
  const ok = (over: Partial<RoomLiveness> = {}): RoomLiveness => ({
    code: "BQKX7",
    live: true,
    registry: { status: "ok" },
    expiresAt: now + 3_600_000,
    ...over,
  });

  it("reads live, gone and unknown apart", () => {
    expect(verdictFor(ok())).toBe("live");
    expect(verdictFor(ok({ live: false }))).toBe("gone");
    // A registry that could not answer must never be read as "the room is dead": that would
    // silently delete a rejoin offer for a room sitting right there.
    expect(
      verdictFor(ok({ live: false, registry: { status: "unavailable", reason: "no-binding" } })),
    ).toBe("unknown");
  });

  it("settles a code that cannot exist, and forgives everything transient", () => {
    expect(verdictForStatus(400)).toBe("gone");
    expect(verdictForStatus(404)).toBe("gone");
    expect(verdictForStatus(500)).toBe("unknown");
    expect(verdictForStatus(503)).toBe("unknown");
  });

  it("carries the deadline back with the verdict, so the chip changes state once", async () => {
    expect(await answer(ok())).toEqual({ verdict: "live", expiresAt: now + 3_600_000 });
    expect(await answer(ok({ live: false, expiresAt: null }))).toEqual({
      verdict: "gone",
      expiresAt: null,
    });
  });

  it("never throws a remembered room away over a network blip", async () => {
    const offline = await probeRoomLiveness("BQKX7", () => Promise.reject(new Error("offline")));
    expect(offline).toEqual({ verdict: "unknown", expiresAt: null });
  });
});
