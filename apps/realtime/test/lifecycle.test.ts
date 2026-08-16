// Room lifecycle per docs/decisions/2026-08-13-single-origin-binding.md: creation is an
// explicit typed RPC, connecting never creates, expired rooms answer no-such-room and free
// their code. M3 exit-criteria coverage: create / join / refuse-uncreated / expiry alarm.
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
import { roomCloseCodes } from "@jeopardy/protocol/room/server-messages";
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
import type { AlarmSchedule, RoomMeta } from "../src/room/storage.ts";
import type { GameRoomDO } from "../src/index.ts";

/**
 * Poll the DO's stored empty-room deadline until it satisfies `predicate`, and answer it.
 * Polling rather than sleeping because the arm/cancel happens inside a socket lifecycle
 * event: the test must not guess how long that takes, only that it does.
 */
async function waitForEmptyDeadline(
  code: string,
  predicate: (deadline: number | null) => boolean,
  timeoutMs = 5000,
): Promise<number> {
  const giveUpAt = Date.now() + timeoutMs;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop
    const deadline = await runInDurableObject(roomStub(code), async (_instance, state) => {
      const schedule = await state.storage.get<AlarmSchedule>("schedule");
      return schedule?.emptyRoomAt ?? null;
    });
    if (predicate(deadline)) return deadline ?? 0;
    if (Date.now() > giveUpAt) {
      throw new Error(`empty-room deadline never satisfied the predicate (last: ${String(deadline)})`);
    }
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("explicit room creation", () => {
  it("refuses WebSocket upgrades for a code nobody created (no-such-room, close 4404)", async () => {
    const client = new TestClient(await upgradeToRoom(uniqueCode()));
    const refused = await client.waitFor("refused");
    expect(refused.reason).toBe("no-such-room");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.closes[0]?.code).toBe(roomCloseCodes.noSuchRoom);
  });

  it("initializes exactly once: the second create on a live code answers 409", async () => {
    const code = uniqueCode();
    const first = await initializeRoom(code);
    expect(first.hostToken).toMatch(/^[0-9a-f]{32}$/);
    expect(first.expiresAt).toBeGreaterThan(Date.now());
    const again = await roomStub(code).fetch("https://do/initialize", {
      method: "POST",
      body: JSON.stringify({ game: { kind: "compact", rounds: [{ columns: 3, rows: 3 }] } }),
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already-active" });
  });

  it("rejects non-websocket requests to room paths and malformed codes at the router", async () => {
    const noUpgrade = await SELF.fetch("https://realtime.test/room/BQKX7/ws");
    expect(noUpgrade.status).toBe(426);
    const badCode = await SELF.fetch("https://realtime.test/room/toolongcode/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(badCode.status).toBe(404);
  });
});

describe("joining a created room", () => {
  it("host joins with the creation token; a wrong token is refused with close 4401", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);

    const impostor = new TestClient(await upgradeToRoom(code));
    impostor.send({ type: "join", role: "host", hostToken: "f".repeat(32) });
    const refused = await impostor.waitFor("refused");
    expect(refused.reason).toBe("bad-host-token");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(impostor.closes[0]?.code).toBe(roomCloseCodes.badToken);

    const host = await connectHost(code, hostToken);
    const welcome = host.messagesOf("welcome")[0];
    expect(welcome).toMatchObject({ role: "host", playerId: null, sessionToken: null });
    const snapshot = host.messagesOf("snapshot")[0];
    expect(snapshot?.phase).toBe("lobby");
  });

  it("players get a seat, a session token, a snapshot, and everyone sees the roster grow", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);

    const bot = await connectBot(code, instantBot("Lorax"));
    expect(bot.playerId).toBe("p-1");
    expect(bot.sessionToken).toMatch(/^[0-9a-f]{32}$/);

    const roster = await host.waitFor("roster", (message) => message.roster.players.length === 1);
    expect(roster.roster.players[0]).toMatchObject({
      playerId: "p-1",
      identity: { nickname: "Lorax" },
      connected: true,
    });
  });

  it("suffixes duplicate nicknames instead of refusing them (user-flows A2)", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Maya"));
    await connectBot(code, { ...instantBot("Maya"), seed: "other-seed" });
    const roster = await host.waitFor("roster", (message) => message.roster.players.length === 2);
    const nicknames = roster.roster.players.map((entry) => entry.identity.nickname);
    expect(nicknames).toContain("Maya");
    expect(nicknames).toContain("Maya 2");
  });

  it("displays and spectators join anonymously and cannot send actions", async () => {
    const code = uniqueCode();
    await initializeRoom(code);
    const display = new TestClient(await upgradeToRoom(code));
    display.send({ type: "join", role: "display" });
    const welcome = await display.waitFor("welcome");
    expect(welcome).toMatchObject({ role: "display", playerId: null, sessionToken: null });
    display.sendAction({ type: "arm-buzzers" });
    const error = await display.waitFor("error");
    expect(error.reason).toBe("unauthorized");
  });
});

describe("expiry alarm", () => {
  it("wipes an idle room, closes its sockets, answers no-such-room after, and frees the code", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);

    // Backdate the activity stamp past the idle limit, drop the in-memory cache so the
    // alarm handler reloads from storage, then force the alarm.
    await runInDurableObject(roomStub(code), async (instance: GameRoomDO, state) => {
      const meta = await state.storage.get<RoomMeta>("meta");
      if (meta === undefined) throw new Error("room not initialized");
      meta.lastActivityAt = Date.now() - limits.room.idleExpiryMs - 60_000;
      await state.storage.put("meta", meta);
      (instance as unknown as { room: undefined }).room = undefined;
    });
    const ran = await runDurableObjectAlarm(roomStub(code));
    expect(ran).toBe(true);

    const closed = await host.waitFor("room-closed");
    expect(closed.reason).toBe("expired");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.closes[0]?.code).toBe(roomCloseCodes.roomClosed);

    // The code is dead ("no such room")...
    const late = new TestClient(await upgradeToRoom(code));
    const refused = await late.waitFor("refused");
    expect(refused.reason).toBe("no-such-room");

    // ...and reusable: a fresh create on the same code succeeds (fresh host token).
    const recreated = await initializeRoom(code);
    expect(recreated.hostToken).not.toBe(hostToken);
  });

  it("closes a room whose last participant left, once the grace elapses", async () => {
    const code = uniqueCode();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rooms (code, title, host_label, listing, has_password, phase, player_count,
         player_cap, created_at, last_seen_at, expires_at, ended_at)
       VALUES (?, 'Empty suite', '', 'public', 0, 'lobby', 0, ?, ?, ?, ?, NULL)`,
    )
      .bind(code, limits.room.playerSoftCap, now, now, now + limits.room.idleExpiryMs)
      .run();
    const { hostToken } = await initializeRoom(code, undefined, "empty-suite", {
      listing: "public",
      title: "Empty suite",
    });
    const host = await connectHost(code, hostToken);

    // Everyone leaves. The room is NOT closed yet - the grace window is the entire point,
    // because "everyone left" and "the venue's Wi-Fi hiccuped" look identical at first.
    host.socket.close(1000, "left the venue");
    const armed = await waitForEmptyDeadline(code, (deadline) => deadline !== null);
    expect(armed).toBeGreaterThan(Date.now());
    expect(armed).toBeLessThanOrEqual(Date.now() + limits.room.emptyRoomGraceMs);

    // Fast-forward the deadline and fire the one runtime alarm.
    await runInDurableObject(roomStub(code), async (instance: GameRoomDO, state) => {
      const schedule = await state.storage.get<AlarmSchedule>("schedule");
      if (schedule === undefined) throw new Error("no schedule");
      schedule.emptyRoomAt = Date.now() - 1000;
      await state.storage.put("schedule", schedule);
      (instance as unknown as { room: undefined }).room = undefined;
    });
    expect(await runDurableObjectAlarm(roomStub(code))).toBe(true);

    // The room is over and the lobby says so. The storage wipe stays with the IDLE alarm, so
    // the code is still spent and a host who comes back still finds the state.
    const response = await roomStub(code).fetch("https://do/diagnostics", {
      headers: { [hostTokenHeader]: hostToken },
    });
    expect(((await response.json()) as { lifecycle: string }).lifecycle).toBe("ended");
    const row = await env.DB.prepare(`SELECT phase, ended_at FROM rooms WHERE code = ?`)
      .bind(code)
      .first<{ phase: string; ended_at: number | null }>();
    expect(row?.phase).toBe("ended");
    expect(row?.ended_at).not.toBeNull();
  });

  it("cancels the empty-room countdown the moment anyone reconnects", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);

    host.socket.close(1000, "phone slept");
    expect(await waitForEmptyDeadline(code, (deadline) => deadline !== null)).toBeGreaterThan(0);

    // A whole room losing its Wi-Fi and coming back must keep its game. Cancelling on CONNECT
    // rather than on join is deliberate: a socket still choosing a nickname is not an
    // abandoned room either.
    const returning = new TestClient(await upgradeToRoom(code));
    await waitForEmptyDeadline(code, (deadline) => deadline === null);

    // ...and the alarm, when it does fire, finds nothing to close.
    expect(await runDurableObjectAlarm(roomStub(code))).toBe(true);
    returning.send({ type: "join", role: "host", hostToken });
    expect((await returning.waitFor("welcome")).role).toBe("host");
    expect((await returning.waitFor("snapshot")).phase).toBe("lobby");
  });

  it("does not expire an active room: the alarm re-arms against fresh activity", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const ran = await runDurableObjectAlarm(roomStub(code));
    expect(ran).toBe(true); // the initialize-time expiry alarm existed and ran...
    host.send({ type: "sync" });
    await host.waitFor("snapshot");
    expect(host.closes.length).toBe(0); // ...but a live room survives it untouched
  });
});
