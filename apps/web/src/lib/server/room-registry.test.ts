// Repository behavior against a recording fake, plus a drift gate against the migration that
// owns the table. The seam is deliberate: apps/web's vitest is plain node (docs/DEVELOPMENT.md)
// and cannot host a real D1, so REAL execution of this schema happens in the realtime workerd
// suite, which applies this very migration and runs the DO's writer statements against it
// (apps/realtime/test/registry.test.ts). Here we hold what a fake can prove honestly: that
// every value is bound rather than interpolated, that liveness is filtered in SQL, and that
// no statement names a column the migration does not define.
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import migrationSql from "../../../migrations/0001_create_rooms.sql?raw";
import {
  forgetRoom,
  listPublicRooms,
  registerRoom,
  registryStatements,
  sweepExpiredRooms,
} from "./room-registry.ts";
import type { RegistryDatabase, RegistryStatement } from "./room-registry.ts";

type Call = { sql: string; values: unknown[] };

// Minimal D1 stand-in: records every prepared statement and its bound values, answers reads
// from a queue of canned row sets.
function fakeDatabase(rows: Record<string, unknown>[][] = []): RegistryDatabase & {
  calls: Call[];
} {
  const calls: Call[] = [];
  const pending = [...rows];
  const database = {
    calls,
    prepare(sql: string): RegistryStatement {
      const call: Call = { sql, values: [] };
      calls.push(call);
      const statement: RegistryStatement = {
        bind(...values: unknown[]) {
          call.values = values;
          return statement;
        },
        run: () => Promise.resolve({ success: true }),
        all: <Row>() => Promise.resolve({ results: (pending.shift() ?? []) as Row[] }),
      };
      return statement;
    },
    batch: (statements: RegistryStatement[]) => Promise.resolve(statements.map(() => ({}))),
  };
  return database;
}

const liveRow = {
  code: "BQKX7",
  title: "Pub quiz night",
  host_label: "Board Game Club",
  visibility: "public",
  has_password: 1,
  phase: "active",
  player_count: 12,
  player_cap: limits.room.playerSoftCap,
  created_at: 1_760_000_000_000,
  last_seen_at: 1_760_000_060_000,
  expires_at: 1_760_007_200_000,
};

describe("registering a room", () => {
  it("binds every host-supplied value instead of interpolating it", async () => {
    const database = fakeDatabase();
    await registerRoom(database, {
      // A title carrying SQL punctuation is the point: it must travel as a parameter.
      code: "BQKX7",
      title: "Robert'); DROP TABLE rooms;--",
      hostLabel: "Board Game Club",
      visibility: "public",
      hasPassword: true,
      createdAt: 1_760_000_000_000,
      expiresAt: 1_760_007_200_000,
    });
    const call = database.calls[0];
    expect(call?.sql).not.toContain("DROP TABLE");
    expect(call?.values).toContain("Robert'); DROP TABLE rooms;--");
    // Booleans become D1's 0/1, and the cap comes from the limits module, not the caller.
    expect(call?.values).toContain(1);
    expect(call?.values).toContain(limits.room.playerSoftCap);
  });

  it("upserts, because an expired room's code is reusable", () => {
    expect(registryStatements.upsert).toContain("ON CONFLICT(code) DO UPDATE");
    // A reused code starts a NEW room: the row must reset, not accumulate the old one's life.
    expect(registryStatements.upsert).toContain("ended_at = NULL");
    expect(registryStatements.upsert).toContain("player_count = 0");
  });
});

describe("listing public rooms", () => {
  it("asks only for live public rooms, newest first, and maps rows to the wire shape", async () => {
    const database = fakeDatabase([[liveRow]]);
    const rooms = await listPublicRooms(database, 1_760_000_100_000);
    expect(database.calls[0]?.sql).toContain("visibility = 'public'");
    expect(database.calls[0]?.sql).toContain("ended_at IS NULL");
    expect(database.calls[0]?.sql).toContain("expires_at > ?");
    expect(database.calls[0]?.sql).toContain("ORDER BY created_at DESC");
    expect(rooms).toEqual([
      {
        code: "BQKX7",
        title: "Pub quiz night",
        hostLabel: "Board Game Club",
        visibility: "public",
        hasPassword: true,
        phase: "active",
        playerCount: 12,
        playerCap: limits.room.playerSoftCap,
        createdAt: 1_760_000_000_000,
        lastSeenAt: 1_760_000_060_000,
      },
    ]);
  });

  it("clamps the listing cap to the operational limit - a caller cannot lift it", async () => {
    const database = fakeDatabase([[], [], []]);
    await listPublicRooms(database, 1, 5000);
    await listPublicRooms(database, 1, 0);
    await listPublicRooms(database, 1, 7);
    expect(database.calls.map((call) => call.values[1])).toEqual([limits.lobby.listingMax, 1, 7]);
  });

  it("reports no password when the row says 0 (the only password fact that is ever public)", async () => {
    const database = fakeDatabase([[{ ...liveRow, has_password: 0, host_label: "" }]]);
    const [room] = await listPublicRooms(database, 1);
    expect(room?.hasPassword).toBe(false);
    expect(room?.hostLabel).toBe("");
  });
});

describe("sweeping and forgetting", () => {
  it("deletes only rows past their expiry deadline", async () => {
    const database = fakeDatabase();
    await sweepExpiredRooms(database, 1_760_007_200_001);
    expect(database.calls[0]?.sql).toContain("DELETE FROM rooms WHERE expires_at <= ?");
    expect(database.calls[0]?.values).toEqual([1_760_007_200_001]);
  });

  it("forgets one room by bound code", async () => {
    const database = fakeDatabase();
    await forgetRoom(database, "BQKX7");
    expect(database.calls[0]?.sql).toContain("WHERE code = ?");
    expect(database.calls[0]?.values).toEqual(["BQKX7"]);
  });
});

// Gate: the migration is the canonical schema (CLAUDE.md - customization and structure live
// in documents, and here the .sql file IS the document). A column renamed there must break
// this, not production's lobby.
describe("schema drift gate", () => {
  const columns = [...migrationSql.matchAll(/^\s{2}(?<column>[a-z_]+) (?:TEXT|INTEGER)/gm)].map(
    (match) => match.groups?.["column"] ?? "",
  );

  it("reads the migration's column list", () => {
    expect(columns).toEqual([
      "code",
      "title",
      "host_label",
      "visibility",
      "has_password",
      "phase",
      "player_count",
      "player_cap",
      "created_at",
      "last_seen_at",
      "expires_at",
      "ended_at",
    ]);
  });

  it("names no column the migration does not define", () => {
    const known = new Set([...columns, "rooms", "excluded", "NULL"]);
    for (const [name, sql] of Object.entries(registryStatements)) {
      // Every bare snake_case identifier in a statement must be a real column.
      for (const identifier of sql.match(/\b[a-z]+_[a-z_]+\b/g) ?? []) {
        expect(known.has(identifier), `${name} names unknown column ${identifier}`).toBe(true);
      }
    }
  });
});
