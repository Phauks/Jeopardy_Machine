// Recovery is the architecture's core promise (user-flows A5/C6): the DO's storage is the
// game, so instance eviction mid-game must be invisible, and a phone that slept resumes its
// exact seat with a session token. The pool's evictDurableObject tears the instance down
// for real (in-memory caches gone, hibernatable sockets kept), so these tests prove the
// storage bundle - not object identity - carries the room.
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { roomCloseCodes } from "@jeopardy/protocol/room/server-messages";
import {
  compactGame,
  connectBot,
  connectHost,
  initializeRoom,
  instantBot,
  roomStub,
  TestClient,
  uniqueCode,
  upgradeToRoom,
} from "./helpers.ts";
import type { GameState } from "@jeopardy/engine/state";

describe("hibernation eviction mid-game", () => {
  it("survives eviction between clues: same sockets, same scores, play continues", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "eviction-seed");
    const host = await connectHost(code, hostToken);
    // Wide latency spread (0 vs 500ms): waking hibernated sockets adds delivery jitter,
    // and this test's claim is "the race still adjudicates deterministically after
    // eviction", not "wake jitter stays under 40ms".
    const alpha = await connectBot(code, instantBot("Alpha", 0));
    await connectBot(code, instantBot("Beta", 500));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);

    // Play one clue to completion so real state exists (scores, played cells, control).
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.waitFor("buzz-won");
    host.sendAction({ type: "judge", verdict: "correct" });
    const firstJudged = await host.takeEvent("judged");
    expect(firstJudged.verdict).toBe("correct");

    // Tear the instance down. Hibernatable sockets stay connected by default - exactly the
    // between-clues eviction hibernation exists for.
    await evictDurableObject(roomStub(code));

    // The same sockets keep working against a rebuilt instance: state came from storage.
    host.send({ type: "sync" });
    const snapshot = await host.waitFor(
      "snapshot",
      (message) => message.stateVersion >= 2 && message.phase === "active",
    );
    const game = snapshot.game as GameState;
    expect(game.phase).toBe("awaiting-selection");
    expect(game.scores[alpha.entityId ?? ""]).toBeGreaterThan(0);
    expect(game.boards[0]?.status[0]?.[0]).toBe("played");

    // And the next clue plays through the revived room, buzz race included.
    host.sendAction({ type: "select-cell", category: 1, row: 1 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    const buzz = await host.waitFor(
      "buzz-won",
      (message) => message.stateVersion > snapshot.stateVersion,
    );
    expect(buzz.playerId).toBe(alpha.playerId);
    host.sendAction({ type: "judge", verdict: "correct" });
    await host.takeEvent("judged");
  }, 20_000);
});

describe("session-token reconnect", () => {
  it("restores the exact seat and state on a fresh socket (phone slept, tab reopened)", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "resume-seed");
    const host = await connectHost(code, hostToken);
    const alpha = await connectBot(code, instantBot("Alpha", 0));
    await connectBot(code, instantBot("Beta", 40));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    const token = alpha.sessionToken;
    if (token === null) throw new Error("bot has no session token");

    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.waitFor("buzz-won");
    host.sendAction({ type: "judge", verdict: "correct" });
    await host.takeEvent("judged");

    // The phone dies mid-game; the roster marks it away but the game never blocks on it.
    alpha.close();
    const away = await host.waitFor("roster", (message) =>
      message.roster.players.some((entry) => entry.playerId === alpha.playerId && !entry.connected),
    );
    expect(away.roster.players.length).toBe(2); // seat kept, presence flipped

    // Same token, new socket: the resume path (user-flows A5) - same playerId, same score,
    // full snapshot of the current phase.
    const revived = await connectBot(code, {
      ...instantBot("Alpha", 0),
      sessionToken: token,
    });
    expect(revived.playerId).toBe(alpha.playerId);
    const snapshot = await revived.waitFor((message) => message.type === "snapshot");
    if (snapshot.type !== "snapshot") throw new Error("no snapshot on resume");
    const game = snapshot.game as GameState;
    expect(game.scores[alpha.entityId ?? ""]).toBeGreaterThan(0);
    expect(snapshot.phase).toBe("active");

    // The revived seat still buzzes as itself.
    host.sendAction({ type: "select-cell", category: 1, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    const buzz = await host.waitFor("buzz-won", (message) => message.playerId === alpha.playerId);
    expect(buzz.playerId).toBe(revived.playerId);
  }, 20_000);

  it("refuses an unknown session token with close 4401", async () => {
    const code = uniqueCode();
    await initializeRoom(code);
    const client = new TestClient(await upgradeToRoom(code));
    client.send({ type: "resume", sessionToken: "c".repeat(32) });
    const refused = await client.waitFor("refused");
    expect(refused.reason).toBe("bad-session-token");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.closes[0]?.code).toBe(roomCloseCodes.badToken);
  });

  it("keeps a player's snapshot free of hidden wager cells and rng state (redaction)", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(
      code,
      {
        kind: "compact",
        rounds: [{ columns: 3, rows: 3, wagerPlacement: "manual", authoredWagers: [[2, 2]] }],
        preset: "casual-party",
        overrides: {},
        hasFinalClue: false,
      },
      "redaction-seed",
    );
    const host = await connectHost(code, hostToken);
    const bot = await connectBot(code, instantBot("Alpha", 0));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");

    host.send({ type: "sync" });
    const hostSnapshot = await host.waitFor("snapshot", (message) => message.phase === "active");
    const hostGame = hostSnapshot.game as GameState;
    expect(hostGame.boards[0]?.wagerCells).toEqual(["2:2"]); // the host console sees the DD

    bot.sendMessage({ type: "sync" });
    const botSnapshot = await bot.waitFor(
      (message) => message.type === "snapshot" && message.phase === "active",
    );
    if (botSnapshot.type !== "snapshot") throw new Error("unreachable");
    const botGame = botSnapshot.game as GameState;
    expect(botGame.boards[0]?.wagerCells).toEqual([]); // phones never learn DD locations
    expect(botGame.rngState).toBe(0);
    expect(botGame.actionLog).toEqual([]);
  });
});
