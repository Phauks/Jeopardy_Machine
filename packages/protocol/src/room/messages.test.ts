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

  it("carries the host's room-level controls (pause, force-expire, close)", () => {
    for (const message of [
      { version: v, type: "set-pause", paused: true },
      { version: v, type: "set-pause", paused: false },
      { version: v, type: "expire-timer" },
      { version: v, type: "close-room" },
    ]) {
      expect(parseRoomClientMessage(JSON.stringify(message)).ok, message.type).toBe(true);
    }
    // set-pause states its intent - a toggle would race two consoles into disagreement.
    expect(roomClientMessageSchema.safeParse({ version: v, type: "set-pause" }).success).toBe(
      false,
    );
  });

  it("lets team-join name WHO is being seated - the host's move, nobody else's", () => {
    // A phone moving itself sends no playerId; the host's roster panel names the player it is
    // rebalancing (apps/realtime enforces that only a host may). One message, two actors,
    // because it is the same edit.
    expect(
      parseRoomClientMessage(JSON.stringify({ version: v, type: "team-join", teamId: "t1" })).ok,
    ).toBe(true);
    const seated = parseRoomClientMessage(
      JSON.stringify({ version: v, type: "team-join", teamId: "t1", playerId: "p-abc" }),
    );
    expect(seated.ok).toBe(true);
    // Still strict: a stray field is a bug, not an extension point (ext exists for those).
    expect(
      roomClientMessageSchema.safeParse({
        version: v,
        type: "team-join",
        teamId: "t1",
        who: "p-abc",
      }).success,
    ).toBe(false);
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

// docs/decisions/2026-08-14-room-controls-and-staging.md: the host-only room controls, and
// the broadcast that makes a hidden join code vanish from the projector at once.
describe("room control messages", () => {
  it("carries a sparse settings patch and refuses an empty one", () => {
    expect(
      roomClientMessageSchema.safeParse({
        version: v,
        type: "update-room-settings",
        settings: { hideJoinCode: true },
      }).success,
    ).toBe(true);
    expect(
      roomClientMessageSchema.safeParse({
        version: v,
        type: "update-room-settings",
        settings: {},
      }).success,
    ).toBe(false);
    // The patch is nested on purpose - it is the same object the HTTP door takes.
    expect(
      roomClientMessageSchema.safeParse({
        version: v,
        type: "update-room-settings",
        hideJoinCode: true,
      }).success,
    ).toBe(false);
  });

  it("broadcasts the settings back with a stamp, and never the password", () => {
    const settings = {
      listing: "public",
      entry: "password",
      maxPlayers: 24,
      maxSpectators: 50,
      spectatorsAllowed: true,
      hideJoinCode: true,
      title: "Pub quiz night",
      hostLabel: "Board Game Club",
    };
    expect(
      roomServerMessageSchema.safeParse({
        version: v,
        type: "room-settings",
        settings,
        at: 1_760_000_000_000,
      }).success,
    ).toBe(true);
    expect(
      roomServerMessageSchema.safeParse({
        version: v,
        type: "room-settings",
        settings: { ...settings, password: "sequoia-2026" },
        at: 1_760_000_000_000,
      }).success,
    ).toBe(false);
  });

  it("keeps the two spectator refusals distinct from room-full", () => {
    for (const reason of ["room-full", "spectators-full", "spectators-not-allowed"]) {
      expect(
        roomServerMessageSchema.safeParse({ version: v, type: "refused", reason }).success,
      ).toBe(true);
    }
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
        paused: false,
        clueContent: null,
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

  it("carries the audience as a count on the roster, and keeps ABSENT distinct from zero", () => {
    // Spectators hold no seat and give no identity, so a number is the only honest thing a
    // roster can say about them. The field is optional because "this producer cannot count its
    // audience" is a real state - and it is NOT zero, exactly as the lobby row's spectator
    // fields work (registry.test.ts). A console that renders the two the same invents a fact.
    const rosterMessage = (roster: Record<string, unknown>) => ({
      version: v,
      type: "roster",
      roster,
    });
    const counted = parseRoomServerMessage(
      JSON.stringify(rosterMessage({ players: [], teams: [], spectatorCount: 4 })),
    );
    expect(
      counted.ok && counted.message.type === "roster" && counted.message.roster.spectatorCount,
    ).toBe(4);
    const unreported = parseRoomServerMessage(
      JSON.stringify(rosterMessage({ players: [], teams: [] })),
    );
    expect(
      unreported.ok &&
        unreported.message.type === "roster" &&
        unreported.message.roster.spectatorCount,
    ).toBeUndefined();
    // Bounded by the same hard cap the room admits people under - hosts tune down, never up.
    expect(
      parseRoomServerMessage(
        JSON.stringify(
          rosterMessage({
            players: [],
            teams: [],
            spectatorCount: limits.room.spectatorHardCap + 1,
          }),
        ),
      ).ok,
    ).toBe(false);
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

  // Added with the M4 surfaces (2026-08-14): authored text has no home in the engine, so it
  // rides its own message; the redaction table lives in the DO (apps/realtime/src/room/content.ts).
  it("round-trips clue content, including the roles that get nothing", () => {
    const cellTarget = { kind: "cell", roundIndex: 0, category: 2, row: 4 };
    for (const content of [
      {
        target: cellTarget,
        category: "Renewable Energy",
        prompt: { text: "A machine that converts wind to watts" },
        answer: { canonical: "What is a turbine?", accepted: ["turbine"] },
      },
      // A phone in a room with clue text off: prompt AND answer withheld, message still sent.
      { target: cellTarget, category: "Renewable Energy", prompt: null, answer: null },
      {
        target: { kind: "final" },
        category: "The final category",
        prompt: {
          text: "The final prompt",
          media: { mediaId: "0192f0a0-0000-7000-8000-000000000000" },
        },
        answer: null,
      },
    ]) {
      expect(
        roomServerMessageSchema.safeParse({ version: v, type: "clue-content", content }).success,
        JSON.stringify(content.target),
      ).toBe(true);
    }
  });

  it("names the three ways a room can end, so the polite screen has copy to show", () => {
    for (const reason of ["expired", "host-closed", "kicked"]) {
      expect(
        roomServerMessageSchema.safeParse({ version: v, type: "room-closed", reason }).success,
        reason,
      ).toBe(true);
    }
    expect(
      roomServerMessageSchema.safeParse({ version: v, type: "room-closed", reason: "bored" })
        .success,
    ).toBe(false);
  });

  it("carries the pause state on its own message and on every snapshot", () => {
    expect(
      roomServerMessageSchema.safeParse({ version: v, type: "paused", paused: true, at: 1 })
        .success,
    ).toBe(true);
    // Snapshot without the new fields is now incomplete - a client must always learn both.
    expect(
      roomServerMessageSchema.safeParse({
        version: v,
        type: "snapshot",
        stateVersion: 1,
        phase: "active",
        game: null,
        roster: { players: [], teams: [] },
      }).success,
    ).toBe(false);
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
