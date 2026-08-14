import { describe, expect, it } from "vitest";
import { protocolVersion } from "../envelope/wire.ts";
import { limits } from "../limits.ts";
import { roleMayRelay } from "./authority.ts";
import { parseRoomClientMessage, roomClientMessageSchema } from "./client-messages.ts";
import {
  parseRoomServerMessage,
  roomCloseCodes,
  roomServerMessageSchema,
} from "./server-messages.ts";

const v = protocolVersion;

describe("room client messages", () => {
  it("parses a full player join with team-create intent", () => {
    const result = parseRoomClientMessage(
      JSON.stringify({
        version: v,
        type: "join",
        role: "player",
        nickname: "Lorax",
        avatarId: "cube-pets/fox",
        buzzSoundId: "pack/boing",
        team: { kind: "create", name: "Team Sequoia" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === "join") {
      expect(result.message.team).toEqual({ kind: "create", name: "Team Sequoia" });
    }
  });

  it("parses resume, sync, leave and an action relay without at/playerId", () => {
    for (const raw of [
      { version: v, type: "resume", sessionToken: "0".repeat(32) },
      { version: v, type: "sync" },
      { version: v, type: "leave" },
      { version: v, type: "action", action: { type: "buzz" } },
      { version: v, type: "action", action: { type: "select-cell", category: 2, row: 0 } },
    ]) {
      expect(parseRoomClientMessage(JSON.stringify(raw)).ok).toBe(true);
    }
  });

  it("refuses version skew with the actionable reason even when the shape has drifted", () => {
    const result = parseRoomClientMessage(
      JSON.stringify({ version: v + 1, type: "join", someFutureField: true }),
    );
    expect(result).toMatchObject({ ok: false, reason: "unsupported-version" });
  });

  it("refuses non-JSON, unknown types, and unknown fields outside ext", () => {
    expect(parseRoomClientMessage("{oops").ok).toBe(false);
    expect(parseRoomClientMessage(JSON.stringify({ version: v, type: "warp-core" })).ok).toBe(
      false,
    );
    expect(parseRoomClientMessage(JSON.stringify({ version: v, type: "sync", extra: 1 })).ok).toBe(
      false,
    );
    // ext bag IS the sanctioned home for foreign fields (boundary 2.6).
    expect(
      parseRoomClientMessage(
        JSON.stringify({ version: v, type: "sync", ext: { "com.example.trace": 7 } }),
      ).ok,
    ).toBe(true);
  });

  it("bounds nickname and team-name lengths by the limits module", () => {
    const tooLong = "x".repeat(limits.player.nicknameMaxLength + 1);
    expect(
      roomClientMessageSchema.safeParse({
        version: v,
        type: "join",
        role: "player",
        nickname: tooLong,
      }).success,
    ).toBe(false);
    expect(
      roomClientMessageSchema.safeParse({
        version: v,
        type: "team-update",
        name: "y".repeat(limits.team.teamNameMaxLength + 1),
      }).success,
    ).toBe(false);
  });

  // docs/decisions/2026-08-14-room-visibility-and-lobby.md: the shared room secret rides the
  // join MESSAGE (never the URL), is optional (most rooms are open), and is length-bounded.
  it("carries an optional room password on join, bounded by the limits module", () => {
    const join = (password?: string) => ({
      version: v,
      type: "join",
      role: "player",
      nickname: "Lorax",
      ...(password !== undefined && { password }),
    });
    expect(roomClientMessageSchema.safeParse(join()).success).toBe(true);
    expect(roomClientMessageSchema.safeParse(join("hunter2!")).success).toBe(true);
    expect(
      roomClientMessageSchema.safeParse(join("x".repeat(limits.room.roomPasswordMinLength - 1)))
        .success,
    ).toBe(false);
    expect(
      roomClientMessageSchema.safeParse(join("x".repeat(limits.room.roomPasswordMaxLength + 1)))
        .success,
    ).toBe(false);
    // Every role may present one - a display at the venue needs the room secret too; only the
    // host is exempt, and it proves the stronger claim with the creation token.
    expect(
      roomClientMessageSchema.safeParse({
        version: v,
        type: "join",
        role: "display",
        password: "hunter2!",
      }).success,
    ).toBe(true);
  });
});

describe("room server messages", () => {
  it("round-trips welcome, snapshot, event, and buzz-won", () => {
    for (const raw of [
      {
        version: v,
        type: "welcome",
        roomCode: "BQKX7",
        role: "player",
        playerId: "p-abc",
        sessionToken: "a".repeat(32),
      },
      {
        version: v,
        type: "snapshot",
        stateVersion: 12,
        phase: "active",
        game: { phase: "armed" },
        roster: { players: [], teams: [] },
      },
      { version: v, type: "event", stateVersion: 13, events: [{ type: "buzzers-armed" }] },
      {
        version: v,
        type: "buzz-won",
        stateVersion: 14,
        playerId: "p-abc",
        entityId: "t1",
        teamId: "t1",
        buzzSoundId: "pack/horn",
        at: 123456,
      },
    ]) {
      const result = parseRoomServerMessage(JSON.stringify(raw));
      expect(result.ok, JSON.stringify(raw)).toBe(true);
    }
  });

  it("keeps refusal reasons and close codes in agreement about the no-such-room path", () => {
    expect(
      roomServerMessageSchema.safeParse({ version: v, type: "refused", reason: "no-such-room" })
        .success,
    ).toBe(true);
    // 44xx = do-not-reconnect per the catalog contract.
    expect(roomCloseCodes.noSuchRoom).toBeGreaterThanOrEqual(4400);
    expect(roomCloseCodes.badToken).toBeGreaterThanOrEqual(4400);
    expect(roomCloseCodes.roomFull).toBeGreaterThanOrEqual(4400);
    expect(roomCloseCodes.roomClosed).toBeLessThan(4400);
  });

  it("carries both password refusals, which are retryable on the same socket", () => {
    for (const reason of ["password-required", "bad-password"]) {
      expect(
        roomServerMessageSchema.safeParse({ version: v, type: "refused", reason }).success,
        reason,
      ).toBe(true);
    }
    // The exhausted-attempts close reuses the existing join-refusal code - no new code, so
    // clients written against the M3 catalog still know not to reconnect.
    expect(roomCloseCodes.joinRefused).toBeGreaterThanOrEqual(4400);
  });

  it("refuses version skew symmetrically to the client parser", () => {
    const result = parseRoomServerMessage(JSON.stringify({ version: v + 5, type: "welcome" }));
    expect(result).toMatchObject({ ok: false, reason: "unsupported-version" });
  });
});

describe("action authority matrix", () => {
  it("lets only players buzz and only hosts judge, with acting-player open to both", () => {
    expect(roleMayRelay("player", "buzz")).toBe(true);
    expect(roleMayRelay("host", "buzz")).toBe(false);
    expect(roleMayRelay("host", "judge")).toBe(true);
    expect(roleMayRelay("player", "judge")).toBe(false);
    expect(roleMayRelay("player", "commit-wager")).toBe(true);
    expect(roleMayRelay("host", "commit-wager")).toBe(true);
  });

  it("never accepts server-only or unknown actions from any role", () => {
    for (const role of ["host", "player"] as const) {
      expect(roleMayRelay(role, "player-join")).toBe(false);
      expect(roleMayRelay(role, "player-leave")).toBe(false);
      expect(roleMayRelay(role, "made-up-action")).toBe(false);
    }
  });
});
