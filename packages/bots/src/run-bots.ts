// CLI: run N bot players against a room over the single origin - the manual smoke tool for
// M3 rooms and the seed of the M4 sim panel's backend. Node 22's global WebSocket dials;
// bots then speak the room protocol verbatim.
//
//   pnpm -F @jeopardy/bots bots -- --room BQKX7                 # join an existing room
//   pnpm -F @jeopardy/bots bots -- --create --count 5 --host    # create a room, keep a host
//   pnpm -F @jeopardy/bots bots -- --origin http://localhost:8788 --create --host
//
// --host additionally opens a host connection and drives a minimal game loop (start, select
// first available cell, arm, judge the buzz winner correct) so a bots-only room actually
// plays. Without it the bots sit in the lobby - useful when a human host console is open.
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
import { Bot } from "./bot.ts";
import { openWebSocket } from "./socket.ts";
import type { GameEvent } from "@jeopardy/engine/events";
import type { GameState } from "@jeopardy/engine/state";

type CliOptions = {
  origin: string;
  room: string | null;
  create: boolean;
  count: number;
  seed: string;
  host: boolean;
};

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    origin: "http://localhost:8788",
    room: null,
    create: false,
    count: 3,
    seed: `bots-${String(Date.now())}`,
    host: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => argv[(index += 1)] ?? "";
    if (flag === "--origin") options.origin = value();
    else if (flag === "--room") options.room = value().toUpperCase();
    else if (flag === "--create") options.create = true;
    else if (flag === "--count") options.count = Number(value());
    else if (flag === "--seed") options.seed = value();
    else if (flag === "--host") options.host = true;
    else {
      console.error(`unknown flag ${String(flag)}`);
      process.exit(2);
    }
  }
  return options;
}

async function createRoom(origin: string, seed: string): Promise<string> {
  const response = await fetch(`${origin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: { kind: "compact", rounds: [{ columns: 3, rows: 3 }] },
      seed,
    }),
  });
  if (!response.ok) throw new Error(`create failed: ${String(response.status)}`);
  const body = (await response.json()) as { code: string; hostToken: string };
  hostToken = body.hostToken;
  return body.code;
}

let hostToken: string | null = null;

function wsUrl(origin: string, code: string): string {
  return `${origin.replace(/^http/, "ws")}/room/${code}/ws`;
}

// A tiny host driver: enough game loop to make a bots-only room play end to end.
async function runHost(origin: string, code: string, token: string): Promise<void> {
  const socket = await openWebSocket(wsUrl(origin, code));
  const send = (payload: Record<string, unknown>) =>
    socket.send(JSON.stringify({ version: protocolVersion, ...payload }));
  const sendAction = (action: Record<string, unknown>) => send({ type: "action", action });

  let game: GameState | null = null;
  socket.addEventListener("message", (event) => {
    const parsed = parseRoomServerMessage(String(event.data));
    if (!parsed.ok) return;
    const message = parsed.message;
    if (message.type === "snapshot") game = (message.game as GameState | null) ?? null;
    if (message.type === "buzz-won") {
      setTimeout(() => sendAction({ type: "judge", verdict: "correct" }), 300);
    }
    if (message.type !== "event") return;
    for (const raw of message.events) {
      const gameEvent = raw as GameEvent;
      if (gameEvent.type === "round-started" || gameEvent.type === "clue-finished") {
        // Ask for a fresh snapshot, then select the first hidden cell off it.
        send({ type: "sync" });
        setTimeout(() => selectNext(), 200);
      }
      if (gameEvent.type === "clue-presented") {
        setTimeout(() => sendAction({ type: "arm-buzzers" }), 400);
      }
      if (gameEvent.type === "wager-committed") {
        setTimeout(() => sendAction({ type: "arm-buzzers" }), 200);
      }
      if (gameEvent.type === "round-break") {
        setTimeout(() => sendAction({ type: "proceed" }), 400);
      }
      if (gameEvent.type === "game-over") {
        console.log("game over:", JSON.stringify(gameEvent.standings));
        process.exit(0);
      }
    }
  });

  function selectNext(): void {
    if (game === null || game.phase !== "awaiting-selection") return;
    const board = game.boards[game.roundIndex];
    if (board === undefined) return;
    for (const [category, column] of board.status.entries()) {
      for (const [row, status] of column.entries()) {
        if (status === "hidden") {
          sendAction({ type: "select-cell", category, row });
          return;
        }
      }
    }
    sendAction({ type: "end-round" });
  }

  send({ type: "join", role: "host", hostToken: token });
  await new Promise((resolve) => setTimeout(resolve, 500));
  sendAction({ type: "start-game" });
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const code = options.create ? await createRoom(options.origin, options.seed) : options.room;
  if (code === null) {
    console.error("pass --room CODE or --create");
    process.exit(2);
  }
  console.log(`room ${code} on ${options.origin} - launching ${String(options.count)} bots`);

  for (let index = 0; index < options.count; index += 1) {
    // Sequential joins on purpose: stable arrival order gives stable seat numbering, which
    // makes seeded runs comparable across invocations.
    // oxlint-disable-next-line no-await-in-loop
    const socket = await openWebSocket(wsUrl(options.origin, code));
    const bot = new Bot(socket, {
      nickname: `Bot ${String(index + 1)}`,
      seed: `${options.seed}-${String(index)}`,
    });
    bot.start();
    // oxlint-disable-next-line no-await-in-loop
    await bot.waitFor((message) => message.type === "welcome");
    console.log(`  ${bot.nickname} joined as ${bot.playerId ?? "?"}`);
  }

  if (options.host) {
    if (hostToken === null) {
      console.error("--host requires --create (the host token comes from creation)");
      process.exit(2);
    }
    await runHost(options.origin, code, hostToken);
  } else {
    console.log("bots idle in the room (no --host); Ctrl-C to disconnect them");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
