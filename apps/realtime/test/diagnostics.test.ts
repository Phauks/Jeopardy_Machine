// The host-authenticated ops endpoints on a live DO (owner requests 2026-08-14: more
// information about the DO objects, and the ability to delete rooms).
//
// Two properties carry the weight here. AUTHORIZATION: the token is checked inside the DO,
// so "the request came through the binding" is never itself permission. REDACTION: the
// inspector is a diagnostic surface on a room that holds host tokens, session tokens, a
// every authored answer - the test that matters is the one that searches
// the serialized response for all four.
import { describe, expect, it } from "vitest";
import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
import { limits } from "@jeopardy/protocol/limits";
import { env } from "cloudflare:test";
import { authoredGame, firstCellText } from "./authored-game.ts";
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

function ask(code: string, hostToken: string | null): Promise<Response> {
  return roomStub(code).fetch("https://do/diagnostics", {
    headers: hostToken === null ? {} : { [hostTokenHeader]: hostToken },
  });
}

function close(code: string, hostToken: string | null): Promise<Response> {
  return roomStub(code).fetch("https://do/close", {
    method: "POST",
    headers: hostToken === null ? {} : { [hostTokenHeader]: hostToken },
  });
}

describe("the DO inspector", () => {
  it("reports lifecycle, timestamps, connection census, roster counts and state version", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Ada"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);

    const diagnostics = (await (await ask(code, hostToken)).json()) as RoomDiagnostics;
    expect(diagnostics).toMatchObject({
      code,
      lifecycle: "lobby",
      settings: { listing: "private" },
      paused: false,
    });
    expect(diagnostics.connections).toMatchObject({ total: 2, host: 1, player: 1 });
    expect(diagnostics.roster).toEqual({ players: 1, connected: 1, teams: 0 });
    // Derived, not stored: how long the room has left if nobody touches it again.
    expect(diagnostics.expiresAt).toBe(diagnostics.lastActivityAt + limits.room.idleExpiryMs);
    // The alarm book always holds at least the idle-expiry entry, and the runtime alarm is
    // its earliest member (apps/realtime/src/room/storage.ts).
    expect(diagnostics.alarm.entries.some((entry) => entry.source === "idle-expiry")).toBe(true);
    expect(diagnostics.alarm.nextWakeAt).toBe(diagnostics.alarm.entries[0]?.dueAt);
    // Storage sizes are for spotting the key that grows - "state" carries the action log.
    expect(diagnostics.storage.keys.map((entry) => entry.key)).toContain("state");
    expect(diagnostics.storage.totalBytes).toBeGreaterThan(0);
  });

  it("follows the game: phase, state version and the engine timer in the alarm book", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Maya"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");

    const diagnostics = (await (await ask(code, hostToken)).json()) as RoomDiagnostics;
    expect(diagnostics.lifecycle).toBe("active");
    expect(diagnostics.stateVersion).toBeGreaterThan(0);
  });

  it("leaks NOTHING: no host token, no session token, no authored answer", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, authoredGame, "diagnostics-suite", {
      listing: "public",
      title: "Inspector suite",
    });
    const host = await connectHost(code, hostToken);
    // A raw client rather than a bot, so the roster carries a real nickname the inspector
    // must not echo back.
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Lorax" });
    const welcome = await phone.waitFor("welcome");
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");

    const raw = await (await ask(code, hostToken)).text();
    for (const secret of [hostToken, firstCellText.answer, firstCellText.prompt]) {
      expect(raw).not.toContain(secret);
    }
    // Session tokens never appear either - the roster is counted, never listed.
    expect(raw).not.toContain(welcome.sessionToken ?? "impossible-sentinel");
    expect(raw).not.toContain("nickname");
    expect(raw).not.toContain("Lorax");
    // ...while the facts an operator needs are all there.
    const diagnostics = JSON.parse(raw) as RoomDiagnostics;
    expect(diagnostics.settings.listing).toBe("public");
    expect(diagnostics.settings.title).toBe("Inspector suite");
  });

  it("is host-only: no token, a wrong token, and an uncreated room all refuse", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    expect((await ask(code, null)).status).toBe(403);
    expect((await ask(code, "0".repeat(32))).status).toBe(403);
    expect((await ask(code, "")).status).toBe(403);
    expect((await ask(uniqueCode(), hostToken)).status).toBe(404);
    expect((await ask(code, hostToken)).status).toBe(200);
  });
});

describe("closing a room over the ops endpoint", () => {
  it("gives everyone the polite screen and delists the room", async () => {
    const code = uniqueCode();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO rooms (code, title, host_label, listing, phase, player_count,
         player_cap, created_at, last_seen_at, expires_at, ended_at)
       VALUES (?, 'Closing suite', '', 'public', 'lobby', 0, ?, ?, ?, ?, NULL)`,
    )
      .bind(code, limits.room.playerSoftCap, now, now, now + limits.room.idleExpiryMs)
      .run();
    const { hostToken } = await initializeRoom(code, undefined, "close-suite", {
      listing: "public",
      title: "Closing suite",
    });
    const host = await connectHost(code, hostToken);

    const response = await close(code, hostToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ closed: true, code });
    expect((await host.waitFor("room-closed")).reason).toBe("host-closed");

    const row = await env.DB.prepare(`SELECT phase, ended_at FROM rooms WHERE code = ?`)
      .bind(code)
      .first<{ phase: string; ended_at: number | null }>();
    expect(row?.phase).toBe("ended");
    expect(row?.ended_at).not.toBeNull();
    // The room reports itself ended afterwards - the code stays spent until the expiry alarm.
    const after = (await (await ask(code, hostToken)).json()) as RoomDiagnostics;
    expect(after.lifecycle).toBe("ended");
  });

  it("refuses an unauthorized close and leaves the room running", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    expect((await close(code, null)).status).toBe(403);
    expect((await close(code, "1".repeat(32))).status).toBe(403);
    expect((await close(uniqueCode(), hostToken)).status).toBe(404);
    // Still live: the socket never got a room-closed, and the room still answers.
    expect(host.messagesOf("room-closed")).toHaveLength(0);
    expect(((await (await ask(code, hostToken)).json()) as RoomDiagnostics).lifecycle).toBe(
      "lobby",
    );
  });
});
