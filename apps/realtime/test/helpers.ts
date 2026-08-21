// Shared scaffolding for the workerd room suite: initialize rooms through the same typed
// RPC the web Worker uses, open real WebSocket upgrades through the worker router, and wrap
// sockets in either a raw TestClient (host/display/manual frames) or a @jeopardy/bots Bot
// (the simulation layer exercising the exact phone code paths).
import { env, SELF } from "cloudflare:test";
import { expect } from "vitest";
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
import { Bot } from "@jeopardy/bots/bot";
import { withSimulatedLatency } from "@jeopardy/bots/latency";
import type { BotOptions } from "@jeopardy/bots/bot";
import type { LatencyProfile } from "@jeopardy/bots/latency";
import type { BotSocket } from "@jeopardy/bots/socket";
import type { CreateRoomRequestInput } from "@jeopardy/protocol/room/create";
import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";
import type { RoomServerMessage } from "@jeopardy/protocol/room/server-messages";
import type { GameEvent } from "@jeopardy/engine/events";

let codeCounter = 0;

/** Unique per test: DO instances outlive isolated-storage rollbacks, codes must not. */
export function uniqueCode(): string {
  codeCounter += 1;
  return `T${String(codeCounter).padStart(4, "0")}`.slice(0, 5);
}

/** The board-only game spec, narrowed - so a test can spread it and keep the discriminant. */
export type CompactGameSpec = Extract<CreateRoomRequestInput["game"], { kind: "compact" }>;

export const compactGame: CompactGameSpec = {
  kind: "compact",
  rounds: [{ columns: 3, rows: 3 }],
  preset: "casual-party",
  // Wager cells off by default (tests opt in with authoredWagers + manual placement).
  overrides: { wagers: { countRoundOne: 0, countRoundTwo: 0 } },
  hasFinalClue: false,
};

/** The same room with extra settings overrides layered on - the M6 suites tune one row. */
export function compactGameWith(
  overrides: CompactGameSpec["overrides"],
  extra: Partial<CompactGameSpec> = {},
): CompactGameSpec {
  return { ...compactGame, overrides: { ...compactGame.overrides, ...overrides }, ...extra };
}

export function roomStub(code: string) {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
}

// `options` carries the room fields beyond the game itself - listing/title/hostLabel
// (docs/decisions/2026-08-14-room-visibility-and-lobby.md) and the room controls
// (docs/decisions/2026-08-14-room-controls-and-staging.md). Omitted = the default private,
// open, spectators-welcome room every pre-existing test in this suite assumes.
export async function initializeRoom(
  code: string,
  game: CreateRoomRequestInput["game"] = compactGame,
  seed = "workerd-suite-seed",
  options: Omit<CreateRoomRequestInput, "game" | "seed"> = {},
): Promise<InitializedRoom> {
  const response = await roomStub(code).fetch("https://do/initialize", {
    method: "POST",
    body: JSON.stringify({ game, seed, ...options } satisfies CreateRoomRequestInput),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as InitializedRoom;
}

export type InitializedRoom = { hostToken: string; expiresAt: number; settings: RoomSettings };

export async function upgradeToRoom(code: string): Promise<WebSocket> {
  const response = await SELF.fetch(`https://realtime.test/room/${code}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error("upgrade did not yield a WebSocket");
  return socket;
}

// Raw protocol client with an awaitable message queue - the host console / display stand-in.
export class TestClient {
  readonly received: RoomServerMessage[] = [];
  readonly closes: { code: number; reason: string }[] = [];
  /** Engine events flattened out of `event` messages, in arrival order. */
  readonly engineEvents: GameEvent[] = [];
  private readonly eventCursors = new Map<string, number>();
  private readonly waiters: {
    predicate: (message: RoomServerMessage) => boolean;
    resolve: (message: RoomServerMessage) => void;
  }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const parsed = parseRoomServerMessage(String(event.data));
      if (!parsed.ok) throw new Error(`server sent unparseable frame: ${parsed.detail}`);
      this.received.push(parsed.message);
      if (parsed.message.type === "event") {
        this.engineEvents.push(...(parsed.message.events as GameEvent[]));
      }
      for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.waiters[index];
        if (waiter !== undefined && waiter.predicate(parsed.message)) {
          this.waiters.splice(index, 1);
          waiter.resolve(parsed.message);
        }
      }
    });
    socket.addEventListener("close", (event) => {
      this.closes.push({ code: event.code, reason: event.reason });
    });
    socket.accept();
  }

  /**
   * Consume the NEXT engine event of a type (per-type cursor), waiting for it if it has not
   * arrived - the sequential-script primitive scripted host flows are written with.
   */
  async takeEvent<Type extends GameEvent["type"]>(
    type: Type,
    timeoutMs = 5000,
  ): Promise<Extract<GameEvent, { type: Type }>> {
    const deadline = Date.now() + timeoutMs;
    const cursor = this.eventCursors.get(type) ?? 0;
    for (;;) {
      const matching = this.engineEvents.filter((event) => event.type === type);
      const next = matching[cursor];
      if (next !== undefined) {
        this.eventCursors.set(type, cursor + 1);
        return next as Extract<GameEvent, { type: Type }>;
      }
      if (Date.now() > deadline) {
        // The full receive history makes timeout failures self-diagnosing.
        const seen = this.engineEvents.map((event) => event.type).join(", ");
        const errors = this.received
          .filter((message) => message.type === "error")
          .map((message) => JSON.stringify(message))
          .join("; ");
        throw new Error(
          `timed out waiting for engine event ${type} (cursor ${String(cursor)}); events seen: [${seen}]; errors: [${errors}]`,
        );
      }
      // Polling keeps the primitive trivially correct; 10ms granularity is invisible
      // against test timeouts.
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  send(payload: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ version: protocolVersion, ...payload }));
  }

  sendAction(action: Record<string, unknown>): void {
    this.send({ type: "action", action });
  }

  waitFor<Type extends RoomServerMessage["type"]>(
    type: Type,
    predicate?: (message: Extract<RoomServerMessage, { type: Type }>) => boolean,
    timeoutMs = 5000,
  ): Promise<Extract<RoomServerMessage, { type: Type }>> {
    const matches = (message: RoomServerMessage): boolean =>
      message.type === type &&
      (predicate === undefined || predicate(message as Extract<RoomServerMessage, { type: Type }>));
    const already = this.received.find(matches);
    if (already !== undefined) {
      return Promise.resolve(already as Extract<RoomServerMessage, { type: Type }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        predicate: matches,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message as Extract<RoomServerMessage, { type: Type }>);
        },
      });
    });
  }

  messagesOf<Type extends RoomServerMessage["type"]>(
    type: Type,
  ): Extract<RoomServerMessage, { type: Type }>[] {
    return this.received.filter((message) => message.type === type) as Extract<
      RoomServerMessage,
      { type: Type }
    >[];
  }
}

export async function connectHost(code: string, hostToken: string): Promise<TestClient> {
  const client = new TestClient(await upgradeToRoom(code));
  client.send({ type: "join", role: "host", hostToken });
  await client.waitFor("welcome");
  await client.waitFor("snapshot");
  return client;
}

export async function connectBot(
  code: string,
  options: BotOptions,
  // M6: put a simulated phone network between this bot and the room. The bot and the DO are
  // both real; only the wire is pretend (packages/bots/src/latency.ts), which is what makes a
  // buzz race in this suite a measurement rather than a demonstration.
  network?: { profile: LatencyProfile; seed?: string },
): Promise<Bot> {
  const socket = await upgradeToRoom(code);
  const wire =
    network === undefined
      ? (socket as unknown as BotSocket)
      : withSimulatedLatency(socket as unknown as BotSocket, {
          profile: network.profile,
          seed: network.seed ?? `${network.profile.id}-${options.nickname}`,
        });
  const bot = new Bot(wire, options);
  socket.accept();
  bot.start();
  await bot.waitFor((message) => message.type === "welcome");
  return bot;
}

/**
 * A racer: presses `reactionMs` after ITS OWN phone renders the arm, acks like a real client,
 * and claims its elapsed honestly unless told otherwise. Pair with `connectBot`'s network
 * argument to give it a connection worth compensating for.
 */
export function racerBot(
  nickname: string,
  reactionMs: number,
  behavior: Partial<BotOptions["behavior"]> = {},
): BotOptions {
  return {
    nickname,
    seed: `racer-${nickname}`,
    behavior: {
      buzzProbability: 1,
      buzzLatencyMinMs: reactionMs,
      buzzLatencyMaxMs: reactionMs,
      ...behavior,
    },
  };
}

/** Deterministic bot: always buzzes, fixed latency, so ordering assertions are exact. */
export function instantBot(nickname: string, latencyMs = 0): Omit<BotOptions, "team"> {
  return {
    nickname,
    seed: `seed-${nickname}`,
    behavior: {
      buzzProbability: 1,
      buzzLatencyMinMs: latencyMs,
      buzzLatencyMaxMs: latencyMs,
    },
  };
}
