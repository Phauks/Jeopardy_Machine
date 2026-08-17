import { describe, expect, it } from "vitest";
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { Bot } from "./bot.ts";
import type { BotSocket } from "./socket.ts";

// Loopback socket: captures what the bot sends, lets the test inject server frames.
function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  const handlers: ((event: { data: unknown }) => void)[] = [];
  const socket: BotSocket = {
    send: (data) => sent.push(JSON.parse(data) as Record<string, unknown>),
    close: () => {},
    addEventListener: (_type, handler) => handlers.push(handler),
  };
  const serve = (payload: Record<string, unknown>) => {
    for (const handler of handlers) {
      handler({ data: JSON.stringify({ version: protocolVersion, ...payload }) });
    }
  };
  return { socket, sent, serve };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 5));

function welcomeAndSeat(serve: (payload: Record<string, unknown>) => void, playerId: string) {
  serve({
    type: "welcome",
    roomCode: "BQKX7",
    role: "player",
    playerId,
    sessionToken: "a".repeat(32),
  });
  serve({
    type: "snapshot",
    stateVersion: 0,
    phase: "lobby",
    game: null,
    roster: {
      players: [
        {
          playerId,
          identity: { nickname: "Bot 1", avatarId: null, accentId: null, buzzSoundId: null },
          teamId: null,
          connected: true,
          joinedAt: 1,
        },
      ],
      teams: [],
    },
    // Room-level fields added with the M4 surfaces (2026-08-14) and M6: the host freeze, the
    // redacted clue text, and the room's running timers. A bot ignores all three - it plays by
    // events - but a snapshot without them is not a valid frame, and this fixture is a real
    // frame on purpose.
    paused: false,
    clueContent: null,
    timers: [],
  });
}

describe("bot driver", () => {
  it("joins with its configured identity and records seat + token from the welcome", async () => {
    const { socket, sent, serve } = fakeSocket();
    const bot = new Bot(socket, {
      nickname: "Bot 1",
      seed: "s1",
      team: { kind: "create", name: "Team Bots" },
    });
    bot.start();
    expect(sent[0]).toMatchObject({
      version: protocolVersion,
      type: "join",
      role: "player",
      nickname: "Bot 1",
      team: { kind: "create", name: "Team Bots" },
    });
    welcomeAndSeat(serve, "p-1");
    await bot.waitFor((message) => message.type === "snapshot");
    expect(bot.playerId).toBe("p-1");
    expect(bot.sessionToken).toBe("a".repeat(32));
    expect(bot.entityId).toBe("p-1");
  });

  it("resumes instead of joining when given a session token", () => {
    const { socket, sent } = fakeSocket();
    const bot = new Bot(socket, { nickname: "Bot 1", seed: "s1", sessionToken: "b".repeat(32) });
    bot.start();
    expect(sent[0]).toMatchObject({ type: "resume", sessionToken: "b".repeat(32) });
  });

  it("buzzes after the configured latency when buzzers arm", async () => {
    const { socket, sent, serve } = fakeSocket();
    const bot = new Bot(socket, {
      nickname: "Bot 1",
      seed: "s1",
      behavior: { buzzProbability: 1, buzzLatencyMinMs: 0, buzzLatencyMaxMs: 0 },
    });
    bot.start();
    welcomeAndSeat(serve, "p-1");
    serve({
      type: "event",
      stateVersion: 1,
      events: [{ type: "buzzers-armed", rebound: false, armedAt: 1000 }],
    });
    await nextTick();
    expect(sent.at(-1)).toMatchObject({ type: "action", action: { type: "buzz" } });
  });

  it("answers its own wager prompts but ignores other entities' ranges", async () => {
    const { socket, sent, serve } = fakeSocket();
    const bot = new Bot(socket, {
      nickname: "Bot 1",
      seed: "s1",
      behavior: { wagerFraction: 0.5 },
    });
    bot.start();
    welcomeAndSeat(serve, "p-1");
    serve({
      type: "event",
      stateVersion: 2,
      events: [
        { type: "wager-cell-hit", label: "Double Down", entityId: "p-9", minimum: 5, maximum: 100 },
      ],
    });
    await nextTick();
    expect(sent.some((frame) => (frame as { type: string }).type === "action")).toBe(false);
    serve({
      type: "event",
      stateVersion: 3,
      events: [
        { type: "wager-cell-hit", label: "Double Down", entityId: "p-1", minimum: 5, maximum: 105 },
      ],
    });
    await nextTick();
    expect(sent.at(-1)).toMatchObject({
      type: "action",
      action: { type: "commit-wager", amount: 55 },
    });
  });

  it("plays the final round: wagers its range fraction, writes its configured answer", async () => {
    const { socket, sent, serve } = fakeSocket();
    const bot = new Bot(socket, {
      nickname: "Bot 1",
      seed: "s1",
      behavior: { wagerFraction: 1, answerText: "what is greenery" },
    });
    bot.start();
    welcomeAndSeat(serve, "p-1");
    serve({
      type: "event",
      stateVersion: 4,
      events: [
        { type: "final-wagers-open", ranges: [{ entityId: "p-1", minimum: 0, maximum: 800 }] },
      ],
    });
    serve({
      type: "event",
      stateVersion: 5,
      events: [{ type: "final-writing-open", eligible: ["p-1"] }],
    });
    await nextTick();
    const actions = sent
      .filter((frame) => (frame as { type: string }).type === "action")
      .map((frame) => (frame as { action: { type: string } }).action);
    expect(actions).toContainEqual({ type: "commit-final-wager", amount: 800 });
    expect(actions).toContainEqual({ type: "submit-final-answer", text: "what is greenery" });
  });

  // M6: the client half of latency compensation. A bot has to behave like a phone here or the
  // race harness would be measuring a client nobody ships.
  it("acks an arming at once and stamps its buzz with the elapsed time since it", async () => {
    const { socket, sent, serve } = fakeSocket();
    const bot = new Bot(socket, {
      nickname: "Bot 1",
      seed: "s1",
      behavior: { buzzProbability: 1, buzzLatencyMinMs: 20, buzzLatencyMaxMs: 20 },
    });
    bot.start();
    welcomeAndSeat(serve, "p-1");
    serve({ type: "arm-window", arm: { armId: 7, at: 1000, compensationMs: 250, rebound: false } });
    expect(sent.at(-1)).toMatchObject({ type: "arm-ack", armId: 7 });
    serve({
      type: "event",
      stateVersion: 1,
      events: [{ type: "buzzers-armed", rebound: false, armedAt: 1000 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const buzz = sent.at(-1) as { type: string; timing?: { armId: number; elapsedMs: number } };
    expect(buzz.type).toBe("action");
    expect(buzz.timing?.armId).toBe(7);
    // The claim is measured from the arm this client actually saw, not from any server clock.
    expect(buzz.timing?.elapsedMs).toBeGreaterThanOrEqual(15);
    expect(buzz.timing?.elapsedMs).toBeLessThan(400);
  });

  it("can play the adversary: no ack, and a buzz claiming an instant thumb", async () => {
    const { socket, sent, serve } = fakeSocket();
    const bot = new Bot(socket, {
      nickname: "Cheater",
      seed: "s1",
      behavior: {
        buzzProbability: 1,
        buzzLatencyMinMs: 30,
        buzzLatencyMaxMs: 30,
        acknowledgeArming: false,
        elapsedClaim: "zero",
      },
    });
    bot.start();
    welcomeAndSeat(serve, "p-1");
    serve({ type: "arm-window", arm: { armId: 2, at: 1, compensationMs: 250, rebound: false } });
    expect(sent.some((frame) => (frame as { type: string }).type === "arm-ack")).toBe(false);
    serve({
      type: "event",
      stateVersion: 1,
      events: [{ type: "buzzers-armed", rebound: false, armedAt: 1 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent.at(-1)).toMatchObject({ type: "action", timing: { armId: 2, elapsedMs: 0 } });
  });

  it("makes identical seeded decisions across runs (reproducible simulations)", async () => {
    async function buzzPattern(): Promise<boolean[]> {
      const { socket, sent, serve } = fakeSocket();
      const bot = new Bot(socket, {
        nickname: "Bot 1",
        seed: "pattern-seed",
        behavior: { buzzProbability: 0.5, buzzLatencyMinMs: 0, buzzLatencyMaxMs: 0 },
      });
      bot.start();
      welcomeAndSeat(serve, "p-1");
      const pattern: boolean[] = [];
      for (let arming = 0; arming < 12; arming += 1) {
        const before = sent.length;
        serve({
          type: "event",
          stateVersion: arming + 1,
          events: [{ type: "buzzers-armed", rebound: false, armedAt: arming }],
        });
        // Sequential on purpose: each arming's buzz decision must land before the next
        // arming is served, or the pattern comparison races itself.
        // oxlint-disable-next-line no-await-in-loop
        await nextTick();
        pattern.push(sent.length > before);
      }
      return pattern;
    }
    const first = await buzzPattern();
    const second = await buzzPattern();
    expect(second).toEqual(first);
    expect(first).toContain(true);
    expect(first).toContain(false);
  });
});
