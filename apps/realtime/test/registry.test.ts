// The room DO reporting itself into the D1 registry that backs the public lobby
// (docs/decisions/2026-08-14-room-visibility-and-lobby.md, addendum "How registry updates
// reach D1"). These tests run against REAL D1 with the WEB app's migration applied
// (test/apply-migrations.ts), which is what makes them a drift gate as well as a behavior
// test: rename a column in apps/web/migrations and this suite reddens.
//
// The registry is a cache. The most important assertions here are the negative ones: a write
// that fails costs a lobby row and nothing else, and a stale row can never open a dead room.
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import {
  deleteRegistryRow,
  endRegistryRow,
  registryWriterStatements,
  relistRegistryRow,
  touchRegistryRow,
} from "../src/room/registry-writer.ts";
import {
  connectBot,
  connectHost,
  initializeRoom,
  instantBot,
  roomStub,
  TestClient,
  uniqueCode,
  upgradeToRoom,
} from "./helpers.ts";
import type { RoomMeta } from "../src/room/storage.ts";
import type { GameRoomDO } from "../src/index.ts";

type RoomRow = {
  code: string;
  title: string;
  host_label: string;
  listing: string;
  has_password: number;
  phase: string;
  player_count: number;
  player_cap: number;
  expires_at: number;
  ended_at: number | null;
};

// Stands in for the web Worker's create route, which is what really inserts the row (this
// Worker only ever updates one). Keeping the insert here in test-land is the honest shape:
// the DO must never conjure a row for a room the registry never heard of.
async function seedRow(code: string, options: { listing?: string; hasPassword?: boolean } = {}) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO rooms (code, title, host_label, listing, has_password, phase, player_count,
       player_cap, created_at, last_seen_at, expires_at, ended_at)
     VALUES (?, 'Registry suite', 'Suite', ?, ?, 'lobby', 0, ?, ?, ?, ?, NULL)`,
  )
    .bind(
      code,
      options.listing ?? "public",
      options.hasPassword === true ? 1 : 0,
      limits.room.playerSoftCap,
      now,
      now,
      now + limits.room.idleExpiryMs,
    )
    .run();
}

function readRow(code: string): Promise<RoomRow | null> {
  return env.DB.prepare(`SELECT * FROM rooms WHERE code = ?`).bind(code).first<RoomRow>();
}

describe("the DO's registry statements against the real schema", () => {
  it("touches phase, roster count, freshness and deadline - and nothing else", async () => {
    const code = uniqueCode();
    await seedRow(code);
    await touchRegistryRow(env.DB, {
      code,
      phase: "active",
      playerCount: 7,
      lastSeenAt: 1_760_000_000_000,
      expiresAt: 1_760_007_200_000,
    });
    const row = await readRow(code);
    expect(row).toMatchObject({ phase: "active", player_count: 7, expires_at: 1_760_007_200_000 });
    // Listing facts belong to the create route and the SETTINGS write; an ordinary touch (a
    // roster count, a phase change) must never rewrite them.
    expect(row?.title).toBe("Registry suite");
    expect(row?.listing).toBe("public");
  });

  it("relists a room whose host changed its settings - listing, text, lock and cap", async () => {
    const code = uniqueCode();
    await seedRow(code);
    await relistRegistryRow(env.DB, {
      code,
      listing: "private",
      title: "Renamed room",
      hostLabel: "New byline",
      hasPassword: true,
      playerCap: 12,
      lastSeenAt: 1_760_000_000_000,
    });
    const row = await readRow(code);
    expect(row).toMatchObject({
      listing: "private",
      title: "Renamed room",
      host_label: "New byline",
      has_password: 1,
      player_cap: 12,
    });
    // A relist is not a lifecycle write: the phase and the roster count belong to `touch`.
    expect(row?.phase).toBe("lobby");
  });

  it("never conjures a row for a room the registry never heard of", async () => {
    const code = uniqueCode();
    await touchRegistryRow(env.DB, {
      code,
      phase: "lobby",
      playerCount: 1,
      lastSeenAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });
    expect(await readRow(code)).toBeNull();
  });

  it("marks a finished room ended and deletes an expired one", async () => {
    const ending = uniqueCode();
    await seedRow(ending);
    await endRegistryRow(env.DB, ending, 1_760_000_000_000);
    expect(await readRow(ending)).toMatchObject({ phase: "ended", ended_at: 1_760_000_000_000 });

    const expiring = uniqueCode();
    await seedRow(expiring);
    await deleteRegistryRow(env.DB, expiring);
    expect(await readRow(expiring)).toBeNull();
  });

  it("swallows failures: a broken registry costs a row, never a room", async () => {
    // No binding at all is the vite-dev / unbound-worker case...
    await expect(
      touchRegistryRow(undefined, {
        code: "XXXXX",
        phase: "lobby",
        playerCount: 0,
        lastSeenAt: 1,
        expiresAt: 2,
      }),
    ).resolves.toBeUndefined();
    // ...and a database whose migration was never applied is the deploy-order case.
    const brokenDatabase = {
      prepare: () => {
        throw new Error("no such table: rooms");
      },
    } as unknown as D1Database;
    await expect(deleteRegistryRow(brokenDatabase, "XXXXX")).resolves.toBeUndefined();
  });

  it("binds every value (no interpolated room codes reach SQL)", () => {
    for (const sql of Object.values(registryWriterStatements)) {
      expect(sql).toContain("?");
      expect(sql).not.toMatch(/'\s*\+|\$\{/);
    }
  });
});

describe("a live room reporting itself", () => {
  it("reports its roster count as phones arrive", async () => {
    const code = uniqueCode();
    await seedRow(code);
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Lorax"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    const row = await readRow(code);
    expect(row?.player_count).toBe(1);
    expect(row?.phase).toBe("lobby");
  });

  it("reports the phase change when the game starts (what the lobby badge reads)", async () => {
    const code = uniqueCode();
    await seedRow(code);
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Maya"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");
    expect((await readRow(code))?.phase).toBe("active");
  });

  it("takes its row with it when the expiry alarm frees the code", async () => {
    const code = uniqueCode();
    await seedRow(code);
    const { hostToken } = await initializeRoom(code);
    await connectHost(code, hostToken);
    await runInDurableObject(roomStub(code), async (instance: GameRoomDO, state) => {
      const meta = await state.storage.get<RoomMeta>("meta");
      if (meta === undefined) throw new Error("room not initialized");
      meta.lastActivityAt = Date.now() - limits.room.idleExpiryMs - 60_000;
      await state.storage.put("meta", meta);
      (instance as unknown as { room: undefined }).room = undefined;
    });
    expect(await runDurableObjectAlarm(roomStub(code))).toBe(true);
    expect(await readRow(code)).toBeNull();
  });

  it("keeps a stale row powerless: the DO still refuses a room that no longer exists", async () => {
    const code = uniqueCode();
    // A row with hours left on its deadline, for a room that was never created.
    await seedRow(code);
    const late = new TestClient(await upgradeToRoom(code));
    expect((await late.waitFor("refused")).reason).toBe("no-such-room");
  });

  it("answers the ops snapshot with what the DO itself believes", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    await connectHost(code, hostToken);
    await connectBot(code, instantBot("Ada"));
    const response = await roomStub(code).fetch("https://do/registry-snapshot");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code, phase: "lobby", playerCount: 1 });
    const unknown = await roomStub(uniqueCode()).fetch("https://do/registry-snapshot");
    expect(unknown.status).toBe(404);
  });
});
