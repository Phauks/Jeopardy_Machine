// Room controls on a LIVE room, inside workerd (docs/decisions/2026-08-14-room-controls-and-
// staging.md): the two participant budgets, the spectator switch, streamer mode
// that can change mid-night, and the broadcast that makes all of it visible immediately.
//
// The properties under test are the ones that make the feature trustworthy rather than the
// ones that make it work:
//
// - the two budgets are INDEPENDENT and refuse with DIFFERENT reasons (an audience must never
//   be able to fill the room the players came to play in);
// - every change reaches every connection as one `room-settings` message, because a join code
//   that just became hidden must vanish from the projector at once;
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
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
import type { RoomDiagnostics } from "@jeopardy/protocol/room/diagnostics";
import type { RoomSettings, RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";

function patchOverRpc(
  code: string,
  hostToken: string | null,
  settings: RoomSettingsPatch,
): Promise<Response> {
  return roomStub(code).fetch("https://do/settings", {
    method: "POST",
    headers: hostToken === null ? {} : { [hostTokenHeader]: hostToken },
    body: JSON.stringify({ settings }),
  });
}

async function settingsOf(code: string, hostToken: string): Promise<RoomSettings> {
  const response = await roomStub(code).fetch("https://do/diagnostics", {
    headers: { [hostTokenHeader]: hostToken },
  });
  return ((await response.json()) as RoomDiagnostics).settings;
}

async function joinSpectator(code: string): Promise<TestClient> {
  const client = new TestClient(await upgradeToRoom(code));
  client.send({ type: "join", role: "spectator" });
  return client;
}

describe("the participant budgets", () => {
  it("refuses the player who does not fit, and counts spectators separately", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "caps-suite", { maxPlayers: 1 });
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Seated"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);

    const latecomer = new TestClient(await upgradeToRoom(code));
    latecomer.send({ type: "join", role: "player", nickname: "Latecomer" });
    expect((await latecomer.waitFor("refused")).reason).toBe("room-full");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(latecomer.closes[0]?.code).toBe(roomCloseCodes.roomFull);

    // The player cap is spent; the spectator budget is untouched, which is the whole point of
    // there being two of them.
    const spectator = await joinSpectator(code);
    expect((await spectator.waitFor("welcome")).role).toBe("spectator");
  });

  it("refuses the spectator who does not fit, with its own reason, leaving seats free", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "caps-suite", {
      maxSpectators: 1,
    });
    const host = await connectHost(code, hostToken);
    const first = await joinSpectator(code);
    expect((await first.waitFor("welcome")).role).toBe("spectator");

    const overflow = await joinSpectator(code);
    expect((await overflow.waitFor("refused")).reason).toBe("spectators-full");

    // Players still get in: a full audience is not a full room.
    const bot = await connectBot(code, instantBot("Player"));
    expect(bot.playerId).toBe("p-1");
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
  });

  it("refuses spectators entirely when the host turned them off - a different reason again", async () => {
    const code = uniqueCode();
    await initializeRoom(code, undefined, "caps-suite", { spectatorsAllowed: false });
    const spectator = await joinSpectator(code);
    expect((await spectator.waitFor("refused")).reason).toBe("spectators-not-allowed");

    // The DISPLAY is not a spectator: the projector is the host's own screen and belongs to
    // neither budget, so it still joins a spectator-free room.
    const display = new TestClient(await upgradeToRoom(code));
    display.send({ type: "join", role: "display" });
    expect((await display.waitFor("welcome")).role).toBe("display");
  });

  it("never lets a host buy a bigger room than the operational limit allows", async () => {
    const code = uniqueCode();
    const response = await roomStub(code).fetch("https://do/initialize", {
      method: "POST",
      body: JSON.stringify({
        game: { kind: "compact", rounds: [{ columns: 3, rows: 3 }] },
        maxPlayers: limits.room.playerHardCap + 1,
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe("changing a live room's settings", () => {
  it("broadcasts to EVERY connection, so a hidden join code leaves the projector at once", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const display = new TestClient(await upgradeToRoom(code));
    display.send({ type: "join", role: "display" });
    await display.waitFor("welcome");
    // Every join already carries the settings once, so a surface never has to ask.
    expect((await display.waitFor("room-settings")).settings.hideJoinCode).toBe(false);

    host.send({ type: "update-room-settings", settings: { hideJoinCode: true } });
    const hidden = await display.waitFor(
      "room-settings",
      (message) => message.settings.hideJoinCode,
    );
    expect(hidden.settings.hideJoinCode).toBe(true);
    // The host sees its own change land too - one broadcast, not a private acknowledgement.
    await host.waitFor("room-settings", (message) => message.settings.hideJoinCode);
  });

  it("is host-only: a player asking to retune the room is unauthorized and changes nothing", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Ambitious" });
    await phone.waitFor("welcome");

    phone.send({ type: "update-room-settings", settings: { maxPlayers: 2 } });
    expect((await phone.waitFor("error")).reason).toBe("unauthorized");
    expect((await settingsOf(code, hostToken)).maxPlayers).toBe(limits.room.playerSoftCap);
    expect(host.messagesOf("room-settings")).toHaveLength(1); // the join one, and no other
  });

  it("applies the same patch through the RPC door, and refuses it without the token", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    expect((await patchOverRpc(code, null, { maxPlayers: 4 })).status).toBe(403);
    expect((await patchOverRpc(code, "0".repeat(32), { maxPlayers: 4 })).status).toBe(403);
    expect((await patchOverRpc(uniqueCode(), hostToken, { maxPlayers: 4 })).status).toBe(404);

    const response = await patchOverRpc(code, hostToken, {
      maxPlayers: 4,
      maxSpectators: 2,
      listing: "private",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { settings: RoomSettings };
    expect(body.settings).toMatchObject({ maxPlayers: 4, maxSpectators: 2, listing: "private" });
    // An empty patch changes nothing and says so rather than pretending to work.
    expect((await patchOverRpc(code, hostToken, {})).status).toBe(400);
  });

  it("refuses to publish an unnamed room, and to shrink a cap below the people inside", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Ada"));
    await connectBot(code, instantBot("Bea"));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);

    const unnamed = await patchOverRpc(code, hostToken, { listing: "public" });
    expect(unnamed.status).toBe(409);
    expect(await unnamed.json()).toEqual({ error: "title-required" });

    const tooSmall = await patchOverRpc(code, hostToken, { maxPlayers: 1 });
    expect(tooSmall.status).toBe(409);
    expect(await tooSmall.json()).toEqual({ error: "below-current" });
    // Nobody was ejected by the attempt, and nothing moved.
    expect((await settingsOf(code, hostToken)).maxPlayers).toBe(limits.room.playerSoftCap);

    // A title arriving WITH the listing change is the whole fix - one call, no refusal.
    const named = await patchOverRpc(code, hostToken, { listing: "public", title: "Quiz night" });
    expect(named.status).toBe(200);
    expect((await settingsOf(code, hostToken)).listing).toBe("public");
  });

  it("re-projects the lobby row: going private delists immediately, and the cap follows", async () => {
    const code = uniqueCode();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rooms (code, title, host_label, listing, phase, player_count,
         player_cap, created_at, last_seen_at, expires_at, ended_at)
       VALUES (?, 'Settings suite', '', 'public', 'lobby', 0, ?, ?, ?, ?, NULL)`,
    )
      .bind(code, limits.room.playerSoftCap, now, now, now + limits.room.idleExpiryMs)
      .run();
    const { hostToken } = await initializeRoom(code, undefined, "settings-suite", {
      listing: "public",
      title: "Settings suite",
    });

    await patchOverRpc(code, hostToken, { listing: "private", maxPlayers: 12 });
    const row = await env.DB.prepare(`SELECT listing, player_cap FROM rooms WHERE code = ?`)
      .bind(code)
      .first<{ listing: string; player_cap: number }>();
    expect(row).toMatchObject({ listing: "private", player_cap: 12 });
  });
});

describe("what a settings surface may never carry", () => {
  it("keeps the HOST TOKEN out of every settings answer: broadcast, RPC, and inspector", async () => {
    // Passwords are gone (@jeopardy/protocol room/visibility.ts), so the host token is the only
    // secret a room still holds - and these three surfaces are the ones that describe a room to
    // somebody, which makes them exactly where a leak would happen.
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "redaction-suite");
    const host = await connectHost(code, hostToken);
    host.send({ type: "update-room-settings", settings: { hideJoinCode: true } });
    await host.waitFor("room-settings", (message) => message.settings.hideJoinCode);

    const overRpc = await (await patchOverRpc(code, hostToken, { hideJoinCode: true })).text();
    const inspector = await (
      await roomStub(code).fetch("https://do/diagnostics", {
        headers: { [hostTokenHeader]: hostToken },
      })
    ).text();
    const broadcast = JSON.stringify(host.messagesOf("room-settings"));

    for (const surface of [overRpc, inspector, broadcast]) {
      // The host token is the room's strongest secret and belongs to no settings surface.
      expect(surface).not.toContain(hostToken);
      // Nor does any leftover hash material from the password era.
      expect(surface).not.toContain("saltHex");
      expect(surface).not.toContain("hashHex");
    }
    expect(JSON.parse(overRpc)).toMatchObject({ settings: { hideJoinCode: true } });
  });
});
