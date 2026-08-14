<script lang="ts">
  // Realtime room harness (M3): create a real room, connect through the SINGLE ORIGIN
  // (wss://<page-origin>/room/<CODE>/ws forwarded over the cross-script DO binding), join
  // in any role, and probe the refusal/limit paths - the one-page browser verification of
  // the M3 connection architecture (docs/decisions/2026-08-13-single-origin-binding.md).
  // A deprecated "direct realtime origin" toggle survives for ops/debug: vite dev cannot
  // emulate the cross-script binding, so the direct dial is the harness's escape hatch
  // there (REALTIME_ORIGIN, see src/env.ts). /dev/* routes never ship links from product UI.
  import { REALTIME_ORIGIN } from "$app/env/public";
  import { protocolVersion } from "@jeopardy/protocol/envelope";
  import { generateRoomCode } from "@jeopardy/protocol/room/create";
  import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
  import { roomWebSocketUrl } from "#lib/realtime/room-url.ts";
  import { sampleGameDefinition } from "#lib/hotseat/sample-game.ts";

  type TargetMode = "same-origin" | "direct";
  let targetMode = $state<TargetMode>("same-origin");
  const directAvailable = REALTIME_ORIGIN !== "";

  let roomCode = $state("");
  let createdRoom = $state<{ code: string; hostToken: string; expiresAt: number } | null>(null);
  let log = $state<{ at: string; dir: "out" | "in" | "info" | "err"; text: string }[]>([]);
  let socket = $state<WebSocket | null>(null);
  let phase = $state<"disconnected" | "connecting" | "open">("disconnected");
  let joinedRole = $state<string | null>(null);
  let roomLifecycle = $state<string | null>(null);
  let sessionToken = $state<string | null>(null);
  let sentCount = $state(0);
  let receivedCount = $state(0);
  let openedAt = $state<number | null>(null);
  let lastActivityAt = $state<number | null>(null);
  let autoReconnect = $state(false);
  let reconnectAttempt = 0;
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

  function targetOrigin(): string {
    if (targetMode === "direct") return REALTIME_ORIGIN;
    return globalThis.location.origin;
  }

  // --- room creation (the explicit-create contract) ---------------------------------------

  let creating = $state(false);
  async function createRoom(): Promise<void> {
    creating = true;
    try {
      // The hotseat sample game as a REAL definition payload - the same document the
      // editor will send from "Host this game" (minimal settings: casual-party preset).
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          game: { kind: "definition", body: sampleGameDefinition.body },
          seed: `echo-harness-${String(Date.now())}`,
        }),
      });
      if (response.status === 503) {
        append(
          "err",
          "create needs the DO binding - run the single-origin dev loop (npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc, docs/DEVELOPMENT.md); vite dev cannot emulate it",
        );
        return;
      }
      if (!response.ok) {
        append("err", `create failed: ${String(response.status)}`);
        return;
      }
      const body = (await response.json()) as { code: string; hostToken: string; expiresAt: number };
      createdRoom = body;
      roomCode = body.code;
      append(
        "info",
        `room ${body.code} created - host token ${body.hostToken.slice(0, 8)}..., expires ${new Date(body.expiresAt).toISOString()}`,
      );
    } catch (error) {
      append("err", error instanceof Error ? error.message : String(error));
    } finally {
      creating = false;
    }
  }

  // --- connection lifecycle -----------------------------------------------------------------

  function connect(): void {
    disconnect();
    if (targetMode === "direct" && REALTIME_ORIGIN === "") {
      append("err", "no REALTIME_ORIGIN configured - direct mode is unavailable");
      return;
    }
    try {
      const url = roomWebSocketUrl(targetOrigin(), roomCode);
      phase = "connecting";
      append("info", `connecting to ${url} (${targetMode})`);
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        phase = "open";
        openedAt = Date.now();
        lastActivityAt = Date.now();
        reconnectAttempt = 0;
        append("info", "open - the room answers only after a join or resume message");
      });
      ws.addEventListener("message", (event) => {
        receivedCount += 1;
        lastActivityAt = Date.now();
        const data = String(event.data);
        trackServerMessage(data);
        append("in", data.length > 400 ? `${data.slice(0, 400)}... (${String(data.length)} chars)` : data);
      });
      ws.addEventListener("close", (event) => {
        phase = "disconnected";
        openedAt = null;
        joinedRole = null;
        append("info", `closed (code ${String(event.code)}${event.reason ? `, reason "${event.reason}"` : ""})`);
        if (autoReconnect && reconnectAttempt < 3) {
          reconnectAttempt += 1;
          const delay = 500 * 2 ** reconnectAttempt;
          append("info", `auto-reconnect ${String(reconnectAttempt)}/3 in ${String(delay)}ms`);
          setTimeout(() => {
            if (phase === "disconnected") connect();
          }, delay);
        }
      });
      ws.addEventListener("error", () =>
        append(
          "err",
          targetMode === "same-origin"
            ? "socket error - is the single-origin dev loop running? (multi-config wrangler dev, docs/DEVELOPMENT.md)"
            : "socket error - is the realtime worker running? (pnpm dev runs it on :8787)",
        ),
      );
      socket = ws;
    } catch (error) {
      phase = "disconnected";
      append("err", error instanceof Error ? error.message : String(error));
    }
  }

  function trackServerMessage(data: string): void {
    if (data === "pong") {
      handlePong();
      return;
    }
    const parsed = parseRoomServerMessage(data);
    if (!parsed.ok) return;
    const message = parsed.message;
    if (message.type === "welcome") {
      joinedRole = message.role;
      sessionToken = message.sessionToken;
    }
    if (message.type === "snapshot") roomLifecycle = message.phase;
    if (message.type === "room-closed") roomLifecycle = `closed (${message.reason})`;
  }

  function disconnect(): void {
    reconnectAttempt = 3; // a deliberate disconnect should not fight the user
    socket?.close(1000, "user disconnect");
    socket = null;
    joinedRole = null;
  }

  function simulateDrop(): void {
    append("info", "simulating connection drop (close 4000)");
    socket?.close(4000, "simulated drop");
    socket = null;
  }

  // --- send helpers ---------------------------------------------------------------------------

  function sendRaw(raw: string, label?: string): void {
    if (socket === null || phase !== "open") {
      append("err", "not connected");
      return;
    }
    socket.send(raw);
    sentCount += 1;
    lastActivityAt = Date.now();
    append("out", label ? `${label}: ${raw.length > 200 ? `${raw.slice(0, 200)}... (${String(raw.length)} chars)` : raw}` : raw);
  }

  function sendJson(payload: Record<string, unknown>, label?: string): void {
    sendRaw(JSON.stringify({ version: protocolVersion, ...payload }), label);
  }

  // --- probes ---------------------------------------------------------------------------------

  // Refusal-path probe (owner-requested): connect to a code nobody created and EXPECT the
  // no-such-room refusal - one-click proof that connecting never creates a room.
  let uncreatedProbe = $state<"idle" | "running" | "pass" | "fail">("idle");
  function probeUncreatedRoom(): void {
    const code = generateRoomCode();
    uncreatedProbe = "running";
    append("info", `probing uncreated room ${code} - EXPECTING a no-such-room refusal`);
    try {
      const ws = new WebSocket(roomWebSocketUrl(targetOrigin(), code));
      const verdict = (pass: boolean, text: string) => {
        if (uncreatedProbe === "running") {
          uncreatedProbe = pass ? "pass" : "fail";
          append(pass ? "info" : "err", text);
        }
      };
      ws.addEventListener("message", (event) => {
        const parsed = parseRoomServerMessage(String(event.data));
        if (parsed.ok && parsed.message.type === "refused" && parsed.message.reason === "no-such-room") {
          verdict(true, "PASS: uncreated room refused with no-such-room (connects never create)");
        } else {
          verdict(false, `FAIL: expected a no-such-room refusal, got ${String(event.data)}`);
        }
        ws.close();
      });
      ws.addEventListener("close", (event) => {
        // Close 4404 without a frame still proves the refusal contract.
        verdict(event.code === 4404, `probe socket closed (code ${String(event.code)})`);
      });
      ws.addEventListener("error", () => verdict(false, "FAIL: probe socket errored before any refusal"));
    } catch (error) {
      uncreatedProbe = "fail";
      append("err", error instanceof Error ? error.message : String(error));
    }
  }

  // Latency probe over the runtime's ping/pong auto-response pair: answered WITHOUT waking
  // the DO, so a normal rtt after a long idle proves hibernation kept the socket alive.
  let pingSentAt: number | null = null;
  let rttSamples = $state<number[]>([]);
  function sendPing(): void {
    pingSentAt = performance.now();
    sendRaw("ping", "ping (runtime auto-response)");
  }
  function handlePong(): void {
    if (pingSentAt === null) return;
    const rtt = performance.now() - pingSentAt;
    pingSentAt = null;
    rttSamples = [...rttSamples.slice(-49), rtt];
    append("info", `rtt ${rtt.toFixed(1)}ms`);
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

  let customJson = $state(`{ "version": ${String(protocolVersion)}, "type": "sync" }`);
</script>

<svelte:head>
  <title>Dev: realtime room harness</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 p-8">
  <h1 class="text-2xl font-bold">Realtime room harness</h1>
  <p class="text-sm">
    Wire protocol v{protocolVersion}. Single origin is the M3 architecture; create a room, then
    connect and join. The direct-origin toggle is deprecated ops/debug plumbing.
  </p>

  <!-- room creation -->
  <fieldset class="flex flex-wrap items-center gap-2 border p-3">
    <legend class="px-1 text-sm">Room (creation is explicit - connecting never creates)</legend>
    <button class="border px-3 py-1" disabled={creating} onclick={createRoom}>
      {creating ? "Creating..." : "Create room (sample game)"}
    </button>
    <button
      class="border px-3 py-1"
      class:bg-green-100={uncreatedProbe === "pass"}
      class:bg-red-100={uncreatedProbe === "fail"}
      onclick={probeUncreatedRoom}
    >
      Connect to uncreated room {uncreatedProbe === "pass" ? "- PASS" : uncreatedProbe === "fail" ? "- FAIL" : "(expect refusal)"}
    </button>
    {#if createdRoom}
      <span class="w-full text-sm">
        created <strong>{createdRoom.code}</strong> · host token
        <code>{createdRoom.hostToken.slice(0, 8)}...</code> · expires
        {new Date(createdRoom.expiresAt).toLocaleTimeString()}
      </span>
    {/if}
  </fieldset>

  <!-- status panel -->
  <div class="grid grid-cols-2 gap-x-6 gap-y-1 border p-3 text-sm sm:grid-cols-4">
    <span>
      mode:
      <strong>{targetMode}</strong>
    </span>
    <span>state: <strong>{phase}</strong></span>
    <span>role: <strong>{joinedRole ?? "-"}</strong></span>
    <span>room: <strong>{roomLifecycle ?? "-"}</strong></span>
    <span>uptime: {seconds(openedAt)}</span>
    <span>idle: {seconds(lastActivityAt)}</span>
    <span>sent {sentCount} · recv {receivedCount}</span>
    <span>token: {sessionToken === null ? "-" : `${sessionToken.slice(0, 6)}...`}</span>
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
    <input id="room-code" class="border px-2 py-1 uppercase" bind:value={roomCode} maxlength="5" />
    <button class="border px-3 py-1" disabled={roomCode.length !== 5} onclick={connect}>Connect</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={disconnect}>Disconnect</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={simulateDrop}>Simulate drop</button>
    <label class="flex items-center gap-1 text-sm">
      <input type="checkbox" bind:checked={autoReconnect} />
      auto-reconnect (3 tries, backoff)
    </label>
    {#if directAvailable}
      <label class="flex items-center gap-1 text-sm opacity-70">
        <input
          type="checkbox"
          checked={targetMode === "direct"}
          onchange={(event) => {
            targetMode = event.currentTarget.checked ? "direct" : "same-origin";
          }}
        />
        direct realtime origin ({REALTIME_ORIGIN}) - deprecated
      </label>
    {/if}
  </div>

  <!-- join + role actions -->
  <fieldset class="flex flex-wrap items-center gap-2 border p-3">
    <legend class="px-1 text-sm">Join (the room answers nothing until you do)</legend>
    <button
      class="border px-3 py-1"
      disabled={phase !== "open" || createdRoom === null || createdRoom.code !== roomCode}
      onclick={() => sendJson({ type: "join", role: "host", hostToken: createdRoom?.hostToken }, "join host")}
    >
      Join as host
    </button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendJson({ type: "join", role: "player", nickname: "Echo Tester" }, "join player")}>
      Join as player
    </button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendJson({ type: "join", role: "spectator" }, "join spectator")}>
      Join as spectator
    </button>
    <button class="border px-3 py-1" disabled={phase !== "open" || sessionToken === null} onclick={() => sendJson({ type: "resume", sessionToken }, "resume")}>
      Resume with token
    </button>
    <button class="border px-3 py-1" disabled={joinedRole !== "host"} onclick={() => sendJson({ type: "action", action: { type: "start-game" } }, "start-game")}>
      Start game
    </button>
    <button class="border px-3 py-1" disabled={joinedRole !== "host"} onclick={() => sendJson({ type: "action", action: { type: "arm-buzzers" } }, "arm")}>
      Arm buzzers
    </button>
    <button class="border px-3 py-1" disabled={joinedRole !== "player"} onclick={() => sendJson({ type: "action", action: { type: "buzz" } }, "buzz")}>
      Buzz
    </button>
    <button class="border px-3 py-1" disabled={joinedRole === null} onclick={() => sendJson({ type: "sync" }, "sync")}>
      Sync snapshot
    </button>
  </fieldset>

  <!-- probes -->
  <fieldset class="flex flex-wrap items-center gap-2 border p-3">
    <legend class="px-1 text-sm">Probes</legend>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={sendPing}>Ping</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendRaw(JSON.stringify({ version: protocolVersion + 1, type: "sync" }), "stale version")}>Stale version</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendRaw("{not json", "malformed")}>Malformed JSON</button>
    <button class="border px-3 py-1" disabled={phase !== "open"} onclick={() => sendJson({ type: "sync", ext: { "com.example.filler": "x".repeat(8 * 1024) } }, "8KB payload")}>Oversized payload</button>
    <p class="w-full text-xs opacity-70">
      Hibernation check: let idle exceed ~10s, then Ping - the pong comes from the runtime
      auto-response (the DO never wakes), and a follow-up Sync proves full state survived.
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
