<script lang="ts">
  // WHO IS HERE, on the host's own screen - the console's one answer to that question.
  //
  // It replaced the lobby's "Pre-flight" checklist at the 2026-08-19 pass (owner: "pre-flight and
  // roster look the exact same, what was the benefit?"). The checklist restated counts that the
  // room itself already knows - players in, teams, connected - as a second list beside the thing
  // it was counting. That is the persistent-layout law applied to information: ONE PLACE PER
  // FACT. So the counts live on the roster that holds the names, the game screen's readiness
  // lives on the game-screen panel that can act on it, and "Start game" became an action in the
  // console header with its reason attached rather than the last line of a checklist.
  //
  // Names, health and teams only: no kick, no rename, no drag-to-rebalance yet (user-flows C2
  // wants them; they are roster-mutation UI and belong to their own pass, not to this one).
  import type { RoomView } from "#lib/room/room-view.ts";

  type Props = { view: RoomView };
  let { view }: Props = $props();

  // Arrival order, and never in place: the roster array on the view is shared state.
  const players = $derived(view.roster.players.toSorted((a, b) => a.joinedAt - b.joinedAt));
  const connected = $derived(players.filter((player) => player.connected).length);
  const teamName = $derived.by(() => {
    const names = new Map(view.roster.teams.map((team) => [team.teamId, team.name]));
    return (teamId: string | null): string | null => (teamId === null ? null : names.get(teamId) ?? null);
  });
  // Spectators hold no seat by design, so they are counted from live CONNECTIONS or not at all
  // (packages/protocol/src/room/diagnostics.ts). Null census = a store that cannot know.
  const spectators = $derived(view.connections?.spectator ?? null);
</script>

<section class="roster-panel" aria-label="Who is here">
  <header class="panel-head">
    <h2>In the room</h2>
    <p class="counts">
      <strong>{connected}</strong>
      <span class="of">of</span>
      {players.length} on a phone
      {#if view.teamsMode}
        <span class="teams-count">· {view.roster.teams.length} teams</span>
      {/if}
    </p>
  </header>

  <ul class="roster">
    {#each players as player (player.playerId)}
      {@const team = teamName(player.teamId)}
      <li class:away={!player.connected}>
        <span class="dot" class:live={player.connected} aria-hidden="true"></span>
        <span class="name">{player.nickname}</span>
        {#if team !== null}
          <span class="team">{team}</span>
        {/if}
        {#if !player.connected}
          <!-- A seat survives a dropped phone (A5): "away" is a health state, never a removal. -->
          <span class="away-tag">away</span>
        {/if}
      </li>
    {/each}
    {#if players.length === 0}
      <li class="empty">Nobody yet - share the code and they will land here.</li>
    {/if}
  </ul>

  {#if spectators !== null && spectators > 0}
    <p class="spectators">{spectators} watching (no seat, no buzzer)</p>
  {/if}
</section>

<style>
  .roster-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.8rem 0.9rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
    min-width: 0;
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .panel-head h2 {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1em;
  }

  .counts {
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.85em;
    color: var(--surface-text-muted);
  }

  .counts strong {
    color: var(--surface-text);
  }

  .of {
    opacity: 0.7;
  }

  .roster {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 18rem;
    overflow-y: auto;
  }

  .roster li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-block: 0.12rem;
    font-size: 0.92em;
  }

  /* Health is never color alone: the away rows carry the word too (accessibility rule, and a
     projector-lit room washes out a green dot anyway). */
  .dot {
    width: 0.5em;
    height: 0.5em;
    border-radius: 999px;
    background: var(--surface-text-muted);
    flex: none;
  }

  .dot.live {
    background: var(--score-positive);
  }

  .roster li.away {
    color: var(--surface-text-muted);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .team {
    font-family: var(--font-chrome);
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.75;
  }

  .away-tag,
  .spectators,
  .empty {
    font-family: var(--font-chrome);
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--surface-text-muted);
  }

  .spectators {
    margin: 0;
  }
</style>
