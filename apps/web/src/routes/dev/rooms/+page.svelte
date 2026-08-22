<script lang="ts">
  // The room instrument panel: create rooms, connect through the single origin, manage a live
  // room, and probe the guardrails.
  //
  // The layout is PANELS (owner direction 2026-08-14) - each one a component under ./panels,
  // so the arrangement can be rearranged without touching a line of probe logic. This file
  // owns every piece of state and every fetch; the panels render and call back.
  //
  //   left   - Rooms:         create, and every room THIS TAB made, with delete + connect
  //          - Room settings: change a LIVE room (listing, caps, spectators, streamer mode,
  //                           through either door, with the broadcast visible
  //          - Lobby:         the public list, auto-refreshing, registry health in words
  //   middle - Connection:    socket/room state, join controls, action probes, DO inspector
  //   right  - Log:           full height, filterable, compact or verbose bodies
  //   below  - Test area:     the refusal probes, with Run all
  //
  // Single origin, always: rooms connect to wss://<this page's origin>/room/<CODE>/ws and the
  // web Worker forwards to the DO over the cross-script binding (docs/decisions/2026-08-13-
  // single-origin-binding.md). vite dev cannot serve rooms at all - it has no binding - and
  // the page says so instead of failing quietly.
  //
  // /dev/* routes are never linked from product UI.
  import ConnectionPanel from "./panels/connection-panel.svelte";
  import LobbyPanel from "./panels/lobby-panel.svelte";
  import LogPanel from "./panels/log-panel.svelte";
  import RoomSettingsPanel from "./panels/room-settings-panel.svelte";
  import RoomsPanel from "./panels/rooms-panel.svelte";
  import TestAreaPanel from "./panels/test-area-panel.svelte";
  import { limits } from "@jeopardy/protocol/limits";
  import { protocolVersion } from "@jeopardy/protocol/envelope";
  import { generateRoomCode } from "@jeopardy/protocol/room/create";
  import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
  import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
    import { roomWebSocketUrl } from "#lib/realtime/room-url.ts";
  import { sampleGameDefinition } from "#lib/hotseat/sample-game.ts";
  import { summarizeRegistryStatus } from "#lib/lobby/registry-status.ts";
  import {
    appendLogEntry,
    logToText,
    stampNow,
  } from "#lib/dev/harness/harness-log.ts";
  import {
    forgetSessionRoom,
    markSessionRoomClosed,
    rememberSessionRoom,
    updateSessionRoomSettings,
  } from "#lib/dev/harness/session-rooms.ts";
  import {
    describeObservation,
    judgeProbe,
    probeBlocker,
    refusalProbes,
    summarizeProbeRun,
  } from "#lib/dev/harness/refusal-probes.ts";
  import type { LogDirection, LogEntry } from "#lib/dev/harness/harness-log.ts";
  import type { ProbeId, ProbeObservation, ProbeRunOutcome } from "#lib/dev/harness/refusal-probes.ts";
  import type { SessionRoom } from "#lib/dev/harness/session-rooms.ts";
  import type { CreateRoomResponse } from "@jeopardy/protocol/room/create";
  import type {
    RoomInspection,
    UpdateRoomSettingsResponse,
  } from "@jeopardy/protocol/room/diagnostics";
  import type { RoomSettings, RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
  import type { LobbyListing } from "@jeopardy/protocol/room/registry";
  import type { ConnectionState, ConnectionTarget } from "./panels/connection-panel.svelte";
  import type { LogView } from "./panels/log-panel.svelte";
  import type { CreateForm } from "./panels/rooms-panel.svelte";
  import type { SettingsDraft } from "./panels/room-settings-panel.svelte";
  import type { ProbeState } from "./panels/test-area-panel.svelte";

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
  const logView = $state<LogView>({ filter: "all", compact: true });

  function append(dir: LogDirection, text: string): void {
    log = appendLogEntry(log, { at: stampNow(), dir, text });
  }

  // ---- rooms this tab created ---------------------------------------------------------------

  let sessionRooms = $state<SessionRoom[]>([]);
  let creating = $state(false);
  const createForm = $state<CreateForm>({
    listing: "public",
    source: "sample",
    title: "Harness room",
    hostLabel: "Harness",
    maxPlayers: limits.room.playerSoftCap,
    maxSpectators: limits.room.spectatorSoftCap,
    spectatorsAllowed: true,
    hideJoinCode: false,
  });
  // Where this tab is pointed: the code it connects to.
  const target = $state<ConnectionTarget>({ code: "" });

  const selectedRoom = $derived(sessionRooms.find((room) => room.code === target.code) ?? null);

  // The hotseat sample game as a REAL definition payload (the same document the editor will
  // send from "Host this game"), or the compact board the bots and workerd suites use.
  function gamePayload(): Record<string, unknown> {
    if (createForm.source === "compact") {
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
          listing: createForm.listing,
          title: createForm.title,
          hostLabel: createForm.hostLabel,
          maxPlayers: createForm.maxPlayers,
          maxSpectators: createForm.maxSpectators,
          spectatorsAllowed: createForm.spectatorsAllowed,
          hideJoinCode: createForm.hideJoinCode,
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
        settings: body.settings,
        hostToken: body.hostToken,
        createdAt: Date.now(),
        expiresAt: body.expiresAt,
        registry: body.registry,
        closedAt: null,
      });
      target.code = body.code;
      syncSettingsDraft(body.settings);
      append(
        "info",
        `room ${body.code} created (${body.settings.listing}, ${String(body.settings.maxPlayers)}p/${String(body.settings.maxSpectators)}s) - expires ${new Date(body.expiresAt).toLocaleTimeString()} - ${summarizeRegistryStatus(body.registry)}`,
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

  // ---- room settings ---------------------------------------------------------------------
  //
  // Both doors land in the same place inside the DO (applyRoomSettings), which is exactly why
  // the harness offers both: a divergence between them is a bug this panel can catch.

  const settingsDraft = $state<SettingsDraft>({
    door: "http",
    maxPlayers: limits.room.playerSoftCap,
    maxSpectators: limits.room.spectatorSoftCap,
    title: "",
    hostLabel: "",
  });
  let settingsBusy = $state(false);
  let settingsResult = $state<string | null>(null);

  function syncSettingsDraft(settings: RoomSettings): void {
    settingsDraft.maxPlayers = settings.maxPlayers;
    settingsDraft.maxSpectators = settings.maxSpectators;
    settingsDraft.title = settings.title;
    settingsDraft.hostLabel = settings.hostLabel;
  }

  async function applySettings(patch: RoomSettingsPatch): Promise<void> {
    const room = selectedRoom;
    if (room === null) return;
    if (settingsDraft.door === "socket") {
      sendJson({ type: "update-room-settings", settings: patch }, "update-room-settings");
      // The answer is the BROADCAST (and an error message if the room refuses), so nothing is
      // assumed here - trackServerMessage adopts whatever comes back.
      return;
    }
    settingsBusy = true;
    try {
      const response = await fetch(`/api/rooms/${room.code}`, {
        method: "PATCH",
        headers: { [hostTokenHeader]: room.hostToken, "content-type": "application/json" },
        body: JSON.stringify({ settings: patch }),
      });
      const body = (await response.json().catch(() => null)) as
        | UpdateRoomSettingsResponse
        | { error?: string }
        | null;
      if (!response.ok) {
        const reason = body !== null && "error" in body ? body.error : String(response.status);
        settingsResult = `refused: ${String(reason)}`;
        append("err", `settings ${room.code} refused: ${String(reason)}`);
        return;
      }
      const updated = body as UpdateRoomSettingsResponse;
      sessionRooms = updateSessionRoomSettings(sessionRooms, room.code, {
        settings: updated.settings,
      });
      syncSettingsDraft(updated.settings);
      settingsResult = `applied · ${updated.settings.listing} · ${String(updated.settings.maxPlayers)}p/${String(updated.settings.maxSpectators)}s · code ${updated.settings.hideJoinCode ? "hidden" : "visible"} · ${summarizeRegistryStatus(updated.registry)}`;
      append("info", `settings ${room.code}: ${settingsResult}`);
      void refreshLobby();
      void inspectRoom();
    } catch (error) {
      settingsResult = error instanceof Error ? error.message : String(error);
    } finally {
      settingsBusy = false;
    }
  }

  // ---- the public lobby ----------------------------------------------------------------------
  //
  // Only PUBLIC rooms can ever be listed: Durable Objects have no enumeration API, so the list
  // is exactly the D1 registry projection, and private rooms deliberately have no row to find
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

  // Arriving from the lobby hand-off (/?code=... -> /dev/rooms?code=XXXXX): the code is the
  // whole hand-off, because the code is the whole credential (join-hand-off.ts).
  $effect(() => {
    const fromLobby = new URL(globalThis.location.href).searchParams.get("code");
    if (fromLobby === null || target.code !== "") return;
    target.code = fromLobby.toUpperCase();
    append("info", `arrived from the lobby with room ${target.code}`);
  });

  // ---- connection lifecycle -------------------------------------------------------------------

  let socket = $state<WebSocket | null>(null);
  const connection = $state<ConnectionState>({
    phase: "disconnected",
    joinedRole: null,
    roomLifecycle: null,
    paused: false,
    rosterCounts: null,
    sessionToken: null,
    sent: 0,
    received: 0,
    openedAt: null,
    lastActivityAt: null,
    autoReconnect: false,
    settings: null,
  });
  let reconnectAttempt = 0;

  function connect(): void {
    disconnect();
    try {
      const url = roomWebSocketUrl(target.code);
      connection.phase = "connecting";
      append("info", `connecting to ${url}`);
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        connection.phase = "open";
        connection.openedAt = Date.now();
        connection.lastActivityAt = Date.now();
        reconnectAttempt = 0;
        append("info", "open - the room answers only after a join or resume message");
      });
      ws.addEventListener("message", (event) => {
        connection.received += 1;
        connection.lastActivityAt = Date.now();
        const data = String(event.data);
        trackServerMessage(data);
        append("in", data);
      });
      ws.addEventListener("close", (event) => {
        connection.phase = "disconnected";
        connection.openedAt = null;
        connection.joinedRole = null;
        append(
          "info",
          `closed (code ${String(event.code)}${event.reason ? `, reason "${event.reason}"` : ""})`,
        );
        if (connection.autoReconnect && reconnectAttempt < 3) {
          reconnectAttempt += 1;
          const delay = 500 * 2 ** reconnectAttempt;
          append("info", `auto-reconnect ${String(reconnectAttempt)}/3 in ${String(delay)}ms`);
          setTimeout(() => {
            if (connection.phase === "disconnected") connect();
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
      connection.phase = "disconnected";
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
      connection.joinedRole = message.role;
      connection.sessionToken = message.sessionToken;
    }
    if (message.type === "snapshot") {
      connection.roomLifecycle = message.phase;
      connection.paused = message.paused;
      connection.rosterCounts = {
        players: message.roster.players.length,
        teams: message.roster.teams.length,
      };
    }
    if (message.type === "roster") {
      connection.rosterCounts = {
        players: message.roster.players.length,
        teams: message.roster.teams.length,
      };
    }
    if (message.type === "paused") connection.paused = message.paused;
    // The broadcast IS the answer to a settings change (and the one a display reacts to), so
    // the session row adopts it whichever door sent the patch.
    if (message.type === "room-settings") {
      connection.settings = message.settings;
      sessionRooms = updateSessionRoomSettings(sessionRooms, target.code, {
        settings: message.settings,
      });
      settingsResult = `broadcast · ${message.settings.listing} · code ${message.settings.hideJoinCode ? "hidden" : "visible"}`;
    }
    if (message.type === "room-closed") {
      connection.roomLifecycle = `closed (${message.reason})`;
      sessionRooms = markSessionRoomClosed(sessionRooms, target.code, Date.now());
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
    connection.joinedRole = null;
  }

  function simulateDrop(): void {
    append("info", "simulating connection drop (close 4000)");
    socket?.close(4000, "simulated drop");
    socket = null;
  }

  // ---- send helpers ---------------------------------------------------------------------------

  function sendRaw(raw: string, label?: string): void {
    if (socket === null || connection.phase !== "open") {
      append("err", "not connected");
      return;
    }
    socket.send(raw);
    connection.sent += 1;
    connection.lastActivityAt = Date.now();
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

  let probeStates = $state<Record<string, ProbeState>>({});
  let runningAll = $state(false);
  let runSummary = $state<string | null>(null);
  // Which probe is waiting on the main socket's next refusal/error frame, and how to hand the
  // verdict back to a Run-all loop that is awaiting it.
  let pendingProbe: { id: ProbeId; settle: (observed: ProbeObservation) => void } | null = null;

  const probeContext = $derived({
    socketOpen: connection.phase === "open",
    joinedRole: connection.joinedRole,
  });

  function beginProbe(id: ProbeId): void {
    probeStates = { ...probeStates, [id]: { verdict: null, actual: null, running: true } };
  }

  function finishProbe(id: ProbeId, observed: ProbeObservation): void {
    const verdict = judgeProbe(id, observed);
    const actual = describeObservation(observed);
    probeStates = { ...probeStates, [id]: { verdict, actual, running: false } };
    append(verdict === "pass" ? "info" : "err", `probe ${id}: ${verdict.toUpperCase()} - ${actual}`);
  }

  function skipProbe(id: ProbeId, reason: string): void {
    probeStates = { ...probeStates, [id]: { verdict: "skip", actual: reason, running: false } };
    append("info", `probe ${id}: SKIPPED - ${reason}`);
  }

  // Frames arriving on the MAIN socket settle whichever probe armed itself last.
  function settleProbe(observed: ProbeObservation): void {
    const pending = pendingProbe;
    if (pending === null) return;
    pendingProbe = null;
    pending.settle(observed);
  }

  // One probe, as a promise: Run all needs to await each in turn, because several of these
  // share the single socket and a parallel burst would let one settle another's frame.
  function runProbe(id: ProbeId): Promise<void> {
    if (id === "uncreated-room") return probeUncreatedRoom();
    if (id === "stale-version") {
      return armSocketProbe(id, () =>
        sendRaw(JSON.stringify({ version: protocolVersion + 1, type: "sync" }), "stale version"),
      );
    }
    if (id === "malformed-json") {
      return armSocketProbe(id, () => sendRaw("{not json", "malformed"));
    }
    if (id === "oversized-payload") {
      return armSocketProbe(id, () =>
        sendJson(
          {
            type: "sync",
            ext: { "com.example.filler": "x".repeat(limits.wire.clientMessageMaxBytes * 2) },
          },
          "oversized",
        ),
      );
    }
    // rate-limit-burst: the HOST is exempt from the message-rate cap by design, which is why
    // probeBlocker refuses to run this one as host rather than reporting a false failure.
    return armSocketProbe(id, () => {
      for (let index = 0; index < limits.wire.clientMessagesPerSecondMax + 5; index += 1) {
        sendJson({ type: "sync" }, "burst");
      }
    });
  }

  function armSocketProbe(id: ProbeId, send: () => void): Promise<void> {
    beginProbe(id);
    return new Promise((resolve) => {
      const settle = (observed: ProbeObservation) => {
        finishProbe(id, observed);
        resolve();
      };
      pendingProbe = { id, settle };
      send();
      // No answer at all is itself a failure - the room owes every refusal a frame.
      setTimeout(() => {
        if (pendingProbe?.id === id) {
          pendingProbe = null;
          settle({});
        }
      }, 3000);
    });
  }

  // Connection-level probe: its own socket, because the point is what happens to a connection
  // that should never have been accepted.
  function probeUncreatedRoom(): Promise<void> {
    const code = generateRoomCode();
    beginProbe("uncreated-room");
    append("info", `probing uncreated room ${code} - EXPECTING a no-such-room refusal`);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (observed: ProbeObservation) => {
        if (settled) return;
        settled = true;
        finishProbe("uncreated-room", observed);
        resolve();
      };
      try {
        const ws = new WebSocket(roomWebSocketUrl(code));
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
        settle({ type: error instanceof Error ? error.message : "threw" });
      }
    });
  }

  // Run all: SEQUENTIAL, skipping what this tab cannot currently perform, and finishing with
  // one line a reader can act on (owner request 2026-08-14).
  async function runAllProbes(): Promise<void> {
    runningAll = true;
    runSummary = null;
    const outcomes: ProbeRunOutcome[] = [];
    try {
      for (const probe of refusalProbes) {
        const blocker = probeBlocker(probe.id, probeContext);
        if (blocker !== null) {
          skipProbe(probe.id, blocker);
          outcomes.push({ id: probe.id, verdict: "skip" });
          continue;
        }
        // Sequential on purpose: these share one socket (see runProbe).
        // oxlint-disable-next-line no-await-in-loop
        await runProbe(probe.id);
        const verdict = probeStates[probe.id]?.verdict;
        outcomes.push({ id: probe.id, verdict: verdict === "pass" ? "pass" : "fail" });
      }
      runSummary = summarizeProbeRun(outcomes);
      append("info", `run all: ${runSummary}`);
    } finally {
      runningAll = false;
    }
  }

  const customJson = $state({ text: `{ "version": ${String(protocolVersion)}, "type": "sync" }` });
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
    <div class="flex flex-col gap-4">
      <RoomsPanel
        form={createForm}
        {creating}
        onCreate={createRoom}
        rooms={sessionRooms}
        {lobby}
        {now}
        selectedCode={target.code}
        onUse={(room) => {
          target.code = room.code;
          syncSettingsDraft(room.settings);
        }}
        onConnect={(room) => {
          target.code = room.code;
          syncSettingsDraft(room.settings);
          connect();
        }}
        onDelete={(room) => void deleteRoom(room)}
        onForget={(room) => {
          sessionRooms = forgetSessionRoom(sessionRooms, room.code);
        }}
      />

      <RoomSettingsPanel
        room={selectedRoom}
        broadcast={connection.settings}
        {inspection}
        draft={settingsDraft}
        busy={settingsBusy}
        result={settingsResult}
        joinedAsHost={connection.joinedRole === "host"}
        onApply={(patch) => void applySettings(patch)}
      />

      <LobbyPanel
        {lobby}
        loading={lobbyLoading}
        {secondsToRefresh}
        refreshIntervalMs={lobbyAutoRefreshMs}
        onRefresh={() => void refreshLobby()}
        onJoin={(code) => {
          target.code = code;
          connect();
        }}
      />
    </div>

    <div class="flex flex-col gap-4">
      <ConnectionPanel
        {connection}
        {target}
        {now}
        {rttStats}
        {selectedRoom}
        {inspection}
        {inspectionError}
        {inspecting}
        {customJson}
        onConnect={connect}
        onDisconnect={disconnect}
        onSimulateDrop={simulateDrop}
        onSend={sendJson}
        onSendRaw={sendRaw}
        onPing={sendPing}
        onInspect={() => void inspectRoom()}
      />
    </div>

    <LogPanel
      {log}
      view={logView}
      onClear={() => {
        log = [];
      }}
      onCopy={async () => {
        await navigator.clipboard.writeText(logToText(log));
        append("info", "log copied to clipboard (verbose)");
      }}
    />
  </div>

  <TestAreaPanel
    states={probeStates}
    context={probeContext}
    {runningAll}
    summary={runSummary}
    onRun={(id) => void runProbe(id)}
    onRunAll={() => void runAllProbes()}
  />
</main>
