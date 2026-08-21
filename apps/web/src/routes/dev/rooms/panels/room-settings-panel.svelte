<script lang="ts">
  // The management tools the owner asked for once a room exists (docs/decisions/2026-08-14-
  // room-controls-and-staging.md, "Management tools"): change the listing,
  // both participant budgets, the spectator switch and streamer mode - on a LIVE room, with
  // the effect visible on the same screen.
  //
  // Two doors, both real, chosen by a select: the host-only `update-room-settings` socket
  // message (what the console will send) and PATCH /api/rooms/<CODE> with the host token (what
  // a surface holding no socket sends). They apply the same patch through the same code inside
  // the DO, and this panel is where that equivalence is actually exercised.
  //
  // The "live settings" line below is fed by the room-settings BROADCAST, not by this form:
  // watching it change after an edit - especially the join code disappearing - is the point.
  import { limits } from "@jeopardy/protocol/limits";
  import type { RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
  import type { RoomInspection } from "@jeopardy/protocol/room/diagnostics";
  import type { SessionRoom } from "#lib/dev/harness/session-rooms.ts";
  import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";

  // Draft values for the fields that need a deliberate Apply (numbers and text); the switches
  // send on change, because a toggle that needs a second button is a toggle nobody trusts.
  export type SettingsDraft = {
    door: "socket" | "http";
    maxPlayers: number;
    maxSpectators: number;
    title: string;
    hostLabel: string;
  };

  type Props = {
    room: SessionRoom | null;
    // What the socket last heard broadcast - the truth every other client is seeing.
    broadcast: RoomSettings | null;
    inspection: RoomInspection | null;
    draft: SettingsDraft;
    busy: boolean;
    // Null until something has been applied; the server's answer or its refusal, verbatim.
    result: string | null;
    joinedAsHost: boolean;
    onApply: (patch: RoomSettingsPatch) => void;
  };
  let { room, broadcast, inspection, draft, busy, result, joinedAsHost, onApply }: Props = $props();

  const settings = $derived(room?.settings ?? null);
  const census = $derived(inspection?.room.participants ?? null);
  // The socket door needs a host-joined socket; the HTTP door needs only the token this tab
  // already holds, which is why it is the one that always works after a create.
  const blocked = $derived(
    room === null
      ? "create or select a room this tab made - settings are host-authenticated"
      : draft.door === "socket" && !joinedAsHost
        ? "join this room as host to use the socket door (or switch to HTTP)"
        : null,
  );
</script>

<section class="flex flex-col gap-2 rounded-sm border p-3">
  <h2 class="font-bold">Room settings</h2>
  <p class="text-xs opacity-70">
    Every control here changes a LIVE room and broadcasts room-settings to everyone connected.
    Nothing is applied locally: the row and the line below show the server's answer.
  </p>

  <label class="flex items-center justify-between gap-2 text-sm">
    apply through
    <select class="border px-2 py-1" bind:value={draft.door}>
      <option value="socket">update-room-settings message (host socket)</option>
      <option value="http">PATCH /api/rooms/CODE (host token)</option>
    </select>
  </label>

  {#if blocked !== null}
    <p class="rounded-sm border border-dashed p-2 text-xs">{blocked}</p>
  {/if}

  {#if settings !== null && room !== null}
    <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      <dt class="opacity-70">room</dt>
      <dd><strong>{room.code}</strong></dd>
      <dt class="opacity-70">stored settings</dt>
      <dd>
        {settings.listing} · {settings.maxPlayers}p / {settings.spectatorsAllowed
          ? `${settings.maxSpectators}s`
          : "spectators off"} · code {settings.hideJoinCode ? "HIDDEN" : "visible"}
      </dd>
      <dt class="opacity-70">last broadcast</dt>
      <dd data-broadcast>
        {broadcast === null
          ? "none seen on this socket"
          : `${broadcast.listing} · ${broadcast.maxPlayers}p / ${broadcast.maxSpectators}s · code ${broadcast.hideJoinCode ? "HIDDEN" : "visible"}`}
      </dd>
      <dt class="opacity-70">participants</dt>
      <dd>
        {census === null
          ? "refresh the DO inspector to count them"
          : `players ${census.players.connected}/${census.players.max} (${census.players.seated} seated) · spectators ${census.spectators.connected}/${census.spectators.max}${census.spectators.allowed ? "" : " - off"}`}
      </dd>
    </dl>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <label class="flex items-center gap-1">
        listing
        <select
          class="border px-2 py-1"
          disabled={busy || blocked !== null}
          value={settings.listing}
          onchange={(event) =>
            onApply({ listing: event.currentTarget.value === "public" ? "public" : "private" })}
        >
          <option value="public">public</option>
          <option value="private">private</option>
        </select>
      </label>
      <label class="flex items-center gap-1">
        <input
          type="checkbox"
          disabled={busy || blocked !== null}
          checked={settings.spectatorsAllowed}
          onchange={(event) => onApply({ spectatorsAllowed: event.currentTarget.checked })}
        />
        spectators allowed
      </label>
      <label class="flex items-center gap-1">
        <input
          type="checkbox"
          disabled={busy || blocked !== null}
          checked={settings.hideJoinCode}
          onchange={(event) => onApply({ hideJoinCode: event.currentTarget.checked })}
        />
        hide join code (streamer mode)
      </label>
    </div>

    <div class="flex flex-wrap items-end gap-2 text-sm">
      <label class="flex items-center gap-1">
        max players
        <input
          class="w-20 border px-2 py-1"
          type="number"
          min="1"
          max={limits.room.playerHardCap}
          bind:value={draft.maxPlayers}
        />
      </label>
      <button
        class="border px-2 py-1 text-xs"
        disabled={busy || blocked !== null}
        onclick={() => onApply({ maxPlayers: draft.maxPlayers })}
      >
        Apply
      </button>
      <label class="flex items-center gap-1">
        max spectators
        <input
          class="w-20 border px-2 py-1"
          type="number"
          min="0"
          max={limits.room.spectatorHardCap}
          bind:value={draft.maxSpectators}
        />
      </label>
      <button
        class="border px-2 py-1 text-xs"
        disabled={busy || blocked !== null}
        onclick={() => onApply({ maxSpectators: draft.maxSpectators })}
      >
        Apply
      </button>
    </div>

    <div class="flex flex-wrap items-end gap-2 text-sm">
      <label class="flex items-center gap-1">
        title
        <input
          class="w-48 border px-2 py-1"
          maxlength={limits.room.roomTitleMaxLength}
          bind:value={draft.title}
        />
      </label>
      <label class="flex items-center gap-1">
        host label
        <input
          class="w-40 border px-2 py-1"
          maxlength={limits.room.hostLabelMaxLength}
          bind:value={draft.hostLabel}
        />
      </label>
      <button
        class="border px-2 py-1 text-xs"
        disabled={busy || blocked !== null}
        onclick={() => onApply({ title: draft.title, hostLabel: draft.hostLabel })}
      >
        Apply text
      </button>
    </div>

    <p class="text-xs opacity-70">
      No edit here ever disconnects anyone already inside - a cap that drops below the roster
      binds the next arrival, not the people in the room (@jeopardy/protocol room-settings.ts).
    </p>
  {/if}

  {#if result !== null}
    <p class="rounded-sm border p-2 text-xs" data-settings-result>{result}</p>
  {/if}
</section>
