// The inspector contract. Like the lobby projection, what matters most is what it REFUSES:
// an operator instrument that could be talked into carrying a session token or a clue answer
// would be a leak with a diagnostic excuse.
import { describe, expect, it } from "vitest";
import {
  closeRoomResponseSchema,
  roomDiagnosticsSchema,
  roomInspectionSchema,
  updateRoomSettingsResponseSchema,
} from "./diagnostics.ts";

const diagnostics = {
  code: "BQKX7",
  lifecycle: "lobby",
  settings: {
    listing: "public",
    maxPlayers: 24,
    maxSpectators: 50,
    spectatorsAllowed: true,
    hideJoinCode: false,
    title: "Pub quiz night",
    hostLabel: "Board Game Club",
  },
  createdAt: 1_760_000_000_000,
  lastActivityAt: 1_760_000_060_000,
  expiresAt: 1_760_007_200_000,
  paused: false,
  stateVersion: 3,
  connections: { total: 4, host: 1, player: 2, display: 1, spectator: 0, unjoined: 0 },
  participants: {
    players: { seated: 2, connected: 2, max: 24 },
    spectators: { connected: 0, max: 50, allowed: true },
  },
  roster: { players: 2, connected: 2, teams: 1 },
  alarm: {
    nextWakeAt: 1_760_000_090_000,
    entries: [{ source: "engine-timer", label: "clue-answer", dueAt: 1_760_000_090_000 }],
  },
  storage: { totalBytes: 4096, keys: [{ key: "state", bytes: 2048 }] },
};

describe("room diagnostics", () => {
  it("parses a full reading of a live room", () => {
    expect(roomDiagnosticsSchema.parse(diagnostics)).toEqual(diagnostics);
  });

  it("refuses every secret a room holds, even when a caller offers one", () => {
    for (const leak of [
      { hostToken: "0".repeat(32) },
      { password: "hunter2!" },
      { passwordHash: { hash: "a".repeat(64), salt: "b".repeat(32) } },
      { sessionTokens: ["0".repeat(32)] },
      { clue: { prompt: "This gas...", answer: "What is methane" } },
      { players: [{ playerId: "p-1", nickname: "Lorax" }] },
    ]) {
      expect(roomDiagnosticsSchema.safeParse({ ...diagnostics, ...leak }).success).toBe(false);
    }
  });

  it("allows a room with no alarm scheduled (nothing pending, nothing to wake for)", () => {
    const idle = { ...diagnostics, alarm: { nextWakeAt: null, entries: [] } };
    expect(roomDiagnosticsSchema.parse(idle).alarm.nextWakeAt).toBeNull();
  });

  it("splits the census by the two budgets the room enforces separately", () => {
    // A spectator budget spent while player seats remain is the exact situation the split
    // exists for - one number could never say it.
    const streamed = {
      ...diagnostics,
      participants: {
        players: { seated: 2, connected: 1, max: 24 },
        spectators: { connected: 50, max: 50, allowed: true },
      },
    };
    expect(roomDiagnosticsSchema.parse(streamed).participants.spectators.connected).toBe(50);
    // Counts only: naming a spectator would make the inspector a directory of people.
    expect(
      roomDiagnosticsSchema.safeParse({
        ...diagnostics,
        participants: {
          ...diagnostics.participants,
          spectators: { ...diagnostics.participants.spectators, names: ["Lorax"] },
        },
      }).success,
    ).toBe(false);
  });

  it("names the empty-room grace timer in the alarm book, beside idle expiry", () => {
    const emptying = {
      ...diagnostics,
      alarm: {
        nextWakeAt: 1_760_000_090_000,
        entries: [
          { source: "empty-room", label: "room", dueAt: 1_760_000_090_000 },
          { source: "idle-expiry", label: "room", dueAt: 1_760_007_200_000 },
        ],
      },
    };
    expect(roomDiagnosticsSchema.parse(emptying).alarm.entries).toHaveLength(2);
  });
});

describe("the inspection response", () => {
  it("carries the DO reading beside what the registry believes", () => {
    const inspection = {
      room: diagnostics,
      registry: { status: "ok" },
      registryRow: {
        listed: true,
        phase: "lobby",
        playerCount: 2,
        expiresAt: 1_760_007_200_000,
        endedAt: null,
      },
    };
    expect(roomInspectionSchema.parse(inspection)).toEqual(inspection);
  });

  it("allows a live room with NO registry row - the drift the lobby bug was made of", () => {
    const inspection = {
      room: diagnostics,
      registry: { status: "unavailable", reason: "no-table" },
      registryRow: null,
    };
    expect(roomInspectionSchema.parse(inspection).registryRow).toBeNull();
  });
});

describe("the settings-update response", () => {
  it("answers with the settings AFTER the edit and the lobby row's verdict", () => {
    const updated = {
      code: "BQKX7",
      settings: diagnostics.settings,
      registry: { status: "unavailable", reason: "no-table" },
    };
    expect(updateRoomSettingsResponseSchema.parse(updated)).toEqual(updated);
  });

  it("never echoes the password that was just set", () => {
    expect(
      updateRoomSettingsResponseSchema.safeParse({
        code: "BQKX7",
        settings: diagnostics.settings,
        registry: { status: "ok" },
        password: "sequoia-2026",
      }).success,
    ).toBe(false);
  });
});

describe("the close response", () => {
  it("reports the row deletion the same way creation reports the insert", () => {
    const closed = { code: "BQKX7", closed: true, registry: { status: "ok" } };
    expect(closeRoomResponseSchema.parse(closed)).toEqual(closed);
    expect(closeRoomResponseSchema.safeParse({ ...closed, closed: false }).success).toBe(false);
  });
});
