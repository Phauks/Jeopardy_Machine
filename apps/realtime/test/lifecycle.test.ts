// Room lifecycle per docs/decisions/2026-08-13-single-origin-binding.md: creation is an
// explicit typed RPC, connecting never creates, expired rooms answer no-such-room and free
// their code. M3 exit-criteria coverage: create / join / refuse-uncreated / expiry alarm.
import { runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
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
import type { RoomMeta } from "../src/room/storage.ts";
import type { GameRoomDO } from "../src/index.ts";

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
