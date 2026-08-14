// The inspector contract. Like the lobby projection, what matters most is what it REFUSES:
// an operator instrument that could be talked into carrying a session token or a clue answer
// would be a leak with a diagnostic excuse.
import { describe, expect, it } from "vitest";
import {
  closeRoomResponseSchema,
  roomDiagnosticsSchema,
  roomInspectionSchema,
} from "./diagnostics.ts";

const diagnostics = {
  code: "BQKX7",
  lifecycle: "lobby",
  visibility: "public",
  title: "Pub quiz night",
  hostLabel: "Board Game Club",
  hasPassword: true,
  createdAt: 1_760_000_000_000,
  lastActivityAt: 1_760_000_060_000,
  expiresAt: 1_760_007_200_000,
  paused: false,
  stateVersion: 3,
  connections: { total: 4, host: 1, player: 2, display: 1, spectator: 0, unjoined: 0 },
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

describe("the close response", () => {
  it("reports the row deletion the same way creation reports the insert", () => {
    const closed = { code: "BQKX7", closed: true, registry: { status: "ok" } };
    expect(closeRoomResponseSchema.parse(closed)).toEqual(closed);
    expect(closeRoomResponseSchema.safeParse({ ...closed, closed: false }).success).toBe(false);
  });
});
