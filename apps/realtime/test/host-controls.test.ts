// The room-level host controls and the clue-content channel added for the M4 surfaces
// (2026-08-14 reconcile): authored text on the wire, pause/resume, force-expire, the polite
// close/kick reasons, and the solo-team seating policy.
//
// The load-bearing assertions are the redaction ones: an answer that reaches a display or a
// phone is a game-ruining bug, and the only thing standing between them is room/content.ts.
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { clueContentFor, resolveCellContent } from "../src/room/content.ts";
import { authoredGame, bytelessAsset, firstCellText, pictureAsset } from "./authored-game.ts";
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

// Drive a room to an open clue: host + one player, start, select a cell.
async function roomWithOpenClue(cell: { category: number; row: number } = { category: 0, row: 0 }) {
  const code = uniqueCode();
  const { hostToken } = await initializeRoom(code, authoredGame, "content-suite");
  const host = await connectHost(code, hostToken);
  await connectBot(code, instantBot("Lorax"));
  await host.waitFor("roster", (message) => message.roster.players.length === 1);
  host.sendAction({ type: "start-game" });
  await host.takeEvent("game-started");
  host.sendAction({ type: "select-cell", ...cell });
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

  it("RESOLVES a clue's media, so a surface has something to paint", async () => {
    // The wire carried a bare `mediaId` until 2026-08-19, which told a client there was a
    // picture and gave it no kind, no type, no alt text and no bytes - every picture clue
    // rendered as words (owner report). The room owns the pack, so the room does the lookup.
    const { host } = await roomWithOpenClue({ category: 0, row: 1 });
    const media = (await host.waitFor("clue-content")).content.prompt?.media;
    expect(media).toMatchObject({
      mediaId: pictureAsset.id,
      kind: "image",
      mime: "image/webp",
      alt: pictureAsset.alt,
      url: "https://media.test/trees.webp",
    });
  });

  it("sends an asset with no fetchable bytes WITHOUT a url, keeping its alt text", async () => {
    // `pending-local` means the bytes never left the authoring device. The honest answer is a
    // descriptor with no url: the surface says what was meant to be here instead of showing a
    // broken frame, which is what alt text has always been for.
    const { host } = await roomWithOpenClue({ category: 0, row: 2 });
    const media = (await host.waitFor("clue-content")).content.prompt?.media;
    expect(media?.url).toBeUndefined();
    expect(media).toMatchObject({ kind: "audio", alt: bytelessAsset.alt });
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
    // The bot buzzes the instant it is armed, so the wait the room is on by now is the ANSWER
    // window rather than the buzz window. Waited on by its TIMER rather than by `buzz-won`:
    // that one is a per-connection message to the presser, not an engine event, so a host
    // waiting for it waits forever.
    await host.takeEvent("timer-set"); // buzz-window
    await host.takeEvent("timer-set"); // answer-window - the wait we are about to skip
    host.send({ type: "expire-timer" });

    // Exactly what the alarm would have done, just sooner - which since 2026-08-20 is to SAY
    // the time is up and nothing else. All scoring is manual, so a clock the host fired early
    // still cannot judge anybody (@jeopardy/protocol settings/groups/scoring.ts).
    const expired = await host.takeEvent("answer-time-expired");
    expect(expired).toBeDefined();
    expect(host.engineEvents.filter((event) => event.type === "judged")).toEqual([]);
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

  // The OTHER ending, added 2026-08-20 (owner: "there is no end game button for the host").
  // The pair is the point: one stops the game and leaves the room standing, the other stops
  // the room. Before this only the second existed, so "we are out of time" and "everyone has
  // gone home" had the same button - and taking it mid-game meant every screen went dark with
  // no scores on it.
  it("ends the GAME on the host's word, leaving the room and every phone alive", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Maya" });
    await phone.waitFor("welcome");
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");

    host.sendAction({ type: "end-game" });
    const over = await host.takeEvent("game-over");
    expect(over.note).toBe("ended-early");
    // The phone sees the same ending - it is a room-wide event, not a console readout.
    expect((await phone.takeEvent("game-over")).note).toBe("ended-early");
    // Nobody was disconnected, and the room is still there to be rejoined or closed properly.
    expect(host.messagesOf("room-closed")).toEqual([]);
    expect(phone.messagesOf("room-closed")).toEqual([]);
    const diagnostics = await roomStub(code).fetch("https://do/registry-snapshot");
    expect(diagnostics.status).toBe(200);
  });

  it("is host-only: a phone cannot end everybody's game", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Chancer" });
    await phone.waitFor("welcome");
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");

    phone.sendAction({ type: "end-game" });
    expect((await phone.waitFor("error")).reason).toBe("unauthorized");
    expect(phone.engineEvents.filter((event) => event.type === "game-over")).toEqual([]);
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
