// Room controls on a LIVE room, inside workerd (docs/decisions/2026-08-14-room-controls-and-
// staging.md): the two participant budgets, the spectator switch, streamer mode, the password
// that can change mid-night, and the broadcast that makes all of it visible immediately.
//
// The properties under test are the ones that make the feature trustworthy rather than the
// ones that make it work:
//
// - the two budgets are INDEPENDENT and refuse with DIFFERENT reasons (an audience must never
//   be able to fill the room the players came to play in);
// - every change reaches every connection as one `room-settings` message, because a join code
//   that just became hidden must vanish from the projector at once;
// - changing the password never disconnects anyone already inside - it is the door, not a
//   session - while the old secret stops working for the next person immediately;
// - both doors (the host-only client message and the /settings RPC) land in the same place.
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
      `INSERT INTO rooms (code, title, host_label, listing, has_password, phase, player_count,
         player_cap, created_at, last_seen_at, expires_at, ended_at)
       VALUES (?, 'Settings suite', '', 'public', 0, 'lobby', 0, ?, ?, ?, ?, NULL)`,
    )
      .bind(code, limits.room.playerSoftCap, now, now, now + limits.room.idleExpiryMs)
      .run();
    const { hostToken } = await initializeRoom(code, undefined, "settings-suite", {
      listing: "public",
      title: "Settings suite",
    });

    await patchOverRpc(code, hostToken, { listing: "private", maxPlayers: 12 });
    const row = await env.DB.prepare(
      `SELECT listing, player_cap, has_password FROM rooms WHERE code = ?`,
    )
      .bind(code)
      .first<{ listing: string; player_cap: number; has_password: number }>();
    expect(row).toMatchObject({ listing: "private", player_cap: 12, has_password: 0 });

    // Setting a password shows up as the lock the lobby renders - and never as the secret.
    await patchOverRpc(code, hostToken, { password: "sequoia-2026" });
    const locked = await env.DB.prepare(`SELECT * FROM rooms WHERE code = ?`)
      .bind(code)
      .first<Record<string, unknown>>();
    expect(locked?.["has_password"]).toBe(1);
    expect(JSON.stringify(locked)).not.toContain("sequoia-2026");
  });
});

describe("changing the room password mid-night", () => {
  it("locks an open room, keeps everyone already inside, and admits only the new secret", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const early = new TestClient(await upgradeToRoom(code));
    early.send({ type: "join", role: "player", nickname: "Early" });
    await early.waitFor("welcome");

    host.send({ type: "update-room-settings", settings: { password: "sequoia-2026" } });
    const announced = await early.waitFor(
      "room-settings",
      (message) => message.settings.entry === "password",
    );
    // The broadcast says a password EXISTS; it can never say what it is.
    expect(JSON.stringify(announced)).not.toContain("sequoia-2026");

    // The connection that was already inside is untouched: no close, no re-authentication.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(early.closes).toHaveLength(0);
    early.send({ type: "sync" });
    expect((await early.waitFor("snapshot")).roster.players).toHaveLength(1);

    // The next phone must present the new secret.
    const stranger = new TestClient(await upgradeToRoom(code));
    stranger.send({ type: "join", role: "player", nickname: "Stranger" });
    expect((await stranger.waitFor("refused")).reason).toBe("password-required");
    stranger.send({
      type: "join",
      role: "player",
      nickname: "Stranger",
      password: "sequoia-2026",
    });
    expect((await stranger.waitFor("welcome")).role).toBe("player");
  });

  it("replaces one secret with another: the old one stops working the moment it changes", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "password-change", {
      password: "first-secret",
    });
    await patchOverRpc(code, hostToken, { password: "second-secret" });

    const stale = new TestClient(await upgradeToRoom(code));
    stale.send({ type: "join", role: "player", nickname: "Stale", password: "first-secret" });
    expect((await stale.waitFor("refused")).reason).toBe("bad-password");

    const current = new TestClient(await upgradeToRoom(code));
    current.send({
      type: "join",
      role: "player",
      nickname: "Current",
      password: "second-secret",
    });
    expect((await current.waitFor("welcome")).role).toBe("player");
  });

  it("clears the secret entirely, turning the room back into an open one", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "password-clear", {
      password: "temporary",
    });
    const cleared = await patchOverRpc(code, hostToken, { password: null });
    expect(cleared.status).toBe(200);
    expect((await settingsOf(code, hostToken)).entry).toBe("open");

    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Walkin" });
    expect((await phone.waitFor("welcome")).role).toBe("player");
  });
});
