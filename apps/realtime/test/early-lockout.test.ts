// Rules-matrix #12 through the REAL path, phone to engine and back (M6). The engine's own
// suite proves the state machine (packages/engine/src/buzzing.test.ts); what this file proves
// is that the penalty is something a player can actually see and a room cannot: the deadline
// reaches the presser's phone, every mash re-triggers it and says so, the room hears nothing,
// and in teams mode one member's itchy thumb locks the whole team out.
/* oxlint-disable no-await-in-loop */
import { describe, expect, it } from "vitest";
import {
  compactGameWith,
  connectBot,
  connectHost,
  initializeRoom,
  racerBot,
  uniqueCode,
} from "./helpers.ts";
import type { Bot } from "@jeopardy/bots/bot";
import type { CompactGameSpec, TestClient } from "./helpers.ts";

// A long lockout so the test's own scheduling jitter can never be mistaken for an expiry, and
// no wager cells to complicate cell (0,0).
const lockoutGame = compactGameWith({ buzzing: { earlyBuzzLockoutMs: 1000 } });

function rejections(bot: Bot) {
  return bot.received.filter((message) => message.type === "buzz-rejected");
}

async function readingClue(options: {
  seed: string;
  game?: CompactGameSpec;
  bots: string[];
  team?: boolean;
}): Promise<{ host: TestClient; bots: Bot[] }> {
  const code = uniqueCode();
  const { hostToken } = await initializeRoom(code, options.game ?? lockoutGame, options.seed);
  const host = await connectHost(code, hostToken);
  const bots: Bot[] = [];
  for (const nickname of options.bots) {
    bots.push(
      await connectBot(code, {
        ...racerBot(nickname, 0, { buzzProbability: 0 }),
        // Teams mode: everyone lands on ONE team, which is what makes the team-wide penalty
        // observable at all.
        ...(options.team === true && {
          team:
            bots.length === 0
              ? ({ kind: "create", name: "Sequoias" } as const)
              : ({ kind: "join", teamId: "t-1" } as const),
        }),
      }),
    );
  }
  await host.waitFor("roster", (message) => message.roster.players.length === options.bots.length);
  host.sendAction({ type: "start-game" });
  await host.takeEvent("round-started");
  host.sendAction({ type: "select-cell", category: 0, row: 0 });
  await host.takeEvent("clue-presented");
  return { host, bots };
}

describe("matrix #12 end to end: the early-buzz penalty", () => {
  it("registers a press before the arm as a penalty the presser can see", async () => {
    const { host, bots } = await readingClue({ seed: "lockout-basic", bots: ["Eager", "Calm"] });
    const [eager, calm] = bots;
    if (eager === undefined || calm === undefined) throw new Error("bots");

    eager.sendAction({ type: "buzz" });
    const rejection = await eager.waitFor((message) => message.type === "buzz-rejected");
    if (rejection.type !== "buzz-rejected") throw new Error("unreachable");
    expect(rejection.reason).toBe("early-lockout");
    expect(rejection.lockedUntil).toBeGreaterThan(Date.now());

    // Private: the room never hears a rejection, and no room audio can key off one.
    expect(rejections(calm)).toEqual([]);
    expect(host.messagesOf("buzz-rejected")).toEqual([]);
    expect(host.messagesOf("buzz-won")).toEqual([]);
  }, 20_000);

  it("re-triggers on every mash, each with a LATER deadline on the offender's phone", async () => {
    const { host, bots } = await readingClue({ seed: "lockout-mash", bots: ["Masher", "Patient"] });
    const [masher, patient] = bots;
    if (masher === undefined || patient === undefined) throw new Error("bots");

    masher.sendAction({ type: "buzz" });
    await masher.waitFor((message) => message.type === "buzz-rejected");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    // Two more presses AFTER the arm, while the penalty runs. Each is held by the
    // compensation window, adjudicated, and answered privately with the new deadline. Waiting
    // for each answer rather than sleeping a fixed span keeps the presses inside the running
    // penalty even when the suite is loaded - a slept-through lockout would test nothing.
    for (let press = 0; press < 2; press += 1) {
      const answered = rejections(masher).length + 1;
      masher.sendAction({ type: "buzz" });
      const deadline = Date.now() + 5000;
      while (rejections(masher).length < answered && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    // Nobody won: every one of those presses was a penalty, not a buzz.
    expect(host.messagesOf("buzz-won")).toEqual([]);
    const deadlines = rejections(masher).map((message) =>
      message.type === "buzz-rejected" ? message.lockedUntil : null,
    );
    expect(deadlines.length).toBe(3);
    expect(deadlines.every((deadline) => deadline !== null)).toBe(true);
    // Strictly later each time: mashing keeps you out, exactly like the TV hardware.
    for (let index = 1; index < deadlines.length; index += 1) {
      expect(deadlines[index] ?? 0).toBeGreaterThan(deadlines[index - 1] ?? 0);
    }
    // ...and the room still heard nothing about any of it.
    expect(host.messagesOf("buzz-rejected")).toEqual([]);
    expect(
      host.engineEvents.filter((event) => event.type === "buzz-rejected"),
      "buzz-rejected is per-phone feedback and must never ride the public event stream",
    ).toEqual([]);

    // The patient rival wins the clue while the masher is still locked out.
    patient.sendAction({ type: "buzz" });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(won.playerId).toBe(patient.playerId);
  }, 20_000);

  it("applies team-wide: one member's early press locks their teammates out too", async () => {
    const { host, bots } = await readingClue({
      seed: "lockout-team",
      game: compactGameWith({
        buzzing: { earlyBuzzLockoutMs: 1000 },
        teams: { playerMode: "teams", teamBuzzer: "any-member", teamWideEarlyBuzzPenalty: true },
      }),
      bots: ["Ada", "Bea"],
      team: true,
    });
    const [ada, bea] = bots;
    if (ada === undefined || bea === undefined) throw new Error("bots");
    expect(ada.entityId).toBe(bea.entityId); // same team, same scoring entity

    ada.sendAction({ type: "buzz" }); // early, during reading
    await ada.waitFor((message) => message.type === "buzz-rejected");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    // Bea did nothing wrong and is locked out anyway - that is the anti-spam rule (#36).
    bea.sendAction({ type: "buzz" });
    const beaRejection = await bea.waitFor((message) => message.type === "buzz-rejected", 8000);
    if (beaRejection.type !== "buzz-rejected") throw new Error("unreachable");
    expect(beaRejection.reason).toBe("early-lockout");
    expect(host.messagesOf("buzz-won")).toEqual([]);
  }, 20_000);

  it("turns the penalty off entirely at 0ms (the casual setting), with an honest refusal", async () => {
    const { host, bots } = await readingClue({
      seed: "lockout-off",
      game: compactGameWith({ buzzing: { earlyBuzzLockoutMs: 0 } }),
      bots: ["Eager"],
    });
    const [eager] = bots;
    if (eager === undefined) throw new Error("bots");

    eager.sendAction({ type: "buzz" });
    const rejection = await eager.waitFor((message) => message.type === "buzz-rejected");
    if (rejection.type !== "buzz-rejected") throw new Error("unreachable");
    // Not a penalty, just "too early" - and no deadline, because nothing is locked.
    expect(rejection.reason).toBe("not-armed");
    expect(rejection.lockedUntil).toBeNull();

    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");
    eager.sendAction({ type: "buzz" });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(won.playerId).toBe(eager.playerId);
  }, 20_000);
});
