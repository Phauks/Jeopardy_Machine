<script lang="ts">
  // The public rooms list - the browsable half of the lobby
  // (docs/decisions/2026-08-14-room-visibility-and-lobby.md). Server-browser conventions we
  // adopt: a lock for password rooms, capacity as a fraction, newest first, running games
  // dimmed, and NO live socket - the page polls, because browsing is not playing.
  //
  // Presentational on purpose (no fetching here): the page owns the poll and this component
  // owns the rows, so it server-renders in a test and re-renders from any source later.
  import { formatRoomAge, formatRoomPhase } from "#lib/lobby/room-age.ts";
  import type { RoomSummary } from "@jeopardy/protocol/room/registry";

  type Props = {
    rooms: RoomSummary[];
    // Server stamp of the listing, so ages are measured against the data's clock.
    fetchedAt: number;
    // True while the code box has a complete code: the typed code always wins, so the list
    // steps back rather than competing for the same tap.
    dimmed?: boolean;
    onSelect: (room: RoomSummary) => void;
  };
  let { rooms, fetchedAt, dimmed = false, onSelect }: Props = $props();
</script>

{#if rooms.length === 0}
  <p class="rounded-sm border border-dashed p-4 text-sm opacity-70">
    No public rooms right now. Rooms are private by default - hosts opt in - so a quiet list
    is the normal state. Have a code? Type it above.
  </p>
{:else}
  <ul class="flex flex-col gap-2" class:opacity-50={dimmed}>
    {#each rooms as room (room.code)}
      <li>
        <button
          class="flex w-full items-baseline justify-between gap-3 rounded-sm border p-3 text-left"
          class:opacity-70={room.phase === "active"}
          disabled={dimmed}
          onclick={() => onSelect(room)}
        >
          <span class="min-w-0">
            <span class="block truncate font-bold">
              {#if room.hasPassword}
                <span aria-label="password required" title="Password required">[locked]</span>
              {/if}
              {room.title}
            </span>
            <span class="block text-sm opacity-70">
              {#if room.hostLabel !== ""}hosted by {room.hostLabel} · {/if}
              {formatRoomPhase(room.phase)} · {formatRoomAge(room.createdAt, fetchedAt)}
            </span>
          </span>
          <span class="shrink-0 text-sm">
            {room.playerCount}/{room.playerCap}
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
