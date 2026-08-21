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

  it("keeps lobby listing text short enough to read and the query cap honest", () => {
    expect(limits.room.roomTitleMaxLength).toBeLessThanOrEqual(80);
    expect(limits.room.hostLabelMaxLength).toBeLessThanOrEqual(limits.room.roomTitleMaxLength);
    expect(limits.lobby.listingMax).toBeGreaterThan(0);
    // Pagination is deferred, so the cap IS the list: it must stay scrollable on a phone.
    expect(limits.lobby.listingMax).toBeLessThanOrEqual(100);
    // The cached response must not outlive the refresh interval, or the lobby would re-fetch
    // its own cache and never move.
    expect(limits.lobby.listingCacheSeconds * 1000).toBeLessThanOrEqual(
      limits.lobby.listingRefreshMs,
    );
  });

  it("keeps the spectator budget independent, bounded, and unable to starve the room", () => {
    // Two budgets exist so a stream audience cannot crowd out players (docs/decisions/
    // 2026-08-14-room-controls-and-staging.md); they must therefore be separately ordered...
    expect(limits.room.spectatorSoftCap).toBeLessThanOrEqual(limits.room.spectatorHardCap);
    // ...and the whole room must stay inside one Durable Object's comfortable connection
    // count: every participant of either kind is a live WebSocket on the same instance.
    expect(limits.room.playerHardCap + limits.room.spectatorHardCap).toBeLessThanOrEqual(512);
  });

  it("keeps empty-room expiry far shorter than idle expiry, and forgiving of a Wi-Fi blip", () => {
    // The two alarms answer different questions: idle = "occupied but dormant", empty =
    // "everyone left". An empty room that outlived a dormant one would make the shorter
    // deadline meaningless.
    expect(limits.room.emptyRoomGraceMs).toBeLessThan(limits.room.idleExpiryMs);
    // Long enough that a whole room losing its Wi-Fi and coming back keeps its game.
    expect(limits.room.emptyRoomGraceMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
    // ...and comfortably longer than the leader-succession grace, or a room could close
    // itself in the middle of deciding who leads a team.
    expect(limits.room.emptyRoomGraceMs).toBeGreaterThan(limits.team.leaderDisconnectGraceMs);
  });

  it("keeps team capacity able to seat the player hard cap", () => {
    // 20 teams x 5 players is the canonical 100-player shape (user-flows); the team cap must
    // never be the thing that makes a legal player count unseatable (4 players per team floor).
    expect(limits.team.teamMaxCount * 4).toBeGreaterThanOrEqual(limits.room.playerHardCap);
  });
});
