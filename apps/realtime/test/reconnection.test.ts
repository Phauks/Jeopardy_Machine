// The A5 promises, proven against the DO rather than asserted in a design doc (M6). Real
// phones at a real event sleep mid-clue, lose the venue Wi-Fi for eight seconds, and come back
// with a fresh socket; the host's laptop dies and the console reopens on somebody's iPad
// (user-flows C6). Each test here is one line of that list:
//
// - a phone that slept through an armed window resumes to the exact screen, and can still race
// - a reconnect around a press neither LOSES the buzz nor DUPLICATES it
// - a seat keeps its team, its score and its identity across the gap
// - the final round never blocks on an absent phone (missing wager = the minimum at the deadline)
// - a host console reconnecting mid-clue recovers everything it needs to keep hosting
/* oxlint-disable no-await-in-loop */
import { describe, expect, it } from "vitest";
import {
  compactGame,
  compactGameWith,
  connectBot,
  connectHost,
  initializeRoom,
  racerBot,
  uniqueCode,
} from "./helpers.ts";
import type { Bot } from "@jeopardy/bots/bot";
import type { GameState } from "@jeopardy/engine/state";

const teamGame = compactGameWith({
  teams: { playerMode: "teams", teamBuzzer: "any-member" },
});

const finalGame = compactGameWith({}, { hasFinalClue: true });

async function resumeAs(code: string, bot: Bot, nickname: string): Promise<Bot> {
  const token = bot.sessionToken;
  if (token === null) throw new Error("bot has no session token");
  const revived = await connectBot(code, { ...racerBot(nickname, 0), sessionToken: token });
  await revived.waitFor((message) => message.type === "snapshot");
  return revived;
}

describe("a phone that sleeps mid-clue", () => {
  it("resumes to the exact screen - phase, clue, timers - and can still race", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "resume-mid-clue");
    const host = await connectHost(code, hostToken);
    const sleeper = await connectBot(code, {
      ...racerBot("Sleeper", 0, { buzzProbability: 0 }),
    });
    await connectBot(code, racerBot("Awake", 0, { buzzProbability: 0 }));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    // The screen goes dark mid-armed-window and comes back on a new socket.
    sleeper.close();
    const revived = await resumeAs(code, sleeper, "Sleeper");
    const snapshot = revived.received.find((message) => message.type === "snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("no snapshot on resume");
    expect(revived.playerId).toBe(sleeper.playerId);
    expect((snapshot.game as GameState).phase).toBe("armed");
    // The countdown it missed: the room is waiting on the buzz window and says how long is
    // left, so the returning phone paints a live bar instead of a still one.
    expect(snapshot.timers.map((timer) => timer.kind)).toContain("buzz-window");
    expect(snapshot.timers[0]?.remainingMs).toBeGreaterThan(0);
    // ...and the arming it missed, so it can ack (be measured) and stamp a buzz.
    await revived.waitFor((message) => message.type === "arm-window");
    expect(revived.arm).not.toBeNull();

    revived.buzz();
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(won.playerId).toBe(sleeper.playerId);
  }, 20_000);
});

describe("a reconnect around the press itself", () => {
  it("does not lose a buzz whose phone vanished before the room adjudicated it", async () => {
    // The nastiest ordering M6 introduced: the press is in the holding pen when the socket
    // dies. The seat pressed; the seat must win. (Before the window existed this could not
    // happen, which is exactly why it needs a test now.)
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "resume-press-lost");
    const host = await connectHost(code, hostToken);
    const dropper = await connectBot(code, racerBot("Dropper", 0, { buzzProbability: 0 }));
    await connectBot(code, racerBot("Steady", 0, { buzzProbability: 0 }));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    dropper.buzz();
    dropper.close(); // gone before the compensation window closes
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(won.playerId).toBe(dropper.playerId);

    // And the seat survives to answer for it: the host judges, the score lands on the seat.
    host.sendAction({ type: "judge", verdict: "correct" });
    await host.takeEvent("judged");
    host.send({ type: "sync" });
    const snapshot = await host.waitFor("snapshot", (message) => message.stateVersion > 0);
    expect((snapshot.game as GameState).scores[dropper.playerId ?? ""]).toBeGreaterThan(0);
  }, 20_000);

  it("does not duplicate a buzz when the same seat presses from two sockets", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "resume-press-double");
    const host = await connectHost(code, hostToken);
    const flaky = await connectBot(code, racerBot("Flaky", 0, { buzzProbability: 0 }));
    await connectBot(code, racerBot("Steady", 0, { buzzProbability: 0 }));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    flaky.buzz();
    const revived = await resumeAs(code, flaky, "Flaky");
    revived.buzz(); // the human, unsure it registered, presses again on the new socket
    await host.waitFor("buzz-won", undefined, 8000);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // One arming, one winner, one sound - whatever the sockets did (the audio contract).
    expect(host.messagesOf("buzz-won").length).toBe(1);
    expect(host.messagesOf("buzz-won")[0]?.playerId).toBe(flaky.playerId);
  }, 20_000);
});

describe("a player who drops and returns", () => {
  it("keeps the seat, the team and the score", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, teamGame, "resume-team-seat");
    const host = await connectHost(code, hostToken);
    const ada = await connectBot(code, {
      ...racerBot("Ada", 0, { buzzProbability: 0 }),
      team: { kind: "create", name: "Sequoias" },
    });
    await connectBot(code, {
      ...racerBot("Bea", 0, { buzzProbability: 0 }),
      team: { kind: "create", name: "Otters" },
    });
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    ada.buzz();
    await host.waitFor("buzz-won", undefined, 8000);
    host.sendAction({ type: "judge", verdict: "correct" });
    await host.takeEvent("judged");

    const teamId = ada.entityId;
    ada.close();
    await host.waitFor("roster", (message) =>
      message.roster.players.some((entry) => entry.playerId === ada.playerId && !entry.connected),
    );
    const revived = await resumeAs(code, ada, "Ada");
    expect(revived.playerId).toBe(ada.playerId);
    expect(revived.entityId).toBe(teamId);

    const snapshot = revived.received.find((message) => message.type === "snapshot");
    if (snapshot?.type !== "snapshot") throw new Error("no snapshot");
    const game = snapshot.game as GameState;
    expect(game.scores[teamId ?? ""]).toBeGreaterThan(0);
    const seat = snapshot.roster.players.find((entry) => entry.playerId === ada.playerId);
    expect(seat?.teamId).toBe(teamId);
    expect(seat?.identity.nickname).toBe("Ada");
    expect(seat?.connected).toBe(true);
  }, 20_000);
});

describe("the final round never blocks on an absent phone", () => {
  it("commits the minimum wager for a phone that is gone, at the deadline", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, finalGame, "resume-final-absent");
    const host = await connectHost(code, hostToken);
    // Both press by hand, one clue each, so BOTH reach the final with a positive score - the
    // scenario needs an absent phone that is genuinely eligible, not one that sat out.
    const present = await connectBot(code, racerBot("Present", 0, { buzzProbability: 0 }));
    const absent = await connectBot(code, racerBot("Absent", 0, { buzzProbability: 0 }));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");

    // Two cells, one win each, so both seats reach the final with a positive score.
    for (const [category, winner] of [
      [0, present],
      [1, absent],
    ] as const) {
      host.sendAction({ type: "select-cell", category, row: 0 });
      await host.takeEvent("clue-presented");
      host.sendAction({ type: "arm-buzzers" });
      await host.takeEvent("buzzers-armed");
      winner.buzz();
      await host.waitFor("buzz-won", (message) => message.playerId === winner.playerId, 8000);
      host.sendAction({ type: "judge", verdict: "correct" });
      await host.takeEvent("judged");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // Straight to the final: the host ends the round with cells still on the board, which is
    // the ordinary "we are running late" move at a real event.
    host.sendAction({ type: "end-round" });
    await host.takeEvent("round-ended");
    await host.takeEvent("round-break");
    // The phone dies during the break, before the wager screen ever reaches it. Its SEAT is
    // still eligible (it has a positive score and nobody left the room), which is exactly the
    // situation that must not stall a room full of people.
    absent.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    host.sendAction({ type: "proceed" });
    const wagersOpen = await host.takeEvent("final-wagers-open");
    expect(wagersOpen.ranges.length).toBe(2);

    // The room must not wait for it: the host reaches the deadline early with "skip the
    // wait", which fires the very final-wager-timeout action the alarm book owes when the
    // 30-second timer runs out on its own.
    await new Promise((resolve) => setTimeout(resolve, 200));
    host.send({ type: "expire-timer" });
    // The round moves on without it, and the missing wager was filled in rather than waited on.
    await host.takeEvent("final-writing-open");
    const committed = host.engineEvents.filter((event) => event.type === "final-wager-committed");
    expect(committed.length).toBe(2);
    expect(committed.filter((event) => event.forced).length).toBe(1);
  }, 30_000);
});

describe("host resume from DO state (C6)", () => {
  it("recovers the phase, the clue, the answer, the roster and the countdown", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "resume-host");
    const firstConsole = await connectHost(code, hostToken);
    const bot = await connectBot(code, racerBot("Ada", 0, { buzzProbability: 0 }));
    await firstConsole.waitFor("roster", (message) => message.roster.players.length === 1);
    firstConsole.sendAction({ type: "start-game" });
    await firstConsole.takeEvent("round-started");
    firstConsole.sendAction({ type: "select-cell", category: 0, row: 0 });
    await firstConsole.takeEvent("clue-presented");
    firstConsole.sendAction({ type: "arm-buzzers" });
    bot.buzz();
    await firstConsole.waitFor("buzz-won", undefined, 8000);

    // The laptop dies mid-answer. A new console opens with the same token.
    firstConsole.socket.close(1001, "laptop died");
    const secondConsole = await connectHost(code, hostToken);
    const snapshot = secondConsole.messagesOf("snapshot").at(-1);
    if (snapshot === undefined) throw new Error("no snapshot for the new console");
    const game = snapshot.game as GameState;
    expect(snapshot.phase).toBe("active");
    expect(game.phase).toBe("answering");
    expect(game.clue?.buzzWinner?.playerId).toBe(bot.playerId);
    expect(snapshot.roster.players.length).toBe(1);
    expect(snapshot.paused).toBe(false);
    // The answer clock the previous console was watching, with the time it has left - and NOT
    // the stale buzz-window entry the alarm book still carries for the press that opened it.
    expect(snapshot.timers.map((timer) => timer.kind)).toEqual(["answer-window"]);
    expect(snapshot.timers[0]?.remainingMs).toBeGreaterThan(0);

    // And it can host: judging from the new console moves the game.
    secondConsole.sendAction({ type: "judge", verdict: "correct" });
    const judged = await secondConsole.takeEvent("judged");
    expect(judged.verdict).toBe("correct");
    expect(judged.delta).toBeGreaterThan(0);
  }, 20_000);

  it("hands a reconnecting console the room settings and a paused room's freeze", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "resume-host-paused");
    const firstConsole = await connectHost(code, hostToken);
    await connectBot(code, racerBot("Ada", 0, { buzzProbability: 0 }));
    await firstConsole.waitFor("roster", (message) => message.roster.players.length === 1);
    firstConsole.sendAction({ type: "start-game" });
    await firstConsole.takeEvent("round-started");
    firstConsole.sendAction({ type: "select-cell", category: 0, row: 0 });
    await firstConsole.takeEvent("clue-presented");
    firstConsole.send({ type: "set-pause", paused: true });
    await firstConsole.waitFor("paused");
    firstConsole.socket.close(1001, "laptop died");

    const secondConsole = await connectHost(code, hostToken);
    const snapshot = secondConsole.messagesOf("snapshot").at(-1);
    expect(snapshot?.paused).toBe(true);
    // The room's own settings reach the new console unasked, so it can paint its controls
    // (streamer mode, caps, the entry door) without a round trip.
    const settings = await secondConsole.waitFor("room-settings");
    expect(settings.settings.maxPlayers).toBeGreaterThan(0);
    secondConsole.send({ type: "set-pause", paused: false });
    await secondConsole.waitFor("paused", (message) => !message.paused);
  }, 20_000);
});
