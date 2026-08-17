<script lang="ts">
  // The public lobby, as the harness watches it. Only PUBLIC rooms can ever appear: Durable
  // Objects have no enumeration API, so the list is exactly the D1 registry projection and a
  // private room deliberately has no row to find (docs/decisions/2026-08-14-room-visibility-
  // and-lobby.md).
  import RegistryStatusLine from "#lib/lobby/registry-status-line.svelte";
  import type { LobbyListing } from "@jeopardy/protocol/room/registry";

  type Props = {
    lobby: LobbyListing | null;
    loading: boolean;
    secondsToRefresh: number;
    refreshIntervalMs: number;
    onRefresh: () => void;
    onJoin: (code: string) => void;
  };
  let { lobby, loading, secondsToRefresh, refreshIntervalMs, onRefresh, onJoin }: Props = $props();
</script>

<section class="flex flex-col gap-2 rounded-sm border p-3">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="font-bold">Public lobby ({lobby?.rooms.length ?? 0})</h2>
    <span class="text-xs opacity-70">auto-refresh in {secondsToRefresh}s</span>
  </div>
  <div class="flex flex-wrap items-center gap-2">
    <button class="border px-2 py-0.5 text-sm" disabled={loading} onclick={onRefresh}>
      {loading ? "Refreshing..." : "Refresh now"}
    </button>
    <span class="text-xs opacity-70">GET /api/rooms · every {refreshIntervalMs / 1000}s</span>
  </div>
  {#if lobby !== null}
    <RegistryStatusLine status={lobby.registry} />
  {/if}
  {#if lobby !== null && lobby.rooms.length === 0}
    <p class="text-sm opacity-70">
      No public rooms live. Private rooms are invisible here by design - a DO cannot be
      enumerated, and a private room writes no browsable row.
    </p>
  {/if}
  <ul class="flex flex-col gap-1 text-sm">
    {#each lobby?.rooms ?? [] as room (room.code)}
      <li class="flex flex-wrap items-center gap-2 rounded-sm border p-2">
        <strong>{room.code}</strong>
        <span class="opacity-70">{room.title}</span>
        <span class="text-xs opacity-70">
          {room.phase} · {room.playerCount}/{room.playerCap}{room.hasPassword ? " · locked" : ""}
        </span>
        <button class="border px-2 py-0.5 text-xs" onclick={() => onJoin(room.code)}>
          Join this room
        </button>
      </li>
    {/each}
  </ul>
</section>
