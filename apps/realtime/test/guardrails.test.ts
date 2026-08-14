// Wire-level guardrails: role authority on relayed actions, the armed-window identity
// lock, rename rate limits, frame size/rate/version refusals. These are the protections a
// room full of strangers' phones leans on.
import { describe, expect, it } from "vitest";
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { limits } from "@jeopardy/protocol/limits";
import {
  compactGame,
  connectBot,
  connectHost,
  initializeRoom,
  instantBot,
  TestClient,
  uniqueCode,
  upgradeToRoom,
} from "./helpers.ts";

describe("action authority on the wire", () => {
  it("refuses host-only actions from players and player-only actions from the host", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "authority-seed");
    const host = await connectHost(code, hostToken);
    const bot = await connectBot(code, instantBot("Player"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");

    bot.sendAction({ type: "judge", verdict: "correct" });
    const denied = await bot.waitFor((message) => message.type === "error");
    expect(denied).toMatchObject({ reason: "unauthorized" });

    host.sendAction({ type: "buzz" }); // hosts cannot buzz - there is no host seat to win
    const hostDenied = await host.waitFor("error");
    expect(hostDenied.reason).toBe("unauthorized");

    bot.sendAction({ type: "player-join", playerId: "p-999", name: "Forged" });
    const forged = await bot.waitFor((message) => message.type === "error" && message !== denied);
    expect(forged).toMatchObject({ reason: "unauthorized" });
  });

  it("stamps identity from the session: a buzz cannot impersonate another seat", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "stamp-seed");
    const host = await connectHost(code, hostToken);
    const honest = await connectBot(code, {
      ...instantBot("Honest"),
      behavior: { buzzProbability: 0 },
    });
    const forger = await connectBot(code, {
      ...instantBot("Forger"),
      behavior: { buzzProbability: 0 },
    });
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    // The forger claims the honest seat's playerId; the server overwrites it with the
    // sender's own seat before the engine ever sees the action.
    forger.sendAction({ type: "buzz", playerId: honest.playerId });
    const won = await host.waitFor("buzz-won");
    expect(won.playerId).toBe(forger.playerId);
  });
});

describe("identity guardrails", () => {
  it("locks identity edits during the armed window and rate-limits nickname bursts", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "identity-seed");
    const host = await connectHost(code, hostToken);
    const bot = await connectBot(code, {
      ...instantBot("Shifty"),
      behavior: { buzzProbability: 0 },
    });
    await host.waitFor("roster", (message) => message.roster.players.length === 1);

    // Lobby renames are fine - up to the burst.
    for (let attempt = 0; attempt < limits.player.renameBurstMax; attempt += 1) {
      bot.sendMessage({ type: "identity-update", nickname: `Shifty ${String(attempt)}` });
    }
    bot.sendMessage({ type: "identity-update", nickname: "Shifty Final" });
    const limited = await bot.waitFor((message) => message.type === "error");
    expect(limited).toMatchObject({ reason: "rate-limited" });

    // Avatar swaps are NOT metered (the limit targets name confusion, not fun).
    bot.sendMessage({ type: "identity-update", avatarId: "cube-pets/otter" });
    await host.waitFor("roster", (message) =>
      message.roster.players.some((entry) => entry.identity.avatarId === "cube-pets/otter"),
    );

    // Armed window: edits freeze so the display never relabels mid-adjudication.
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");
    bot.sendMessage({ type: "identity-update", avatarId: "cube-pets/fox" });
    const frozen = await bot.waitFor((message) => message.type === "error" && message !== limited);
    expect(frozen).toMatchObject({ reason: "identity-locked" });
  });

  it("lets the host rename and kick anyone; the kicked player's token dies with the seat", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "kick-seed");
    const host = await connectHost(code, hostToken);
    const bot = await connectBot(code, instantBot("Troublemaker"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    const token = bot.sessionToken;
    if (token === null) throw new Error("no token");

    host.send({ type: "rename-player", playerId: bot.playerId ?? "", nickname: "Renamed" });
    await host.waitFor("roster", (message) =>
      message.roster.players.some((entry) => entry.identity.nickname === "Renamed"),
    );

    host.send({ type: "kick-player", playerId: bot.playerId ?? "" });
    await host.waitFor("roster", (message) => message.roster.players.length === 0);
    // "kicked", not "host-closed": the kicked phone shows a polite screen about itself while
    // the room plays on (reason vocabulary agreed with the M4 surfaces, 2026-08-14).
    const closed = await bot.waitFor((message) => message.type === "room-closed");
    expect(closed).toMatchObject({ reason: "kicked" });

    // The dead token cannot resume: the seat is gone, not just disconnected.
    const ghost = new TestClient(await upgradeToRoom(code));
    ghost.send({ type: "resume", sessionToken: token });
    const refused = await ghost.waitFor("refused");
    expect(refused.reason).toBe("bad-session-token");
  });
});

describe("frame-level refusals", () => {
  it("refuses oversized frames, version skew, malformed JSON, and message floods", async () => {
    const code = uniqueCode();
    await initializeRoom(code, compactGame, "frames-seed");
    const bot = await connectBot(code, {
      ...instantBot("Framey"),
      behavior: { buzzProbability: 0 },
    });

    bot.sendMessage({ type: "sync", ext: { "com.example.filler": "x".repeat(8 * 1024) } });
    const oversized = await bot.waitFor(
      (message) => message.type === "error" && message.detail === "message exceeds the size limit",
    );
    expect(oversized).toMatchObject({ reason: "malformed" });

    bot.sendMessage({ type: "sync", version: protocolVersion + 1 });
    const skew = await bot.waitFor(
      (message) => message.type === "error" && message.reason === "unsupported-version",
    );
    expect(skew.type).toBe("error");

    for (let flood = 0; flood < limits.wire.clientMessagesPerSecondMax + 5; flood += 1) {
      bot.sendMessage({ type: "sync" });
    }
    const drowned = await bot.waitFor(
      (message) => message.type === "error" && message.reason === "rate-limited",
    );
    expect(drowned.type).toBe("error");
  });
});
