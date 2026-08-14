<script lang="ts">
  // Realtime test harness (grown from the M0 echo proof at the owner's request): connection
  // lifecycle, latency, ordering, hibernation, and malformed-input probes against the
  // GameRoomDO stub. The stub's contract: welcome on connect, version-checked JSON envelope,
  // unknown types echoed back wrapped as {type:"echo"}. /dev/* routes never ship links from
  // product UI.
  import { REALTIME_ORIGIN } from "$app/env/public";
  import { protocolVersion } from "@jeopardy/protocol/envelope";
  import { roomWebSocketUrl } from "#lib/realtime/room-url.ts";

  let roomCode = $state("BQKX7");
  let log = $state<{ at: string; dir: "out" | "in" | "info" | "err"; text: string }[]>([]);
  let socket = $state<WebSocket | null>(null);
  let phase = $state<"disconnected" | "connecting" | "open">("disconnected");
  let sentCount = $state(0);
  let receivedCount = $state(0);
  let openedAt = $state<number | null>(null);
  let lastActivityAt = $state<number | null>(null);
  let autoReconnect = $state(false);
  let reconnectAttempt = 0;
  // Ticker so uptime/idle readouts update; also the idle clock for hibernation probing.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 500);
    return () => clearInterval(timer);
  });

  const logLimit = 500;
  function append(dir: "out" | "in" | "info" | "err", text: string): void {
    const at = new Date().toISOString().slice(11, 23);
    log = [...log.slice(-(logLimit - 1)), { at, dir, text }];
  }

  function seconds(fromMs: number | null): string {
    if (fromMs === null) return "-";
    return `${((now - fromMs) / 1000).toFixed(0)}s`;
  }

  // --- connection lifecycle -------------------------------------------------------------

  function connect(): void {
    disconnect();
    if (!REALTIME_ORIGIN) {
      append(
        "err",
        "REALTIME_ORIGIN is not configured for this deployment - set it as a build variable to the realtime Worker's https origin",
      );
      return;
    }
    try {
      const url = roomWebSocketUrl(REALTIME_ORIGIN, roomCode);
      phase = "connecting";
      append("info", `connecting to ${url}`);
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        phase = "open";
        openedAt = Date.now();
        lastActivityAt = Date.now();
        reconnectAttempt = 0;
        append("info", "open");
      });
      ws.addEventListener("message", (event) => {
        receivedCount += 1;
        lastActivityAt = Date.now();
        const data = String(event.data);
        handlePossiblePong(data);
        handlePossibleOrderEcho(data);
        append("in", data);
      });
      ws.addEventListener("close", (event) => {
        phase = "disconnected";
        openedAt = null;
        append("info", `closed (code ${event.code}${event.reason ? `, reason "${event.reason}"` : ""})`);
        if (autoReconnect && reconnectAttempt < 3) {
          reconnectAttempt += 1;
          const delay = 500 * 2 ** reconnectAttempt;
          append("info", `auto-reconnect ${reconnectAttempt}/3 in ${delay}ms`);
          setTimeout(() => {
            if (phase === "disconnected") connect();
          }, delay);
        }
      });
      ws.addEventListener("error", () =>
        append("err", "socket error - is the realtime worker running? (pnpm dev from the repo root runs both)"),
      );
      socket = ws;
    } catch (error) {
      phase = "disconnected";
      append("err", error instanceof Error ? error.message : String(error));
    }
  }

  function disconnect(): void {
    autoReconnectPauseForManualClose();
    socket?.close(1000, "user disconnect");
    socket = null;
  }

  function simulateDrop(): void {
    // Abrupt close without the polite handshake path the Disconnect button takes - closest a
    // page can get to "the phone walked out of Wi-Fi". Pair with auto-reconnect to watch the
    // recovery path.
    append("info", "simulating connection drop (close 4000)");
    socket?.close(4000, "simulated drop");
    socket = null;
  }

  function autoReconnectPauseForManualClose(): void {
    // A deliberate disconnect should not fight the user by instantly reconnecting.
    reconnectAttempt = 3;
  }

  // --- send helpers ---------------------------------------------------------------------

  function sendRaw(raw: string, label?: string): void {
    if (socket === null || phase !== "open") {
      append("err", "not connected");
      return;
    }
    socket.send(raw);
    sentCount += 1;
    lastActivityAt = Date.now();
    append("out", label ? `${label}: ${raw.length > 200 ? `${raw.slice(0, 200)}... (${raw.length} chars)` : raw}` : raw);
  }

  function sendJson(payload: Record<string, unknown>, label?: string): void {
    sendRaw(JSON.stringify({ version: protocolVersion, ...payload }), label);
  }

  // --- probes ---------------------------------------------------------------------------

  let customJson = $state(`{ "version": ${protocolVersion}, "type": "hello", "from": "custom" }`);

  // Latency: a ping is an echo round trip carrying a nonce + send time.
  let pendingPings = new Map<string, number>();
  let rttSamples = $state<number[]>([]);

  function sendPing(): void {
    const nonce = Math.random().toString(36).slice(2, 10);
    pendingPings.set(nonce, performance.now());
    sendJson({ type: "ping-probe", nonce }, "ping");
  }

  function handlePossiblePong(data: string): void {
    for (const [nonce, t0] of pendingPings) {
      if (data.includes(nonce)) {
        const rtt = performance.now() - t0;
        pendingPings.delete(nonce);
        rttSamples = [...rttSamples.slice(-49), rtt];
        append("info", `rtt ${rtt.toFixed(1)}ms`);
        return;
      }
    }
  }

  async function pingBurst(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
      sendPing();
      // Small spacing so samples are independent round trips, not one queue flush - the
      // sequential await is the point, not an accident.
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  const rttStats = $derived.by(() => {
    if (rttSamples.length === 0) return null;
    const sorted = rttSamples.toSorted((a, b) => a - b);
    const sum = rttSamples.reduce((total, sample) => total + sample, 0);
    return {
      count: rttSamples.length,
      min: sorted[0] ?? 0,
      avg: sum / rttSamples.length,
      max: sorted[sorted.length - 1] ?? 0,
    };
  });

  // Ordering: fire N numbered messages back to back; verify echoes return in sequence.
  // Buzz adjudication depends on the DO's single-threaded ordering, so this is the probe
  // that matters most for fairness confidence.
  let orderExpected: number[] = [];
  let orderSeen: number[] = [];
  let orderReport = $state("");

  function orderBurst(): void {
    orderExpected = Array.from({ length: 20 }, (_, index) => index);
    orderSeen = [];
    orderReport = "burst of 20 sent - awaiting echoes...";
    for (const sequence of orderExpected) {
      sendJson({ type: "order-probe", sequence }, `order #${String(sequence)}`);
    }
  }

  function handlePossibleOrderEcho(data: string): void {
    if (orderSeen.length >= orderExpected.length || orderExpected.length === 0) return;
    const match = /"sequence":\s*(\d+)/.exec(data);
    if (match?.[1] === undefined) return;
    orderSeen.push(Number(match[1]));
    if (orderSeen.length === orderExpected.length) {
      const inOrder = orderSeen.every((value, index) => value === index);
      orderReport = inOrder
        ? `PASS: all ${String(orderSeen.length)} echoes returned in send order`
        : `FAIL: out-of-order echoes - got [${orderSeen.join(", ")}]`;
      append("info", orderReport);
    }
  }
</script>

<svelte:head>
  <title>Dev: realtime harness</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 p-8">
  <h1 class="text-2xl font-bold">Realtime test harness</h1>
  <p class="text-sm">
    Target: <code>{REALTIME_ORIGIN || "(unset - dev builds use local wrangler)"}</code> · wire
    protocol v{protocolVersion}
  </p>

  <!-- status panel -->
  <div class="grid grid-cols-2 gap-x-6 gap-y-1 border p-3 text-sm sm:grid-cols-4">
    <span>state: <strong>{phase}</strong></span>
    <span>uptime: {seconds(openedAt)}</span>
    <span>idle: {seconds(lastActivityAt)}</span>
    <span>sent {sentCount} · recv {receivedCount}</span>
    {#if rttStats}
      <span class="col-span-2 sm:col-span-4">
        rtt ({rttStats.count} samples): min {rttStats.min.toFixed(1)}ms · avg {rttStats.avg.toFixed(1)}ms
        · max {rttStats.max.toFixed(1)}ms
      </span>
    {/if}
  </div>

  <!-- connection controls -->
  <div class="flex flex-wrap items-center gap-2">
    <label for="room-code">Room code</label>
    <input id="room-code" class="border px-2 py-1" bind:value={roomCode} maxlength="5" />
    <button class="border px-3 py-1" onclick={connect}>Connect</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={disconnect}>Disconnect</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={simulateDrop}>Simulate drop</button>
    <label class="flex items-center gap-1 text-sm">
      <input type="checkbox" bind:checked={autoReconnect} />
      auto-reconnect (3 tries, backoff)
    </label>
  </div>

  <!-- probes -->
  <fieldset class="flex flex-wrap items-center gap-2 border p-3">
    <legend class="px-1 text-sm">Probes</legend>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendJson({ type: "hello", from: "dev-echo-page" }, "hello")}>Hello</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={sendPing}>Ping</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={pingBurst}>Ping x10</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={orderBurst}>Order burst x20</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendRaw(JSON.stringify({ version: protocolVersion + 1, type: "hello" }), "stale version")}>Stale version</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendRaw("{not json", "malformed")}>Malformed JSON</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendJson({ type: "big-probe", filler: "x".repeat(64 * 1024) }, "64KB payload")}>64KB payload</button>
    {#if orderReport}
      <span class="w-full text-sm">{orderReport}</span>
    {/if}
    <p class="w-full text-xs opacity-70">
      Hibernation check: let idle exceed ~10s (watch the idle clock), then Ping - a normal rtt
      after a long idle proves the DO woke from hibernation with the connection intact.
    </p>
  </fieldset>

  <!-- custom sender -->
  <fieldset class="flex flex-col gap-2 border p-3">
    <legend class="px-1 text-sm">Custom message (raw - malformed input is allowed on purpose)</legend>
    <textarea class="border p-2 font-mono text-sm" rows="3" bind:value={customJson}></textarea>
    <div>
      <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendRaw(customJson, "custom")}>Send custom</button>
    </div>
  </fieldset>

  <!-- log -->
  <div class="flex items-center gap-2">
    <h2 class="text-sm font-bold">Log ({log.length}{log.length >= logLimit ? ", capped" : ""})</h2>
    <button class="border px-2 py-0.5 text-sm" disabled={log.length === 0} onclick={() => { log = []; }}>Clear</button>
    <button
      class="border px-2 py-0.5 text-sm"
      disabled={log.length === 0}
      onclick={async () => {
        await navigator.clipboard.writeText(
          log.map((entry) => `${entry.at} ${entry.dir.padEnd(4)} ${entry.text}`).join("\n"),
        );
        append("info", "log copied to clipboard");
      }}>Copy</button
    >
  </div>
  <pre class="min-h-40 overflow-x-auto border p-3 text-sm">{#each log as entry, index (index)}{entry.at} {entry.dir === "out" ? "->" : entry.dir === "in" ? "<-" : entry.dir === "err" ? "!!" : "--"} {entry.text}
{/each}</pre>
</main>
