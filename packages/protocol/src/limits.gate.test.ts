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
    expect(limits.team.teamNameMinLength).toBeLessThanOrEqual(limits.team.teamNameMaxLength);
    expect(limits.team.teamNameMaxLength).toBeLessThanOrEqual(64);
  });

  it("keeps room-lifecycle timings ordered: rename window < leader grace-adjacent scales < idle expiry", () => {
    // A room must comfortably outlive every in-room timing mechanism, or the mechanisms
    // could fire on an already-expired room.
    expect(limits.player.renameWindowMs).toBeLessThan(limits.room.idleExpiryMs);
    expect(limits.team.leaderDisconnectGraceMs).toBeLessThan(limits.room.idleExpiryMs);
    // Expiry must stay >= 30min so a real dinner-break lull never kills a live game night.
    expect(limits.room.idleExpiryMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  it("keeps team capacity able to seat the player hard cap", () => {
    // 20 teams x 5 players is the canonical 100-player shape (user-flows); the team cap must
    // never be the thing that makes a legal player count unseatable (4 players per team floor).
    expect(limits.team.teamMaxCount * 4).toBeGreaterThanOrEqual(limits.room.playerHardCap);
  });
});
