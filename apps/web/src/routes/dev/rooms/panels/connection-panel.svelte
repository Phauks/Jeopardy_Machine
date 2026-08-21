<script lang="ts">
  // MIDDLE COLUMN: the socket itself - state, join controls, action probes, and the DO
  // inspector. Presentational: the page owns the WebSocket and hands this panel the live
  // `connection` state object plus the small bag of things a button can do.
  import DoInspector from "#lib/dev/harness/do-inspector.svelte";
  import { limits } from "@jeopardy/protocol/limits";
  import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";
  import type { RoomInspection } from "@jeopardy/protocol/room/diagnostics";
  import type { SessionRoom } from "#lib/dev/harness/session-rooms.ts";

  // Live socket state, owned by the page (a $state object, so field writes there re-render
  // here without a prop per field).
  export type ConnectionState = {
    phase: "disconnected" | "connecting" | "open";
    joinedRole: string | null;
    roomLifecycle: string | null;
    paused: boolean;
    rosterCounts: { players: number; teams: number } | null;
    sessionToken: string | null;
    sent: number;
    received: number;
    openedAt: number | null;
    lastActivityAt: number | null;
    autoReconnect: boolean;
    // The last room-settings message this socket received - the broadcast, seen live.
    settings: RoomSettings | null;
  };

  // Where this tab is pointed: the code it connects to.
  export type ConnectionTarget = { code: string };

  type Props = {
    connection: ConnectionState;
    target: ConnectionTarget;
    now: number;
    rttStats: { count: number; min: number; avg: number; max: number } | null;
    selectedRoom: SessionRoom | null;
    inspection: RoomInspection | null;
    inspectionError: string | null;
    inspecting: boolean;
    customJson: { text: string };
    onConnect: () => void;
    onDisconnect: () => void;
    onSimulateDrop: () => void;
    onSend: (payload: Record<string, unknown>, label: string) => void;
    onSendRaw: (raw: string, label: string) => void;
    onPing: () => void;
    onInspect: () => void;
  };
  let {
    connection,
    target,
    now,
    rttStats,
    selectedRoom,
    inspection,
    inspectionError,
    inspecting,
    customJson,
    onConnect,
    onDisconnect,
    onSimulateDrop,
    onSend,
    onSendRaw,
    onPing,
    onInspect,
  }: Props = $props();

  function seconds(fromMs: number | null): string {
    if (fromMs === null) return "-";
    return `${((now - fromMs) / 1000).toFixed(0)}s`;
  }

  const open = $derived(connection.phase === "open");
</script>

<section class="flex flex-col gap-2 rounded-sm border p-3">
  <h2 class="font-bold">Connection</h2>
  <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
    <span>mode: <strong>same-origin</strong></span>
    <span>socket: <strong>{connection.phase}</strong></span>
    <span>role: <strong>{connection.joinedRole ?? "-"}</strong></span>
    <span>room: <strong>{connection.roomLifecycle ?? "-"}</strong></span>
    <span>uptime: {seconds(connection.openedAt)}</span>
    <span>idle: {seconds(connection.lastActivityAt)}</span>
    <span>sent {connection.sent} · recv {connection.received}</span>
    <span>
      token: {connection.sessionToken === null ? "-" : `${connection.sessionToken.slice(0, 6)}...`}
    </span>
    <span>paused: {connection.paused ? "yes" : "no"}</span>
    <span>
      roster: {connection.rosterCounts === null
        ? "-"
        : `${connection.rosterCounts.players} players · ${connection.rosterCounts.teams} teams`}
    </span>
    <span class="col-span-2">
      room settings seen: {connection.settings === null
        ? "-"
        : `${connection.settings.listing} · ${connection.settings.maxPlayers}p/${connection.settings.maxSpectators}s · code ${connection.settings.hideJoinCode ? "HIDDEN" : "visible"}`}
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
      bind:value={target.code}
      maxlength={limits.room.roomCodeLength}
    />
    <button
      class="border px-3 py-1"
      disabled={target.code.length !== limits.room.roomCodeLength}
      onclick={onConnect}>Connect</button
    >
    <button class="border px-3 py-1" disabled={!open} onclick={onDisconnect}>Disconnect</button>
    <button class="border px-3 py-1" disabled={!open} onclick={onSimulateDrop}>Simulate drop</button>
    <label class="flex items-center gap-1 text-sm">
      <input type="checkbox" bind:checked={connection.autoReconnect} />
      auto-reconnect
    </label>
  </div>
</section>

<section class="flex flex-col gap-2 rounded-sm border p-3">
  <h2 class="font-bold">Join</h2>
  <p class="text-xs opacity-70">The room answers nothing until you join or resume.</p>
    <div class="flex flex-wrap gap-2">
    <button
      class="border px-3 py-1 text-sm"
      disabled={!open || selectedRoom === null}
      onclick={() =>
        onSend({ type: "join", role: "host", hostToken: selectedRoom?.hostToken }, "join host")}
    >
      Join as host
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={!open}
      onclick={() =>
        onSend(
          { type: "join", role: "player", nickname: "Harness Tester" },
          "join player",
        )}
    >
      Join as player
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={!open}
      onclick={() => onSend({ type: "join", role: "spectator" }, "join spectator")}
    >
      Join as spectator
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={!open}
      onclick={() => onSend({ type: "join", role: "display" }, "join display")}
    >
      Join as display
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={!open || connection.sessionToken === null}
      onclick={() => onSend({ type: "resume", sessionToken: connection.sessionToken }, "resume")}
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
      disabled={connection.joinedRole !== "host"}
      onclick={() => onSend({ type: "action", action: { type: "start-game" } }, "start-game")}
    >
      Start game
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={connection.joinedRole !== "host"}
      onclick={() =>
        onSend(
          { type: "action", action: { type: "select-cell", category: 0, row: 0 } },
          "select-cell",
        )}
    >
      Select cell 0,0
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={connection.joinedRole !== "host"}
      onclick={() => onSend({ type: "action", action: { type: "arm-buzzers" } }, "arm")}
    >
      Arm buzzers
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={connection.joinedRole !== "player"}
      onclick={() => onSend({ type: "action", action: { type: "buzz" } }, "buzz")}
    >
      Buzz
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={connection.joinedRole !== "host"}
      onclick={() =>
        onSend({ type: "action", action: { type: "judge", verdict: "correct" } }, "judge correct")}
    >
      Judge correct
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={connection.joinedRole !== "host"}
      onclick={() => onSend({ type: "set-pause", paused: !connection.paused }, "set-pause")}
    >
      {connection.paused ? "Resume room" : "Pause room"}
    </button>
    <button
      class="border px-3 py-1 text-sm"
      disabled={connection.joinedRole === null}
      onclick={() => onSend({ type: "sync" }, "sync")}
    >
      Sync snapshot
    </button>
    <button class="border px-3 py-1 text-sm" disabled={!open} onclick={onPing}>
      Ping (hibernation check)
    </button>
  </div>
  <p class="text-xs opacity-70">
    Hibernation check: let idle exceed ~10s, then Ping - the pong comes from the runtime
    auto-response (the DO never wakes), and a follow-up Sync proves state survived.
  </p>
  <textarea class="border p-2 font-mono text-xs" rows="2" bind:value={customJson.text}></textarea>
  <div>
    <button
      class="border px-3 py-1 text-sm"
      disabled={!open}
      onclick={() => onSendRaw(customJson.text, "custom")}
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
      onclick={onInspect}
    >
      {inspecting ? "Reading..." : "Refresh"}
    </button>
  </div>
  <DoInspector {inspection} {now} error={inspectionError} />
</section>
