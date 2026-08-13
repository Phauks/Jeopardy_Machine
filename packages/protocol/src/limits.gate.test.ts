// Fitness gate over the limits module: these are cross-field invariants that a careless
// "just bump the number" edit could silently break. If one of these reddens, the edit is
// wrong or docs/design/expansion-and-boundaries.md boundary 2.7 needs a deliberate update first.
import { describe, expect, it } from "vitest";
import { limits } from "./limits.ts";

describe("limits invariants", () => {
  it("keeps the soft player cap at or under the hard cap", () => {
    expect(limits.room.playerSoftCap).toBeLessThanOrEqual(limits.room.playerHardCap);
  });

  it("keeps the product promise: at least 100 players supported", () => {
    expect(limits.room.playerSoftCap).toBeGreaterThanOrEqual(100);
  });

  it("keeps every per-file media cap under the per-game total", () => {
    expect(limits.media.imageMaxBytes).toBeLessThan(limits.media.gameTotalMaxBytes);
    expect(limits.media.audioMaxBytes).toBeLessThan(limits.media.gameTotalMaxBytes);
  });

  it("keeps nickname bounds ordered and phone-roster sane", () => {
    expect(limits.player.nicknameMinLength).toBeGreaterThanOrEqual(1);
    expect(limits.player.nicknameMinLength).toBeLessThanOrEqual(limits.player.nicknameMaxLength);
    expect(limits.player.nicknameMaxLength).toBeLessThanOrEqual(64);
  });
});
