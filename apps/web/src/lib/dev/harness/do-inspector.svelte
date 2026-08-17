<script lang="ts">
  // The DO inspector block: what the Durable Object believes about itself, beside what the
  // registry believes about it (owner request 2026-08-14, "provide more information about the
  // DO objects"). Presentational - the page owns the fetch and the refresh button.
  //
  // The two-column comparison is the point. A live room whose registry row is missing is the
  // exact shape of the reported bug, and here it is one glance instead of an inference.
  import { formatCountdown } from "#lib/dev/harness/session-rooms.ts";
  import type { RoomInspection } from "@jeopardy/protocol/room/diagnostics";

  type Props = {
    inspection: RoomInspection | null;
    // Wall clock, ticked by the page, so countdowns move without this component owning a timer.
    now: number;
    error: string | null;
  };
  let { inspection, now, error }: Props = $props();

  function clock(at: number): string {
    return new Date(at).toLocaleTimeString();
  }

  // One string rather than interleaved markup: the two budgets read as one sentence, and a
  // template line break can never split "spectators" from the number it belongs to.
  function participants(census: RoomInspection["room"]["participants"]): string {
    const players = `players ${String(census.players.connected)}/${String(census.players.max)} (${String(census.players.seated)} seated)`;
    const spectators = census.spectators.allowed
      ? `spectators ${String(census.spectators.connected)}/${String(census.spectators.max)}`
      : "spectators off";
    return `${players} · ${spectators}`;
  }
</script>

<div class="flex flex-col gap-2 text-sm">
  {#if error !== null}
    <p class="rounded-sm border border-dashed p-2 text-xs">{error}</p>
  {/if}
  {#if inspection === null}
    <p class="opacity-70">
      No reading yet. Inspecting needs the room's host token, so it works for rooms this tab
      created - pick one and refresh.
    </p>
  {:else}
    {@const room = inspection.room}
    <dl class="grid grid-cols-2 gap-x-3 gap-y-1">
      <dt class="opacity-70">room</dt>
      <dd><strong>{room.code}</strong> · {room.lifecycle}{room.paused ? " · PAUSED" : ""}</dd>
      <dt class="opacity-70">listing</dt>
      <dd>
        {room.settings.listing} · {room.settings.entry}{room.settings.hideJoinCode
          ? " · join code hidden"
          : ""}
      </dd>
      <dt class="opacity-70">state version</dt>
      <dd>{room.stateVersion}</dd>
      <dt class="opacity-70">created</dt>
      <dd>{clock(room.createdAt)}</dd>
      <dt class="opacity-70">last activity</dt>
      <dd>{clock(room.lastActivityAt)}</dd>
      <dt class="opacity-70">expires</dt>
      <dd>{clock(room.expiresAt)} (in {formatCountdown(room.expiresAt - now)})</dd>
      <dt class="opacity-70">connections</dt>
      <dd>
        {room.connections.total} total · host {room.connections.host} · players
        {room.connections.player} · display {room.connections.display} · spectators
        {room.connections.spectator} · unjoined {room.connections.unjoined}
      </dd>
      <dt class="opacity-70">roster</dt>
      <dd>
        {room.roster.players} seated ({room.roster.connected} connected) · {room.roster.teams} teams
      </dd>
      <dt class="opacity-70">participants</dt>
      <dd>{participants(room.participants)}</dd>
      <dt class="opacity-70">next alarm</dt>
      <dd>
        {room.alarm.nextWakeAt === null
          ? "none"
          : `${clock(room.alarm.nextWakeAt)} (in ${formatCountdown(room.alarm.nextWakeAt - now)})`}
      </dd>
    </dl>

    <details>
      <summary class="cursor-pointer">Alarm book ({room.alarm.entries.length})</summary>
      <ul class="mt-1 flex flex-col gap-0.5 text-xs">
        {#each room.alarm.entries as entry (`${entry.source}-${entry.label}-${entry.dueAt}`)}
          <li>{entry.source} · {entry.label} · {clock(entry.dueAt)}</li>
        {/each}
      </ul>
    </details>

    <details>
      <summary class="cursor-pointer">
        Storage ({room.storage.totalBytes} bytes across {room.storage.keys.length} keys)
      </summary>
      <ul class="mt-1 flex flex-col gap-0.5 text-xs">
        {#each room.storage.keys as entry (entry.key)}
          <li>{entry.key}: {entry.bytes}</li>
        {/each}
      </ul>
    </details>

    <div class="rounded-sm border p-2">
      <strong class="text-xs">Registry row</strong>
      {#if inspection.registry.status !== "ok"}
        <p class="text-xs">
          The registry could not be read ({inspection.registry.reason}), so nothing here can be
          compared against the lobby.
        </p>
      {:else if inspection.registryRow === null}
        <p class="text-xs">
          NO ROW for a room that exists - this room cannot appear in the lobby, and that is
          drift worth reporting (rows are written at creation, refreshed by the DO).
        </p>
      {:else}
        <p class="text-xs">
          {inspection.registryRow.listed ? "listed in the lobby" : "not listed"} · phase
          {inspection.registryRow.phase} · {inspection.registryRow.playerCount} players · expires
          {clock(inspection.registryRow.expiresAt)}
          {#if inspection.registryRow.endedAt !== null}
            · ended {clock(inspection.registryRow.endedAt)}
          {/if}
        </p>
        {#if inspection.registryRow.phase !== room.lifecycle}
          <p class="text-xs">
            The row says {inspection.registryRow.phase} while the room says {room.lifecycle} - the
            row is a cache and catches up on the next transition.
          </p>
        {/if}
      {/if}
    </div>
  {/if}
</div>
