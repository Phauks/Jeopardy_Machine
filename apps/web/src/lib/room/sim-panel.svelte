<script lang="ts">
  // The dev-only simulation panel (owner directive "Development simulation", UI level): fake
  // players act without phones - buzz races, single buzzes, disconnects, final auto-fill.
  // Rendered by the host console ONLY when the route passes the local-sim store's controls
  // and the dev flag is on; never reachable by players, never built into player routes.
  import { entityDisplayName } from "#lib/room/room-view.ts";
  import type { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";

  type Props = {
    simStore: LocalSimRoomStore;
  };
  let { simStore }: Props = $props();

  const view = $derived(simStore.view);
  const seatedPlayers = $derived(Object.values(view.game?.players ?? {}));
  let expanded = $state(false);
</script>

<section class="sim-panel">
  <button
    type="button"
    class="sim-toggle"
    aria-expanded={expanded}
    onclick={() => {
      expanded = !expanded;
    }}
  >
    Simulation (dev)
  </button>

  {#if expanded}
    <div class="sim-body">
      <div class="sim-row">
        <button
          type="button"
          onclick={() => {
            simStore.simBuzzRace();
          }}>Mass buzz race</button
        >
        <button
          type="button"
          onclick={() => {
            simStore.simCompleteFinal();
          }}>Auto-fill final</button
        >
        <!-- A display holds no seat, so nothing else in the sim can produce one - and the
             console's game-screen readout is driven by exactly this census
             (src/lib/room/game-screen.ts). Plug one in, pull it out mid-game, watch the header. -->
        <button
          type="button"
          onclick={() => {
            simStore.simSetConnections({ displays: (view.connections?.display ?? 0) > 0 ? 0 : 1 });
          }}
          >{(view.connections?.display ?? 0) > 0 ? "Unplug display" : "Plug in a display"}</button
        >
      </div>
      <ul class="sim-roster">
        {#each view.roster.players.slice(0, 12) as player (player.playerId)}
          <li>
            <span class="sim-name">
              {player.nickname}
              <span class="sim-entity">
                {entityDisplayName(view, player.teamId ?? player.playerId)}
              </span>
            </span>
            <button
              type="button"
              disabled={seatedPlayers.length === 0}
              onclick={() => {
                simStore.simBuzz(player.playerId);
              }}>buzz</button
            >
            <button
              type="button"
              onclick={() => {
                simStore.simSetConnected(player.playerId, !player.connected);
              }}>{player.connected ? "drop" : "reconnect"}</button
            >
          </li>
        {/each}
      </ul>
      <p class="sim-note">
        First 12 of {view.roster.players.length} fixture players shown. Timers:
        {view.pendingTimers.map((timer) => timer.kind).join(", ") || "none"}
      </p>
    </div>
  {/if}
</section>

<style>
  /* Dev chrome convention (dev/+layout.svelte): fixed colors, never themed by the previewed
   * theme - this panel must be visually unmistakable as tooling. */
  .sim-panel {
    border: 1px dashed #6b5bd2;
    border-radius: 6px;
    background: #17151f;
    color: #b9b3d9;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
  }

  .sim-toggle {
    width: 100%;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
  }

  .sim-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0.6rem 0.6rem;
  }

  .sim-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .sim-body button {
    background: #241f33;
    border: 1px solid #4a4370;
    border-radius: 4px;
    color: #d6d1ef;
    font: inherit;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }

  .sim-body button:disabled {
    opacity: 0.5;
  }

  .sim-roster {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 12rem;
    overflow-y: auto;
  }

  .sim-roster li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .sim-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sim-entity {
    opacity: 0.6;
    margin-left: 0.3rem;
  }

  .sim-note {
    margin: 0;
    opacity: 0.7;
  }
</style>
