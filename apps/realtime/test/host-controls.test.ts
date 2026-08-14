// The room-level host controls and the clue-content channel added for the M4 surfaces
// (2026-08-14 reconcile): authored text on the wire, pause/resume, force-expire, the polite
// close/kick reasons, and the solo-team seating policy.
//
// The load-bearing assertions are the redaction ones: an answer that reaches a display or a
// phone is a game-ruining bug, and the only thing standing between them is room/content.ts.
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { clueContentFor, resolveCellContent } from "../src/room/content.ts";
import { authoredGame, firstCellText } from "./authored-game.ts";
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
import type { CreateRoomRequestInput } from "@jeopardy/protocol/room/create";

// Drive a room to an open clue: host + one player, start, select the first cell.
async function roomWithOpenClue() {
  const code = uniqueCode();
  const { hostToken } = await initializeRoom(code, authoredGame, "content-suite");
  const host = await connectHost(code, hostToken);
  await connectBot(code, instantBot("Lorax"));
  await host.waitFor("roster", (message) => message.roster.players.length === 1);
  host.sendAction({ type: "start-game" });
  await host.takeEvent("game-started");
  host.sendAction({ type: "select-cell", category: 0, row: 0 });
  await host.takeEvent("clue-presented");
  return { code, hostToken, host };
}

describe("clue content on the wire", () => {
  it("gives the host the prompt AND the answer", async () => {
    const { host } = await roomWithOpenClue();
    const content = (await host.waitFor("clue-content")).content;
    expect(content.prompt?.text).toBe(firstCellText.prompt);
    expect(content.answer?.canonical).toBe(firstCellText.answer);
    expect(content.target).toMatchObject({ kind: "cell", roundIndex: 0, category: 0, row: 0 });
    expect(content.category.length).toBeGreaterThan(0);
    expect(content.prompt?.text.length).toBeGreaterThan(0);
    expect(content.answer?.canonical.length).toBeGreaterThan(0);
  });

  it("gives a display the prompt and NEVER the answer", async () => {
    const { code } = await roomWithOpenClue();
    const display = new TestClient(await upgradeToRoom(code));
    display.send({ type: "join", role: "display" });
    const snapshot = await display.waitFor("snapshot");
    expect(snapshot.clueContent?.prompt?.text.length).toBeGreaterThan(0);
    expect(snapshot.clueContent?.answer).toBeNull();
    // Belt and braces: the authored answer text appears nowhere in what the display received.
    expect(JSON.stringify(display.received)).not.toContain(firstCellText.answer);
    expect(snapshot.clueContent?.category).toBe(firstCellText.category);
  });

  it("keeps the prompt off phones unless the room turned clue-text-on-phones on", () => {
    const resolved = resolveCellContent(authoredGame, { roundIndex: 0, category: 0, row: 0 });
    if (resolved === null) throw new Error("the authored fixture has no first cell");
    expect(clueContentFor("player", resolved, { clueTextOnPhones: false }).prompt).toBeNull();
    expect(clueContentFor("player", resolved, { clueTextOnPhones: true }).prompt).not.toBeNull();
    // No setting ever opens the answer to a player, a display, or a spectator.
    for (const role of ["player", "display", "spectator"] as const) {
      expect(clueContentFor(role, resolved, { clueTextOnPhones: true }).answer).toBeNull();
    }
  });

  it("answers null for a board-only room (the compact spec bots and tests use)", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Ada"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");
    host.send({ type: "sync" });
    const snapshot = await host.waitFor("snapshot", (message) => message.game !== null);
    expect(snapshot.clueContent).toBeNull();
  });
});

describe("pause and resume", () => {
  it("freezes running timers and hands back the time they had left", async () => {
    const { code, host } = await roomWithOpenClue();
    host.send({ type: "set-pause", paused: true });
    const paused = await host.waitFor("paused");
    expect(paused.paused).toBe(true);

    host.send({ type: "sync" });
    expect((await host.waitFor("snapshot", (message) => message.paused)).paused).toBe(true);

    // While paused the alarm fires no engine timer: the clue that was open stays open, even
    // though its buzz window has long since "passed" in wall-clock terms.
    const eventsBefore = host.engineEvents.length;
    await runDurableObjectAlarm(roomStub(code));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(host.engineEvents.length).toBe(eventsBefore);

    host.send({ type: "set-pause", paused: false });
    const resumed = await host.waitFor("paused", (message) => !message.paused);
    expect(resumed.paused).toBe(false);
    host.send({ type: "sync" });
    const snapshot = await host.waitFor("snapshot", (message) => !message.paused);
    expect(snapshot.paused).toBe(false);
  });

  it("is host-only", async () => {
    const code = uniqueCode();
    await initializeRoom(code);
    const spectator = new TestClient(await upgradeToRoom(code));
    spectator.send({ type: "join", role: "spectator" });
    await spectator.waitFor("welcome");
    spectator.send({ type: "set-pause", paused: true });
    expect((await spectator.waitFor("error")).reason).toBe("unauthorized");
  });
});

describe("forcing the pending timer", () => {
  it("lets the host skip the wait the room is currently on", async () => {
    const { host } = await roomWithOpenClue();
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");
    host.send({ type: "expire-timer" });
    // The buzz window closing is exactly what the alarm would have done, just sooner.
    const finished = await host.takeEvent("clue-finished");
    expect(finished).toBeDefined();
  });

  it("says so when the room is not waiting on anything, and refuses non-hosts", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    host.send({ type: "expire-timer" });
    expect((await host.waitFor("error")).reason).toBe("rejected");

    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Maya" });
    await phone.waitFor("welcome");
    phone.send({ type: "expire-timer" });
    expect((await phone.waitFor("error")).reason).toBe("unauthorized");
  });
});

describe("polite endings", () => {
  it("tells a kicked phone it was kicked, and leaves everyone else playing", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Nuisance" });
    await phone.waitFor("welcome");
    host.send({ type: "kick-player", playerId: "p-1" });
    const closed = await phone.waitFor("room-closed");
    expect(closed.reason).toBe("kicked");
    expect(host.messagesOf("room-closed")).toEqual([]);
  });

  it("closes the room for everyone when the host ends it", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Lorax" });
    await phone.waitFor("welcome");
    host.send({ type: "close-room" });
    expect((await phone.waitFor("room-closed")).reason).toBe("host-closed");
    expect((await host.waitFor("room-closed")).reason).toBe("host-closed");
  });
});

describe("teams-mode seating policy", () => {
  const teamsGame: CreateRoomRequestInput["game"] = {
    kind: "compact",
    rounds: [{ columns: 3, rows: 3 }],
    preset: "casual-party",
    overrides: { teams: { playerMode: "teams" }, wagers: { countRoundOne: 0, countRoundTwo: 0 } },
    hasFinalClue: false,
  };

  it("seats a player who never picked a team as a solo team of one", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, teamsGame, "seating-suite");
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Straggler"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);

    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");
    const roster = await host.waitFor(
      "roster",
      (message) => message.roster.players[0]?.teamId !== null,
    );
    const seated = roster.roster.players[0];
    expect(seated?.teamId).not.toBeNull();
    // The solo team wears the player's own name - readable on a scoreboard without a lookup.
    expect(roster.roster.teams.find((team) => team.teamId === seated?.teamId)?.name).toBe(
      "Straggler",
    );
  });
});
