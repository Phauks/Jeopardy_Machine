<script lang="ts">
  // Dev-loop proof page (M0 exit criterion, architecture risk 6): opens a WebSocket from the
  // SvelteKit app to the realtime Worker's GameRoomDO stub and shows the round trip. If this
  // page shows a welcome + an echo, the two-Worker local dev story works. Kept in the tree
  // (not deleted after M0) as the fastest "is realtime up" smoke check; /dev/* routes never
  // ship links from product UI.
  // SK3 env: declared in src/env.ts, imported from $app/env/public.
  import { REALTIME_ORIGIN } from "$app/env/public";
  import { protocolVersion } from "@jeopardy/protocol/envelope";
  // SK3 dropped the $lib alias; #lib is the Node-subpath-imports replacement (package.json "imports").
  import { roomWebSocketUrl } from "#lib/realtime/room-url.ts";

  let roomCode = $state("BQKX7");
  let log = $state<string[]>([]);
  let socket = $state<WebSocket | null>(null);
  let connected = $state(false);

  function append(line: string): void {
    log = [...log, `${new Date().toISOString().slice(11, 19)} ${line}`];
  }

  let copyState = $state("Copy log");

  async function copyLog(): Promise<void> {
    try {
      await navigator.clipboard.writeText(log.join("\n"));
      copyState = "Copied!";
    } catch {
      copyState = "Copy failed";
    }
    setTimeout(() => {
      copyState = "Copy log";
    }, 1500);
  }

  function connect(): void {
    disconnect();
    // Empty origin = production build without REALTIME_ORIGIN configured. Refuse loudly
    // rather than dialing localhost from a public origin (which trips Chrome's Local
    // Network Access permission popup on visitors' machines).
    if (!REALTIME_ORIGIN) {
      append(
        "REALTIME_ORIGIN is not configured for this deployment - set it as a build variable to the realtime Worker's https origin",
      );
      return;
    }
    try {
      const url = roomWebSocketUrl(REALTIME_ORIGIN, roomCode);
      append(`connecting to ${url}`);
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        connected = true;
        append("open");
      });
      ws.addEventListener("message", (event) => append(`received: ${String(event.data)}`));
      ws.addEventListener("close", (event) => {
        connected = false;
        append(`closed (${event.code})`);
      });
      ws.addEventListener("error", () => append("socket error - is the realtime worker running? (pnpm dev runs both)"));
      socket = ws;
    } catch (error) {
      append(error instanceof Error ? error.message : String(error));
    }
  }

  function sendHello(): void {
    const message = JSON.stringify({ version: protocolVersion, type: "hello", from: "dev-echo-page" });
    socket?.send(message);
    append(`sent: ${message}`);
  }

  function sendStaleVersion(): void {
    // Exercises the version-skew refusal (docs/decisions/2026-08-13-pwa.md).
    const message = JSON.stringify({ version: protocolVersion + 1, type: "hello" });
    socket?.send(message);
    append(`sent: ${message}`);
  }

  function disconnect(): void {
    socket?.close();
    socket = null;
  }
</script>

<svelte:head>
  <title>Dev: WebSocket echo</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
  <h1 class="text-2xl font-bold">WebSocket echo check</h1>
  <p>
    Talks to the realtime Worker at <code>{REALTIME_ORIGIN}</code> (set via
    <code>REALTIME_ORIGIN</code>).
  </p>
  <div class="flex flex-wrap items-center gap-2">
    <label for="room-code">Room code</label>
    <input id="room-code" class="border px-2 py-1" bind:value={roomCode} maxlength="5" />
    <button class="border px-3 py-1" onclick={connect}>Connect</button>
    <button class="border px-3 py-1" disabled={!connected} onclick={sendHello}>Send hello</button>
    <button class="border px-3 py-1" disabled={!connected} onclick={sendStaleVersion}>Send stale version</button>
    <button class="border px-3 py-1" disabled={!connected} onclick={disconnect}>Disconnect</button>
    <button
      class="border px-3 py-1"
      disabled={log.length === 0}
      onclick={() => {
        log = [];
      }}>Clear log</button
    >
    <button class="border px-3 py-1" disabled={log.length === 0} onclick={copyLog}
      >{copyState}</button
    >
  </div>
  <pre class="min-h-40 overflow-x-auto border p-3 text-sm">{log.join("\n")}</pre>
</main>
