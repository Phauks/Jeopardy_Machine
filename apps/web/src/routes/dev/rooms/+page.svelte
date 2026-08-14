<script lang="ts">
  // The room instrument panel: create rooms, connect through the single origin, and probe
  // describing it three milestones ago). Three columns, by owner direction:
  //
  //   left   - Rooms:      create, and every room THIS TAB made, with delete + connect
  //   middle - Connection: socket/room state, join controls, action probes, the DO inspector
  //   right  - Log:        full height, filterable, compact or verbose bodies
  //
  // plus a Lobby panel (auto-refreshing, with the registry's health stated out loud) and a
  // clearly separated Test area for the refusal probes - assertions, not controls.
  //
  // Single origin, always: rooms connect to wss://<this page's origin>/room/<CODE>/ws and the
  // web Worker forwards to the DO over the cross-script binding. The old direct-realtime-origin
  // toggle is DELETED (docs/decisions/2026-08-13-single-origin-binding.md, 2026-08-14). vite
  // dev cannot serve rooms at all - it has no binding - and the page says so instead of
  // failing quietly; use the single-origin wrangler loop (docs/DEVELOPMENT.md).
  //
  // /dev/* routes are never linked from product UI.
  import DoInspector from "#lib/dev/harness/do-inspector.svelte";
  import RegistryStatusLine from "#lib/lobby/registry-status-line.svelte";
  import { limits } from "@jeopardy/protocol/limits";
  import { protocolVersion } from "@jeopardy/protocol/envelope";
  import { generateRoomCode } from "@jeopardy/protocol/room/create";
  import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
  import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
  import { recallRoomPassword } from "#lib/lobby/join-hand-off.ts";
  import { roomWebSocketUrl } from "#lib/realtime/room-url.ts";
  import { sampleGameDefinition } from "#lib/hotseat/sample-game.ts";
  import { formatRoomAge } from "#lib/lobby/room-age.ts";
  import { summarizeRegistryStatus } from "#lib/lobby/registry-status.ts";
  import {
    appendLogEntry,
    filterLog,
    formatLogLine,
    logLimit,
    logToText,
    stampNow,
  } from "#lib/dev/harness/harness-log.ts";
  import {
    describeLobbyPresence,
    forgetSessionRoom,
    formatCountdown,
    lobbyPresence,
    markSessionRoomClosed,
    rememberSessionRoom,
  } from "#lib/dev/harness/session-rooms.ts";
  import {
    describeObservation,
    judgeProbe,
    refusalProbes,
  } from "#lib/dev/harness/refusal-probes.ts";
  import type { LogDirection, LogEntry, LogFilter } from "#lib/dev/harness/harness-log.ts";
  import type { ProbeId, ProbeObservation } from "#lib/dev/harness/refusal-probes.ts";
  import type { SessionRoom } from "#lib/dev/harness/session-rooms.ts";
  import type { CreateRoomResponse } from "@jeopardy/protocol/room/create";
  import type { RoomInspection } from "@jeopardy/protocol/room/diagnostics";
  import type { LobbyListing } from "@jeopardy/protocol/room/registry";

  // The lobby panel watches; it does not play. One minute (owner direction) rather than the
  // product's limits.lobby.listingRefreshMs, which paces a room full of phones deciding where
  // to sit - a different job with a different cadence.
  const lobbyAutoRefreshMs = 60_000;

  // ---- clock (one timer drives every countdown on the page) ---------------------------------

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 500);
    return () => clearInterval(timer);
  });

  // ---- log ---------------------------------------------------------------------------------

  let log = $state<LogEntry[]>([]);
  let logFilter = $state<LogFilter>("all");
  let compactBodies = $state(true);
  const visibleLog = $derived(filterLog(log, logFilter));

  function append(dir: LogDirection, text: string): void {
    log = appendLogEntry(log, { at: stampNow(), dir, text });
  }

  // ---- rooms this tab created ---------------------------------------------------------------

  let sessionRooms = $state<SessionRoom[]>([]);
  let roomCode = $state("");
  let newRoomVisibility = $state<"public" | "unlisted">("public");
  let newRoomTitle = $state("Harness room");
  let newRoomHostLabel = $state("Harness");
  let newRoomPassword = $state("");
  let newRoomSource = $state<"sample" | "compact">("sample");
  let creating = $state(false);
  // The password THIS harness presents when joining (prefilled from creation or the lobby).
  let joinPassword = $state("");

  const selectedRoom = $derived(sessionRooms.find((room) => room.code === roomCode) ?? null);

  // The hotseat sample game as a REAL definition payload (the same document the editor will
  // send from "Host this game"), or the compact board the bots and workerd suites use.
  function gamePayload(): Record<string, unknown> {
    if (newRoomSource === "compact") {
      return { kind: "compact", rounds: [{ columns: 3, rows: 3 }], hasFinalClue: false };
    }
    return { kind: "definition", body: sampleGameDefinition.body };
  }

  async function createRoom(): Promise<void> {
    creating = true;
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          game: gamePayload(),
          seed: `harness-${String(Date.now())}`,
          visibility: newRoomVisibility,
          title: newRoomTitle,
          hostLabel: newRoomHostLabel,
          ...(newRoomPassword !== "" && { password: newRoomPassword }),
        }),
      });
      if (response.status === 503) {
        append(
          "err",
          "create needs the DO binding - vite dev cannot serve rooms at all. Run the single-origin loop: npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc (docs/DEVELOPMENT.md)",
        );
        return;
      }
      if (!response.ok) {
        append("err", `create failed: ${String(response.status)}`);
        return;
      }
      const body = (await response.json()) as CreateRoomResponse;
      // ADDS, never replaces: the previous rooms are still alive, and the old harness losing
      // them from the screen is what "creating a room deletes a previously created room" was.
      sessionRooms = rememberSessionRoom(sessionRooms, {
        code: body.code,
        title: newRoomTitle,
        hostLabel: newRoomHostLabel,
        visibility: body.visibility,
        hasPassword: body.hasPassword,
        hostToken: body.hostToken,
        password: newRoomPassword,
        createdAt: Date.now(),
        expiresAt: body.expiresAt,
        registry: body.registry,
        closedAt: null,
      });
      roomCode = body.code;
      joinPassword = newRoomPassword;
      append(
        "info",
        `room ${body.code} created (${body.visibility}${body.hasPassword ? ", password" : ", open"}) - expires ${new Date(body.expiresAt).toLocaleTimeString()} - ${summarizeRegistryStatus(body.registry)}`,
      );
      if (body.registry.status !== "ok") {
        append(
          "err",
          `room ${body.code} exists but was NOT written to the lobby registry (${body.registry.reason}) - it cannot appear in the public list until that is fixed`,
        );
      }
      void refreshLobby();
    } catch (error) {
      append("err", error instanceof Error ? error.message : String(error));
    } finally {
      creating = false;
    }
  }

  // Closing a room for real: host-authenticated DELETE, which ends the room in the DO (every
  // client gets the polite screen) and removes its lobby row.
  async function deleteRoom(room: SessionRoom): Promise<void> {
    try {
      const response = await fetch(`/api/rooms/${room.code}`, {
        method: "DELETE",
        // The content-type is not decoration: SvelteKit's CSRF guard rejects non-GET requests
        // that look like cross-site FORM submissions, and a DELETE with no content type
        // qualifies. Browsers add an Origin header too, but curl does not - so the same call
        // works from a terminal (docs/DEVELOPMENT.md) only with this header present.
        headers: { [hostTokenHeader]: room.hostToken, "content-type": "application/json" },
      });
      if (!response.ok) {
        append("err", `delete ${room.code} failed: ${String(response.status)}`);
        return;
      }
      const body = (await response.json()) as { registry: LobbyListing["registry"] };
      sessionRooms = markSessionRoomClosed(sessionRooms, room.code, Date.now());
      append("info", `room ${room.code} closed - ${summarizeRegistryStatus(body.registry)}`);
      void refreshLobby();
    } catch (error) {
      append("err", error instanceof Error ? error.message : String(error));
    }
  }

  // ---- the public lobby ----------------------------------------------------------------------
  //
  // Only PUBLIC rooms can ever be listed: Durable Objects have no enumeration API, so the list
  // is exactly the D1 registry projection, and unlisted rooms deliberately have no row to find
  // (docs/decisions/2026-08-14-room-visibility-and-lobby.md).

  let lobby = $state<LobbyListing | null>(null);
  let lobbyLoading = $state(false);
  let lobbyFetchedAt = $state<number | null>(null);
  const secondsToRefresh = $derived(
    lobbyFetchedAt === null
      ? 0
      : Math.max(0, Math.ceil((lobbyFetchedAt + lobbyAutoRefreshMs - now) / 1000)),
  );

  async function refreshLobby(): Promise<void> {
    lobbyLoading = true;
    try {
      const response = await fetch("/api/rooms");
      if (!response.ok) {
        append("err", `lobby query failed: ${String(response.status)}`);
        return;
      }
      lobby = (await response.json()) as LobbyListing;
      append(
        "info",
        `lobby: ${String(lobby.rooms.length)} public room(s) · ${summarizeRegistryStatus(lobby.registry)}`,
      );
    } catch (error) {
      append("err", error instanceof Error ? error.message : String(error));
    } finally {
      lobbyFetchedAt = Date.now();
      lobbyLoading = false;
    }
  }

  $effect(() => {
    void refreshLobby();
    const timer = setInterval(() => void refreshLobby(), lobbyAutoRefreshMs);
    return () => clearInterval(timer);
  });

  // Arriving from the lobby hand-off (/?code=... -> /dev/rooms?code=XXXXX): take the code from
  // the URL and the password from sessionStorage, which is where the lobby left it.
  $effect(() => {
    const fromLobby = new URL(globalThis.location.href).searchParams.get("code");
    if (fromLobby === null || roomCode !== "") return;
    roomCode = fromLobby.toUpperCase();
    joinPassword = recallRoomPassword(roomCode);
    append("info", `arrived from the lobby with room ${roomCode}`);
  });

  // ---- connection lifecycle -------------------------------------------------------------------

  let socket = $state<WebSocket | null>(null);
  let phase = $state<"disconnected" | "connecting" | "open">("disconnected");
  let joinedRole = $state<string | null>(null);
  let roomLifecycle = $state<string | null>(null);
  let roomPaused = $state(false);
  let rosterCounts = $state<{ players: number; teams: number } | null>(null);
  let sessionToken = $state<string | null>(null);
  let sentCount = $state(0);
  let receivedCount = $state(0);
  let openedAt = $state<number | null>(null);
  let lastActivityAt = $state<number | null>(null);
  let autoReconnect = $state(false);
  let reconnectAttempt = 0;

  function seconds(fromMs: number | null): string {
    if (fromMs === null) return "-";
    return `${((now - fromMs) / 1000).toFixed(0)}s`;
  }

  function connect(): void {
    disconnect();
    try {
      const url = roomWebSocketUrl(roomCode);
      phase = "connecting";
      append("info", `connecting to ${url}`);
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
        append("in", data);
      });
      ws.addEventListener("close", (event) => {
        phase = "disconnected";
        openedAt = null;
        joinedRole = null;
        append(
          "info",
          `closed (code ${String(event.code)}${event.reason ? `, reason "${event.reason}"` : ""})`,
        );
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
          "socket error - is the single-origin dev loop running? (multi-config wrangler dev, docs/DEVELOPMENT.md). vite dev has no DO binding and cannot serve rooms.",
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
    if (message.type === "snapshot") {
      roomLifecycle = message.phase;
      roomPaused = message.paused;
      rosterCounts = {
        players: message.roster.players.length,
        teams: message.roster.teams.length,
      };
    }
    if (message.type === "roster") {
      rosterCounts = {
        players: message.roster.players.length,
        teams: message.roster.teams.length,
      };
    }
    if (message.type === "paused") roomPaused = message.paused;
    if (message.type === "room-closed") {
      roomLifecycle = `closed (${message.reason})`;
      sessionRooms = markSessionRoomClosed(sessionRooms, roomCode, Date.now());
    }
    // A refusal or error may be the answer a running probe is waiting for.
    if (message.type === "refused") {
      settleProbe({ type: "refused", reason: message.reason });
    }
    if (message.type === "error") {
      settleProbe({ type: "error", reason: message.reason });
    }
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

  // ---- send helpers ---------------------------------------------------------------------------

  function sendRaw(raw: string, label?: string): void {
    if (socket === null || phase !== "open") {
      append("err", "not connected");
      return;
    }
    socket.send(raw);
    sentCount += 1;
    lastActivityAt = Date.now();
    append("out", label === undefined ? raw : `${label}: ${raw}`);
  }

  function sendJson(payload: Record<string, unknown>, label?: string): void {
    sendRaw(JSON.stringify({ version: protocolVersion, ...payload }), label);
  }

  // ---- latency + hibernation ------------------------------------------------------------------
  //
  // The runtime's ping/pong auto-response pair is answered WITHOUT waking the DO, so a normal
  // rtt after a long idle proves hibernation kept the socket alive.

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

  // ---- the DO inspector -------------------------------------------------------------------------

  let inspection = $state<RoomInspection | null>(null);
  let inspectionError = $state<string | null>(null);
  let inspecting = $state(false);

  async function inspectRoom(): Promise<void> {
    const room = selectedRoom;
    if (room === null) {
      inspectionError = "inspecting is host-authenticated - pick a room this tab created";
      return;
    }
    inspecting = true;
    try {
      const response = await fetch(`/api/rooms/${room.code}`, {
        headers: { [hostTokenHeader]: room.hostToken },
      });
      if (!response.ok) {
        inspectionError = `inspect failed: ${String(response.status)}`;
        inspection = null;
        return;
      }
      inspection = (await response.json()) as RoomInspection;
      inspectionError = null;
    } catch (error) {
      inspectionError = error instanceof Error ? error.message : String(error);
    } finally {
      inspecting = false;
    }
  }

  // ---- test area: refusal probes ----------------------------------------------------------------

  type ProbeState = { verdict: "pass" | "fail" | null; actual: string | null; running: boolean };
  let probeStates = $state<Record<string, ProbeState>>({});
  // Which probe is waiting on the main socket's next refusal/error frame.
  let pendingProbe: ProbeId | null = null;

  function probeState(id: ProbeId): ProbeState {
    return probeStates[id] ?? { verdict: null, actual: null, running: false };
  }

  function beginProbe(id: ProbeId): void {
    probeStates = { ...probeStates, [id]: { verdict: null, actual: null, running: true } };
  }

  function finishProbe(id: ProbeId, observed: ProbeObservation): void {
    const verdict = judgeProbe(id, observed);
    const actual = describeObservation(observed);
    probeStates = { ...probeStates, [id]: { verdict, actual, running: false } };
    append(verdict === "pass" ? "info" : "err", `probe ${id}: ${verdict.toUpperCase()} - ${actual}`);
  }

  // Frames arriving on the MAIN socket settle whichever probe armed itself last.
  function settleProbe(observed: ProbeObservation): void {
    if (pendingProbe === null) return;
    const id = pendingProbe;
    pendingProbe = null;
    finishProbe(id, observed);
  }

  function armSocketProbe(id: ProbeId, send: () => void): void {
    beginProbe(id);
    pendingProbe = id;
    send();
    // No answer at all is itself a failure - the room owes every refusal a frame.
    setTimeout(() => {
      if (pendingProbe === id) {
        pendingProbe = null;
        finishProbe(id, {});
      }
    }, 3000);
  }

  // Connection-level probe: its own socket, because the point is what happens to a connection
  // that should never have been accepted.
  function probeUncreatedRoom(): void {
    const code = generateRoomCode();
    beginProbe("uncreated-room");
    append("info", `probing uncreated room ${code} - EXPECTING a no-such-room refusal`);
    try {
      const ws = new WebSocket(roomWebSocketUrl(code));
      let settled = false;
      const settle = (observed: ProbeObservation) => {
        if (settled) return;
        settled = true;
        finishProbe("uncreated-room", observed);
      };
      ws.addEventListener("message", (event) => {
        const parsed = parseRoomServerMessage(String(event.data));
        settle(
          parsed.ok && parsed.message.type === "refused"
            ? { type: "refused", reason: parsed.message.reason }
            : { type: String(event.data).slice(0, 60) },
        );
        ws.close();
      });
      ws.addEventListener("close", (event) => settle({ closeCode: event.code }));
      ws.addEventListener("error", () => settle({}));
    } catch (error) {
      finishProbe("uncreated-room", { type: error instanceof Error ? error.message : "threw" });
    }
  }

  // Wrong password on a SEPARATE socket: a refused join must leave no trace in the room, and
  // running it on the main connection would risk spending this tab's own attempt budget.
  function probeWrongPassword(): void {
    const room = selectedRoom;
    if (room === null || !room.hasPassword) return;
    beginProbe("wrong-password");
    try {
      const ws = new WebSocket(roomWebSocketUrl(room.code));
      let settled = false;
      const settle = (observed: ProbeObservation) => {
        if (settled) return;
        settled = true;
        finishProbe("wrong-password", observed);
        ws.close();
      };
      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            version: protocolVersion,
            type: "join",
            role: "player",
            nickname: "Wrong Password Probe",
            password: `definitely-not-${room.password}`,
          }),
        );
      });
      ws.addEventListener("message", (event) => {
        const parsed = parseRoomServerMessage(String(event.data));
        if (!parsed.ok) return;
        settle({ type: parsed.message.type, reason: "reason" in parsed.message ? parsed.message.reason : undefined });
      });
      ws.addEventListener("error", () => settle({}));
    } catch (error) {
      finishProbe("wrong-password", { type: error instanceof Error ? error.message : "threw" });
    }
  }

  function probeRateLimit(): void {
    // The HOST is exempt from the message-rate cap by design (it authenticated with the
    // creation token and legitimately bursts), so this probe only means anything as a player
    // or spectator - the button is disabled for a host connection.
    armSocketProbe("rate-limit-burst", () => {
      for (let index = 0; index < limits.wire.clientMessagesPerSecondMax + 5; index += 1) {
        sendJson({ type: "sync" }, "burst");
      }
    });
  }

  let customJson = $state(`{ "version": ${String(protocolVersion)}, "type": "sync" }`);
</script>

<svelte:head>
  <title>Dev: room instrument panel</title>
</svelte:head>

<main class="flex min-h-screen flex-col gap-4 p-4">
  <header class="flex flex-wrap items-baseline justify-between gap-2">
    <h1 class="text-2xl font-bold">Room instrument panel</h1>
    <p class="text-sm opacity-80">
      Wire protocol v{protocolVersion}. Single origin only - every socket goes to this page's
      own origin. Rooms need the DO binding: run the multi-config wrangler loop
      (docs/DEVELOPMENT.md); vite dev cannot serve rooms at all.
    </p>
  </header>

  <div class="grid items-start gap-4 lg:grid-cols-3">
    <!-- ==================== LEFT: rooms ==================== -->
    <div class="flex flex-col gap-4">
      <section class="flex flex-col gap-2 rounded-sm border p-3">
        <h2 class="font-bold">Create a room</h2>
        <p class="text-xs opacity-70">
          Creation is explicit - connecting to a code never creates a room.
        </p>
        <label class="flex items-center justify-between gap-2 text-sm">
          listing
          <select class="border px-2 py-1" bind:value={newRoomVisibility}>
            <option value="public">public (shows in the lobby)</option>
            <option value="unlisted">unlisted (code only)</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-2 text-sm">
          game
          <select class="border px-2 py-1" bind:value={newRoomSource}>
            <option value="sample">sample game definition (authored clues)</option>
            <option value="compact">compact 3x3 board (no content)</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-2 text-sm">
          title
          <input
            class="w-48 border px-2 py-1"
            maxlength={limits.room.roomTitleMaxLength}
            bind:value={newRoomTitle}
          />
        </label>
        <label class="flex items-center justify-between gap-2 text-sm">
          host label
          <input
            class="w-48 border px-2 py-1"
            maxlength={limits.room.hostLabelMaxLength}
            bind:value={newRoomHostLabel}
          />
        </label>
        <label class="flex items-center justify-between gap-2 text-sm">
          password
          <input
            class="w-48 border px-2 py-1"
            placeholder="(open room)"
            maxlength={limits.room.roomPasswordMaxLength}
            bind:value={newRoomPassword}
          />
        </label>
        <button class="border px-3 py-1" disabled={creating} onclick={createRoom}>
          {creating ? "Creating..." : "Create room"}
        </button>
      </section>

      <section class="flex flex-col gap-2 rounded-sm border p-3">
        <h2 class="font-bold">Rooms this tab created ({sessionRooms.length})</h2>
        {#if sessionRooms.length === 0}
          <p class="text-sm opacity-70">None yet. Creating a room adds a row here; it never
            replaces the previous one.</p>
        {/if}
        <ul class="flex flex-col gap-2">
          {#each sessionRooms as room (room.code)}
            {@const presence = lobbyPresence(room, lobby)}
            <li class="flex flex-col gap-1 rounded-sm border p-2 text-sm">
              <div class="flex flex-wrap items-baseline gap-2">
                <strong class="text-base">{room.code}</strong>
                <span class="opacity-70">{room.title}</span>
                <span class="opacity-70">
                  {room.visibility}{room.hasPassword ? " · locked" : " · open"}
                </span>
              </div>
              <div class="flex flex-wrap gap-2 text-xs">
                <span data-presence={presence}>{describeLobbyPresence(presence)}</span>
                <span class="opacity-70">created {formatRoomAge(room.createdAt, now)}</span>
                <span class="opacity-70">
                  expires in {formatCountdown(room.expiresAt - now)}
                </span>
              </div>
              {#if room.registry.status !== "ok"}
                <p class="text-xs">
                  Not written to the registry ({room.registry.reason}) - this room exists and
                  can be joined by code, but it cannot appear in the lobby.
                </p>
              {/if}
              <div class="flex flex-wrap gap-2">
                <button
                  class="border px-2 py-0.5 text-xs"
                  onclick={() => {
                    roomCode = room.code;
                    joinPassword = room.password;
                  }}
                >
                  Use
                </button>
                <button
                  class="border px-2 py-0.5 text-xs"
                  onclick={() => {
                    roomCode = room.code;
                    joinPassword = room.password;
                    connect();
                  }}
                >
                  Connect
                </button>
                <button
                  class="border px-2 py-0.5 text-xs"
                  disabled={room.closedAt !== null}
                  onclick={() => deleteRoom(room)}
                >
                  {room.closedAt === null ? "Delete (close room)" : "Closed"}
                </button>
                <button
                  class="border px-2 py-0.5 text-xs"
                  onclick={() => {
                    sessionRooms = forgetSessionRoom(sessionRooms, room.code);
                  }}
                >
                  Forget row
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </section>

      <section class="flex flex-col gap-2 rounded-sm border p-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="font-bold">Public lobby ({lobby?.rooms.length ?? 0})</h2>
          <span class="text-xs opacity-70">
            auto-refresh in {secondsToRefresh}s
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="border px-2 py-0.5 text-sm" disabled={lobbyLoading} onclick={refreshLobby}>
            {lobbyLoading ? "Refreshing..." : "Refresh now"}
          </button>
          <span class="text-xs opacity-70">
            GET /api/rooms · every {lobbyAutoRefreshMs / 1000}s
          </span>
        </div>
        {#if lobby !== null}
          <RegistryStatusLine status={lobby.registry} />
        {/if}
        {#if lobby !== null && lobby.rooms.length === 0}
          <p class="text-sm opacity-70">
            No public rooms live. Unlisted rooms are invisible here by design - a DO cannot be
            enumerated, and an unlisted room writes no registry row.
          </p>
        {/if}
        <ul class="flex flex-col gap-1 text-sm">
          {#each lobby?.rooms ?? [] as room (room.code)}
            <li class="flex flex-wrap items-center gap-2 rounded-sm border p-2">
              <strong>{room.code}</strong>
              <span class="opacity-70">{room.title}</span>
              <span class="text-xs opacity-70">
                {room.phase} · {room.playerCount}/{room.playerCap}{room.hasPassword
                  ? " · locked"
                  : ""}
              </span>
              <button
                class="border px-2 py-0.5 text-xs"
                onclick={() => {
                  roomCode = room.code;
                  connect();
                }}
              >
                Join this room
              </button>
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <!-- ==================== MIDDLE: connection + room state ==================== -->
    <div class="flex flex-col gap-4">
      <section class="flex flex-col gap-2 rounded-sm border p-3">
        <h2 class="font-bold">Connection</h2>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <span>mode: <strong>same-origin</strong></span>
          <span>socket: <strong>{phase}</strong></span>
          <span>role: <strong>{joinedRole ?? "-"}</strong></span>
          <span>room: <strong>{roomLifecycle ?? "-"}</strong></span>
          <span>uptime: {seconds(openedAt)}</span>
          <span>idle: {seconds(lastActivityAt)}</span>
          <span>sent {sentCount} · recv {receivedCount}</span>
          <span>token: {sessionToken === null ? "-" : `${sessionToken.slice(0, 6)}...`}</span>
          <span>paused: {roomPaused ? "yes" : "no"}</span>
          <span>
            roster: {rosterCounts === null
              ? "-"
              : `${rosterCounts.players} players · ${rosterCounts.teams} teams`}
          </span>
          {#if rttStats}
            <span class="col-span-2">
              rtt ({rttStats.count}): min {rttStats.min.toFixed(1)}ms · avg
              {rttStats.avg.toFixed(1)}ms · max {rttStats.max.toFixed(1)}ms
            </span>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-sm" for="room-code">Room code</label>
          <input
            id="room-code"
            class="w-24 border px-2 py-1 uppercase"
            bind:value={roomCode}
            maxlength={limits.room.roomCodeLength}
          />
          <button
            class="border px-3 py-1"
            disabled={roomCode.length !== limits.room.roomCodeLength}
            onclick={connect}>Connect</button
          >
          <button class="border px-3 py-1" disabled={phase !== "open"} onclick={disconnect}>
            Disconnect
          </button>
          <button class="border px-3 py-1" disabled={phase !== "open"} onclick={simulateDrop}>
            Simulate drop
          </button>
          <label class="flex items-center gap-1 text-sm">
            <input type="checkbox" bind:checked={autoReconnect} />
            auto-reconnect
          </label>
        </div>
      </section>

      <section class="flex flex-col gap-2 rounded-sm border p-3">
        <h2 class="font-bold">Join</h2>
        <p class="text-xs opacity-70">The room answers nothing until you join or resume.</p>
        <label class="flex items-center justify-between gap-2 text-sm">
          room password
          <input
            class="w-48 border px-2 py-1"
            placeholder="(none)"
            maxlength={limits.room.roomPasswordMaxLength}
            bind:value={joinPassword}
          />
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            class="border px-3 py-1 text-sm"
            disabled={phase !== "open" || selectedRoom === null}
            onclick={() =>
              sendJson({ type: "join", role: "host", hostToken: selectedRoom?.hostToken }, "join host")}
          >
            Join as host
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={phase !== "open"}
            onclick={() =>
              sendJson(
                {
                  type: "join",
                  role: "player",
                  nickname: "Harness Tester",
                  ...(joinPassword !== "" && { password: joinPassword }),
                },
                "join player",
              )}
          >
            Join as player
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={phase !== "open"}
            onclick={() =>
              sendJson(
                {
                  type: "join",
                  role: "spectator",
                  ...(joinPassword !== "" && { password: joinPassword }),
                },
                "join spectator",
              )}
          >
            Join as spectator
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={phase !== "open"}
            onclick={() =>
              sendJson(
                {
                  type: "join",
                  role: "display",
                  ...(joinPassword !== "" && { password: joinPassword }),
                },
                "join display",
              )}
          >
            Join as display
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={phase !== "open" || sessionToken === null}
            onclick={() => sendJson({ type: "resume", sessionToken }, "resume")}
          >
            Resume with token
          </button>
        </div>
      </section>

      <section class="flex flex-col gap-2 rounded-sm border p-3">
        <h2 class="font-bold">Actions</h2>
        <div class="flex flex-wrap gap-2">
          <button
            class="border px-3 py-1 text-sm"
            disabled={joinedRole !== "host"}
            onclick={() => sendJson({ type: "action", action: { type: "start-game" } }, "start-game")}
          >
            Start game
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={joinedRole !== "host"}
            onclick={() =>
              sendJson({ type: "action", action: { type: "select-cell", category: 0, row: 0 } }, "select-cell")}
          >
            Select cell 0,0
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={joinedRole !== "host"}
            onclick={() => sendJson({ type: "action", action: { type: "arm-buzzers" } }, "arm")}
          >
            Arm buzzers
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={joinedRole !== "player"}
            onclick={() => sendJson({ type: "action", action: { type: "buzz" } }, "buzz")}
          >
            Buzz
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={joinedRole !== "host"}
            onclick={() =>
              sendJson({ type: "action", action: { type: "judge", verdict: "correct" } }, "judge correct")}
          >
            Judge correct
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={joinedRole !== "host"}
            onclick={() => sendJson({ type: "set-pause", paused: !roomPaused }, "set-pause")}
          >
            {roomPaused ? "Resume room" : "Pause room"}
          </button>
          <button
            class="border px-3 py-1 text-sm"
            disabled={joinedRole === null}
            onclick={() => sendJson({ type: "sync" }, "sync")}
          >
            Sync snapshot
          </button>
          <button class="border px-3 py-1 text-sm" disabled={phase !== "open"} onclick={sendPing}>
            Ping (hibernation check)
          </button>
        </div>
        <p class="text-xs opacity-70">
          Hibernation check: let idle exceed ~10s, then Ping - the pong comes from the runtime
          auto-response (the DO never wakes), and a follow-up Sync proves state survived.
        </p>
        <textarea class="border p-2 font-mono text-xs" rows="2" bind:value={customJson}></textarea>
        <div>
          <button
            class="border px-3 py-1 text-sm"
            disabled={phase !== "open"}
            onclick={() => sendRaw(customJson, "custom")}
          >
            Send custom frame
          </button>
        </div>
      </section>

      <section class="flex flex-col gap-2 rounded-sm border p-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="font-bold">DO inspector</h2>
          <button
            class="border px-2 py-0.5 text-xs"
            disabled={inspecting || selectedRoom === null}
            onclick={inspectRoom}
          >
            {inspecting ? "Reading..." : "Refresh"}
          </button>
        </div>
        <DoInspector {inspection} {now} error={inspectionError} />
      </section>
    </div>

    <!-- ==================== RIGHT: log ==================== -->
    <section class="flex max-h-[85vh] min-h-80 flex-col gap-2 rounded-sm border p-3 lg:sticky lg:top-4">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="font-bold">
          Log ({visibleLog.length}/{log.length}{log.length >= logLimit ? ", capped" : ""})
        </h2>
        <select class="border px-2 py-0.5 text-sm" bind:value={logFilter}>
          <option value="all">all</option>
          <option value="sent">sent</option>
          <option value="received">received</option>
          <option value="errors">errors</option>
        </select>
        <label class="flex items-center gap-1 text-sm">
          <input type="checkbox" bind:checked={compactBodies} />
          compact
        </label>
        <button
          class="border px-2 py-0.5 text-sm"
          disabled={log.length === 0}
          onclick={() => {
            log = [];
          }}>Clear</button
        >
        <button
          class="border px-2 py-0.5 text-sm"
          disabled={log.length === 0}
          onclick={async () => {
            await navigator.clipboard.writeText(logToText(log));
            append("info", "log copied to clipboard (verbose)");
          }}>Copy</button
        >
      </div>
      <pre class="flex-1 overflow-auto border p-2 text-xs">{#each visibleLog as entry, index (index)}{formatLogLine(entry, compactBodies)}
{/each}</pre>
    </section>
  </div>

  <!-- ==================== TEST AREA ==================== -->
  <section class="flex flex-col gap-2 rounded-sm border-2 border-dashed p-3">
    <h2 class="font-bold">Test area - refusal probes</h2>
    <p class="text-xs opacity-70">
      These are assertions, not controls: each one asks the room to say NO and checks that it
      said no in the right way. A PASS here means the guardrail holds. They are separated from
      the normal controls on purpose - a green failure-probe is not an error.
    </p>
    <ul class="grid gap-2 md:grid-cols-2">
      {#each refusalProbes as probe (probe.id)}
        {@const state = probeState(probe.id)}
        <li class="flex flex-col gap-1 rounded-sm border p-2 text-sm">
          <div class="flex flex-wrap items-baseline gap-2">
            <strong>{probe.label}</strong>
            {#if state.running}
              <span class="text-xs">running...</span>
            {:else if state.verdict !== null}
              <span
                class="border px-2 text-xs font-bold"
                class:bg-green-100={state.verdict === "pass"}
                class:bg-red-100={state.verdict === "fail"}
                data-verdict={state.verdict}
              >
                {state.verdict.toUpperCase()}
              </span>
            {/if}
          </div>
          <span class="text-xs opacity-70">expected: {probe.expected}</span>
          <span class="text-xs opacity-70">actual: {state.actual ?? "not run"}</span>
          <span class="text-xs opacity-70">{probe.because}</span>
          {#if probe.id === "uncreated-room"}
            <button class="w-fit border px-2 py-0.5 text-xs" onclick={probeUncreatedRoom}>Run</button>
          {:else if probe.id === "wrong-password"}
            <button
              class="w-fit border px-2 py-0.5 text-xs"
              disabled={selectedRoom === null || !selectedRoom.hasPassword}
              onclick={probeWrongPassword}
            >
              Run (needs a password room this tab created)
            </button>
          {:else if probe.id === "stale-version"}
            <button
              class="w-fit border px-2 py-0.5 text-xs"
              disabled={phase !== "open"}
              onclick={() =>
                armSocketProbe("stale-version", () =>
                  sendRaw(
                    JSON.stringify({ version: protocolVersion + 1, type: "sync" }),
                    "stale version",
                  ),
                )}
            >
              Run
            </button>
          {:else if probe.id === "malformed-json"}
            <button
              class="w-fit border px-2 py-0.5 text-xs"
              disabled={phase !== "open"}
              onclick={() => armSocketProbe("malformed-json", () => sendRaw("{not json", "malformed"))}
            >
              Run
            </button>
          {:else if probe.id === "oversized-payload"}
            <button
              class="w-fit border px-2 py-0.5 text-xs"
              disabled={phase !== "open"}
              onclick={() =>
                armSocketProbe("oversized-payload", () =>
                  sendJson(
                    {
                      type: "sync",
                      ext: {
                        "com.example.filler": "x".repeat(limits.wire.clientMessageMaxBytes * 2),
                      },
                    },
                    "oversized",
                  ),
                )}
            >
              Run
            </button>
          {:else}
            <button
              class="w-fit border px-2 py-0.5 text-xs"
              disabled={phase !== "open" || joinedRole === "host" || joinedRole === null}
              onclick={probeRateLimit}
            >
              Run (join as player/spectator - the host is exempt by design)
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
</main>
