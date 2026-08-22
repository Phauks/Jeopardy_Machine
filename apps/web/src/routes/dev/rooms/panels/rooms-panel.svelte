<script lang="ts">
  // LEFT COLUMN, top: create a room, and every room THIS TAB created.
  //
  // Panels are components (owner direction 2026-08-14) so the layout can be rearranged without
  // touching probe logic: everything here is presentational - state and every fetch live in
  // the page, and this file only renders them and calls back.
  import { limits } from "@jeopardy/protocol/limits";
  import { formatRoomAge } from "#lib/lobby/room-age.ts";
  import { describeLobbyPresence, formatCountdown, lobbyPresence } from "#lib/dev/harness/session-rooms.ts";
  import type { SessionRoom } from "#lib/dev/harness/session-rooms.ts";
  import type { LobbyListing } from "@jeopardy/protocol/room/registry";

  // The create form as a live $state object owned by the page: mutating a field here is
  // visible there, which is what keeps this component free of a dozen bindable props.
  export type CreateForm = {
    listing: "public" | "private";
    source: "sample" | "compact";
    title: string;
    hostLabel: string;
    maxPlayers: number;
    maxSpectators: number;
    spectatorsAllowed: boolean;
    hideJoinCode: boolean;
  };

  type Props = {
    form: CreateForm;
    creating: boolean;
    onCreate: () => void;
    rooms: SessionRoom[];
    lobby: LobbyListing | null;
    now: number;
    selectedCode: string;
    onUse: (room: SessionRoom) => void;
    onConnect: (room: SessionRoom) => void;
    onDelete: (room: SessionRoom) => void;
    onForget: (room: SessionRoom) => void;
  };
  let {
    form,
    creating,
    onCreate,
    rooms,
    lobby,
    now,
    selectedCode,
    onUse,
    onConnect,
    onDelete,
    onForget,
  }: Props = $props();
</script>

<section class="flex flex-col gap-2 rounded-sm border p-3">
  <h2 class="font-bold">Create a room</h2>
  <p class="text-xs opacity-70">
    Creation is explicit - connecting to a code never creates a room. Every control below is
    editable afterwards in the Room settings panel.
  </p>
  <label class="flex items-center justify-between gap-2 text-sm">
    listing
    <select class="border px-2 py-1" bind:value={form.listing}>
      <option value="public">public (shows in the lobby)</option>
      <option value="private">private (code only)</option>
    </select>
  </label>
  <label class="flex items-center justify-between gap-2 text-sm">
    game
    <select class="border px-2 py-1" bind:value={form.source}>
      <option value="sample">sample game definition (authored clues)</option>
      <option value="compact">compact 3x3 board (no content)</option>
    </select>
  </label>
  <label class="flex items-center justify-between gap-2 text-sm">
    title
    <input class="w-48 border px-2 py-1" maxlength={limits.room.roomTitleMaxLength} bind:value={form.title} />
  </label>
  <label class="flex items-center justify-between gap-2 text-sm">
    host label
    <input class="w-48 border px-2 py-1" maxlength={limits.room.hostLabelMaxLength} bind:value={form.hostLabel} />
  </label>
    <label class="flex items-center justify-between gap-2 text-sm">
    max players
    <input
      class="w-24 border px-2 py-1"
      type="number"
      min="1"
      max={limits.room.playerHardCap}
      bind:value={form.maxPlayers}
    />
  </label>
  <label class="flex items-center justify-between gap-2 text-sm">
    max spectators
    <input
      class="w-24 border px-2 py-1"
      type="number"
      min="0"
      max={limits.room.spectatorHardCap}
      bind:value={form.maxSpectators}
    />
  </label>
  <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" bind:checked={form.spectatorsAllowed} />
    spectators allowed
  </label>
  <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" bind:checked={form.hideJoinCode} />
    hide join code (streamer mode)
  </label>
  <button class="border px-3 py-1" disabled={creating} onclick={onCreate}>
    {creating ? "Creating..." : "Create room"}
  </button>
</section>

<section class="flex flex-col gap-2 rounded-sm border p-3">
  <h2 class="font-bold">Rooms this tab created ({rooms.length})</h2>
  {#if rooms.length === 0}
    <p class="text-sm opacity-70">
      None yet. Creating a room adds a row here; it never replaces the previous one.
    </p>
  {/if}
  <ul class="flex flex-col gap-2">
    {#each rooms as room (room.code)}
      {@const presence = lobbyPresence(room, lobby)}
      <li class="flex flex-col gap-1 rounded-sm border p-2 text-sm" class:font-bold={room.code === selectedCode}>
        <div class="flex flex-wrap items-baseline gap-2">
          <strong class="text-base">{room.code}</strong>
          <span class="opacity-70">{room.settings.title}</span>
          <span class="opacity-70">
            {room.settings.listing}
            {room.settings.hideJoinCode ? " · code hidden" : ""}
          </span>
        </div>
        <div class="flex flex-wrap gap-2 text-xs">
          <span data-presence={presence}>{describeLobbyPresence(presence)}</span>
          <span class="opacity-70">created {formatRoomAge(room.createdAt, now)}</span>
          <span class="opacity-70">expires in {formatCountdown(room.expiresAt - now)}</span>
          <span class="opacity-70">
            caps {room.settings.maxPlayers}p / {room.settings.spectatorsAllowed
              ? `${room.settings.maxSpectators}s`
              : "no spectators"}
          </span>
        </div>
        {#if room.registry.status !== "ok"}
          <p class="text-xs">
            Not written to the registry ({room.registry.reason}) - this room exists and can be
            joined by code, but it cannot appear in the lobby.
          </p>
        {/if}
        <div class="flex flex-wrap gap-2">
          <button class="border px-2 py-0.5 text-xs" onclick={() => onUse(room)}>Use</button>
          <button class="border px-2 py-0.5 text-xs" onclick={() => onConnect(room)}>Connect</button>
          <button
            class="border px-2 py-0.5 text-xs"
            disabled={room.closedAt !== null}
            onclick={() => onDelete(room)}
          >
            {room.closedAt === null ? "Delete (close room)" : "Closed"}
          </button>
          <button class="border px-2 py-0.5 text-xs" onclick={() => onForget(room)}>Forget row</button>
        </div>
      </li>
    {/each}
  </ul>
</section>
