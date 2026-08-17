// CLI: run N bot players against a room over the single origin - the manual smoke tool for
// M3 rooms and the seed of the M4 sim panel's backend. Node 22's global WebSocket dials;
// bots then speak the room protocol verbatim.
//
//   pnpm -F @jeopardy/bots bots -- --room BQKX7                 # join an existing room
//   pnpm -F @jeopardy/bots bots -- --create --count 5 --host    # create a room, keep a host
//   pnpm -F @jeopardy/bots bots -- --origin http://localhost:8788 --create --host
//   pnpm -F @jeopardy/bots bots -- --create --race 6            # the fairness harness
//   pnpm -F @jeopardy/bots bots -- --create --race 6 --no-compensation   # ...its control arm
//
// --host additionally opens a host connection and drives a minimal game loop (start, select
// first available cell, arm, judge the buzz winner correct) so a bots-only room actually
// plays. Without it the bots sit in the lobby - useful when a human host console is open.
//
// --race N runs N buzz races instead (M6, docs/decisions/2026-08-17-buzz-latency-
// compensation.md): each bot gets a simulated phone network and a fixed reaction time, and
// the run prints who won each race, who WOULD have won on raw arrival order, and whether the
// fastest thumb was the one crowned. Seeded, so a run is repeatable and two runs are
// comparable - which is what turns "fair" from a claim into a measurement.
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
import { Bot } from "./bot.ts";
import { latencyProfiles, withSimulatedLatency } from "./latency.ts";
import { formatRaceReport, reportRaces } from "./race.ts";
import { openWebSocket } from "./socket.ts";
import type { LatencyProfile } from "./latency.ts";
import type { RaceOutcome, Racer } from "./race.ts";
import type { GameEvent } from "@jeopardy/engine/events";
import type { GameState } from "@jeopardy/engine/state";

type CliOptions = {
  origin: string;
  room: string | null;
  create: boolean;
  count: number;
  seed: string;
  host: boolean;
  races: number;
  // --no-compensation creates the room with buzz latency compensation OFF (the M3 behavior),
  // which is how a race run measures itself against the thing it replaced.
  compensation: boolean;
};

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    origin: "http://localhost:8788",
    room: null,
    create: false,
    count: 3,
    seed: `bots-${String(Date.now())}`,
    host: false,
    races: 0,
    compensation: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => argv[(index += 1)] ?? "";
    // pnpm 10 forwards the `--` separator itself, so the documented `bots -- --create` form
    // arrives here with a bare "--" in front of the flags. Skipping it is why the README's
    // commands work as written.
    if (flag === "--") continue;
    if (flag === "--origin") options.origin = value();
    else if (flag === "--room") options.room = value().toUpperCase();
    else if (flag === "--create") options.create = true;
    else if (flag === "--count") options.count = Number(value());
    else if (flag === "--seed") options.seed = value();
    else if (flag === "--host") options.host = true;
    else if (flag === "--race") options.races = Number(value());
    else if (flag === "--no-compensation") options.compensation = false;
    else {
      console.error(`unknown flag ${String(flag)}`);
      process.exit(2);
    }
  }
  return options;
}

async function createRoom(options: CliOptions): Promise<string> {
  const response = await fetch(`${options.origin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: {
        kind: "compact",
        rounds: [{ columns: 3, rows: 3 }],
        // --no-compensation is the CONTROL arm of the harness: the same seeded field over the
        // same simulated networks, adjudicated by arrival order, so the two reports side by
        // side are the measurement (M6).
        ...(options.compensation ? {} : { overrides: { buzzing: { latencyCompensation: false } } }),
      },
      seed: options.seed,
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

// ---- the fairness harness ---------------------------------------------------------------

// One racer per profile, cycling: a room where every phone has the same connection would
// measure nothing. Reaction times are spread across the field so the fastest THUMB is rarely
// on the fastest network - which is the arrangement arrival order gets wrong.
const raceField: { profile: LatencyProfile; reactionMs: number }[] = [
  { profile: latencyProfiles.slow, reactionMs: 140 },
  { profile: latencyProfiles.fast, reactionMs: 240 },
  { profile: latencyProfiles.jittery, reactionMs: 190 },
  { profile: latencyProfiles.fast, reactionMs: 320 },
  { profile: latencyProfiles.slow, reactionMs: 260 },
];

async function runRaces(options: CliOptions, code: string, token: string): Promise<void> {
  const field = raceField.slice(0, Math.max(Math.min(options.count, raceField.length), 2));
  const bots: Bot[] = [];
  const racers: Racer[] = [];
  for (const [index, entry] of field.entries()) {
    const nickname = `Racer ${String(index + 1)} (${entry.profile.id})`;
    // Sequential joins keep seat numbering stable across runs, like the ordinary bot path.
    // oxlint-disable-next-line no-await-in-loop
    const socket = await openWebSocket(wsUrl(options.origin, code));
    const bot = new Bot(
      withSimulatedLatency(socket, {
        profile: entry.profile,
        seed: `${options.seed}-net-${String(index)}`,
      }),
      {
        nickname,
        seed: `${options.seed}-${String(index)}`,
        behavior: {
          buzzProbability: 1,
          buzzLatencyMinMs: entry.reactionMs,
          buzzLatencyMaxMs: entry.reactionMs,
        },
      },
    );
    bot.start();
    // oxlint-disable-next-line no-await-in-loop
    await bot.waitFor((message) => message.type === "welcome");
    bots.push(bot);
    racers.push({
      nickname,
      roundTripMs: entry.profile.roundTripMs,
      reactionMs: entry.reactionMs,
    });
  }

  const socket = await openWebSocket(wsUrl(options.origin, code));
  const send = (payload: Record<string, unknown>) =>
    socket.send(JSON.stringify({ version: protocolVersion, ...payload }));
  const sendAction = (action: Record<string, unknown>) => send({ type: "action", action });
  const winners: string[] = [];
  socket.addEventListener("message", (event) => {
    const parsed = parseRoomServerMessage(String(event.data));
    if (!parsed.ok) return;
    const message = parsed.message;
    if (message.type === "buzz-won") {
      const winner = bots.find((bot) => bot.playerId === message.playerId);
      winners.push(winner?.nickname ?? message.playerId);
      setTimeout(() => sendAction({ type: "judge", verdict: "correct" }), 100);
    }
  });
  send({ type: "join", role: "host", hostToken: token });
  await new Promise((resolve) => setTimeout(resolve, 400));
  sendAction({ type: "start-game" });
  await new Promise((resolve) => setTimeout(resolve, 400));

  const outcomes: RaceOutcome[] = [];
  for (let race = 0; race < options.races; race += 1) {
    const category = race % 3;
    const row = Math.floor(race / 3) % 3;
    sendAction({ type: "select-cell", category, row });
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 300));
    sendAction({ type: "arm-buzzers" });
    const before = winners.length;
    const deadline = Date.now() + 6000;
    while (winners.length === before && Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    outcomes.push({
      label: `race ${String(race + 1)}`,
      racers,
      winner: winners[before] ?? "(nobody)",
      compensating: options.compensation,
    });
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log("");
  console.log(formatRaceReport(reportRaces(outcomes)));
  for (const bot of bots) bot.close();
  socket.close(1000, "races done");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const code = options.create ? await createRoom(options) : options.room;
  if (code === null) {
    console.error("pass --room CODE or --create");
    process.exit(2);
  }
  if (options.races > 0) {
    if (hostToken === null) {
      console.error("--race requires --create (the host token comes from creation)");
      process.exit(2);
    }
    console.log(`room ${code} on ${options.origin} - ${String(options.races)} seeded buzz races`);
    await runRaces(options, code, hostToken);
    process.exit(0);
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
