// The locked adjudication core observed on the wire (boundary 2.1): server ARRIVAL order
// decides the buzz race, exactly one buzz-won message per arming reaches the room (the
// only-winner-heard audio contract), and every loser gets private buzz-rejected feedback.
import { describe, expect, it } from "vitest";
import {
  compactGame,
  connectBot,
  connectHost,
  initializeRoom,
  instantBot,
  uniqueCode,
} from "./helpers.ts";
import type { Bot } from "@jeopardy/bots/bot";

async function armedRoom(playerCount: number, seed: string) {
  const code = uniqueCode();
  const { hostToken } = await initializeRoom(code, compactGame, seed);
  const host = await connectHost(code, hostToken);
  const bots: Bot[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    // Sequential joins: deterministic seat numbers (p-1..p-N) for exact assertions.
    // oxlint-disable-next-line no-await-in-loop
    const bot = await connectBot(code, {
      ...instantBot(`Racer ${String(index + 1)}`),
      // The test fires buzzes by hand for exact arrival control.
      behavior: { buzzProbability: 0 },
    });
    bots.push(bot);
  }
  await host.waitFor("roster", (message) => message.roster.players.length === playerCount);
  host.sendAction({ type: "start-game" });
  await host.takeEvent("round-started");
  host.sendAction({ type: "select-cell", category: 0, row: 0 });
  await host.takeEvent("clue-presented");
  host.sendAction({ type: "arm-buzzers" });
  await host.takeEvent("buzzers-armed");
  return { host, bots };
}

describe("deterministic buzz ordering", () => {
  it("emits exactly one buzz-won for five concurrent buzzes; all losers get buzz-rejected", async () => {
    const { host, bots } = await armedRoom(5, "race-concurrent");
    // Fire all five without yielding between sends - as concurrent as one isolate can make
    // them; the DO serializes arrivals into one adjudication order.
    for (const bot of bots) bot.sendAction({ type: "buzz" });

    const won = await host.waitFor("buzz-won");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(host.messagesOf("buzz-won").length).toBe(1);

    const losers = bots.filter((bot) => bot.playerId !== won.playerId);
    expect(losers.length).toBe(4);
    for (const loser of losers) {
      const rejection = loser.received.find((message) => message.type === "buzz-rejected");
      expect(rejection, `${loser.nickname} got no rejection`).toBeDefined();
      if (rejection?.type === "buzz-rejected") expect(rejection.reason).toBe("too-late");
    }
    // The winner heard no rejection - and the rejections were private (never broadcast).
    const winner = bots.find((bot) => bot.playerId === won.playerId);
    expect(winner?.received.some((message) => message.type === "buzz-rejected")).toBe(false);
    expect(host.received.some((message) => message.type === "buzz-rejected")).toBe(false);
  });

  it("awards the race by arrival order: a controlled stagger always crowns the first sender", async () => {
    const { host, bots } = await armedRoom(3, "race-staggered");
    const [first, second, third] = bots;
    if (first === undefined || second === undefined || third === undefined) throw new Error("bots");
    // Third seat buzzes first this time - seat number must NOT matter, arrival must.
    third.sendAction({ type: "buzz" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    first.sendAction({ type: "buzz" });
    second.sendAction({ type: "buzz" });

    const won = await host.waitFor("buzz-won");
    expect(won.playerId).toBe(third.playerId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(host.messagesOf("buzz-won").length).toBe(1);
  });

  it("re-arms after a wrong answer and produces a second, sequential buzz-won (rebound)", async () => {
    const { host, bots } = await armedRoom(3, "race-rebound");
    const [first, second] = bots;
    if (first === undefined || second === undefined) throw new Error("bots");
    first.sendAction({ type: "buzz" });
    const firstWin = await host.waitFor("buzz-won");
    expect(firstWin.playerId).toBe(first.playerId);

    // Wrong: the winner's entity is locked out and buzzers re-arm for the rest.
    host.sendAction({ type: "judge", verdict: "wrong" });
    await host.takeEvent("rebound-armed");

    first.sendAction({ type: "buzz" }); // locked out - must not win again
    second.sendAction({ type: "buzz" });
    const secondWin = await host.waitFor(
      "buzz-won",
      (message) => message.stateVersion > firstWin.stateVersion,
    );
    expect(secondWin.playerId).toBe(second.playerId);
    expect(host.messagesOf("buzz-won").length).toBe(2); // one per arming, sequential

    const lockedOut = first.received.filter((message) => message.type === "buzz-rejected");
    expect(
      lockedOut.some(
        (message) => message.type === "buzz-rejected" && message.reason === "locked-out",
      ),
    ).toBe(true);
  });

  it("penalizes an early buzz with private lockout feedback and no room broadcast", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "race-early");
    const host = await connectHost(code, hostToken);
    const eager = await connectBot(code, {
      ...instantBot("Eager"),
      behavior: { buzzProbability: 0 },
    });
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");

    // Buzzing during "reading" (before arm) - the early-buzz penalty (#12).
    eager.sendAction({ type: "buzz" });
    const rejection = await eager.waitFor((message) => message.type === "buzz-rejected");
    if (rejection.type !== "buzz-rejected") throw new Error("unreachable");
    expect(rejection.reason).toBe("early-lockout");
    expect(rejection.lockedUntil).toBeGreaterThan(0);
    expect(host.messagesOf("buzz-won").length).toBe(0);
  });
});
