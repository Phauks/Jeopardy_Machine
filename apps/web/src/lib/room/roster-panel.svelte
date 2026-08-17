<script lang="ts">
  // THE ROOM REGION of the one pre-game surface: who is here, what the room is waiting for, and
  // the disarmed practice buzzer.
  //
  // It is what remains of lobby-screen.svelte once the character half moved to character-panel
  // and the teams half to teams-panel. The A3 lobby was a whole SCREEN that appeared only after
  // you had a team and replaced everything you had been looking at; this is a column that has
  // been on screen since the first paint, filling in as people arrive.
  //
  // Still chips only, deliberately - a roster of walking avatars is noise, not identity
  // (docs/decisions/2026-08-14-avatars-in-motion.md guardrail; the one animated avatar on this
  // surface is your own, in the character panel).
  import AvatarChip from "#lib/avatars/avatar-chip.svelte";
  import { accentById, avatarById } from "#lib/avatars/avatar-manifest.ts";
  import { stagingThemeById } from "#lib/staging/staging-theme-registry.ts";
  import type { PreGameRegions } from "#lib/room/pre-game.ts";
  import type { RoomView } from "#lib/room/room-view.ts";

  type Props = {
    view: RoomView;
    regions: PreGameRegions;
    stagingThemeId?: string | null;
    /** Local-only buzz feedback: the practice button never makes room sound (the A3 rule). */
    onPractice?: (() => void) | null;
  };
  let { view, regions, stagingThemeId = null, onPractice = null }: Props = $props();

  let practiceFlash = $state(false);
  const stagingTheme = $derived(stagingThemeById(stagingThemeId));
  const unteamed = $derived(view.roster.players.filter((player) => player.teamId === null));

  function practice(): void {
    practiceFlash = true;
    onPractice?.();
    setTimeout(() => {
      practiceFlash = false;
    }, 350);
  }
</script>

<section class="roster-panel" aria-label="Who is here">
  <header class="region-head">
    <h2 class="region-heading">In the room</h2>
    <p class="count">
      {view.roster.players.length}
      {view.roster.players.length === 1 ? "player" : "players"}
    </p>
  </header>

  <p class="waiting-line" role="status">
    {#if regions.lateJoin}
      This game is already running - you will land on the buzzer.
    {:else if regions.seated}
      Waiting for the host to start...
    {:else}
      The room is open. Join whenever you are ready.
    {/if}
  </p>

  <ul class="roster">
    {#each view.roster.players as player (player.playerId)}
      {@const avatar = avatarById(player.avatarId)}
      <li class:away={!player.connected} class:you={player.playerId === view.myPlayerId}>
        <span class="chip-slot">
          {#if avatar !== null}
            <AvatarChip {avatar} accent={accentById(player.accentId)} size="26px" />
          {/if}
        </span>
        <span class="roster-name">
          {player.nickname}{player.playerId === view.myPlayerId ? " (you)" : ""}
        </span>
        {#if !player.connected}
          <span class="away-tag">away</span>
        {/if}
      </li>
    {/each}
    {#if view.roster.players.length === 0}
      <li class="empty">Nobody yet - you would be first.</li>
    {/if}
  </ul>

  {#if regions.teams.shown && unteamed.length > 0}
    <p class="unteamed-line">
      Still in {stagingTheme.holdingAreaNoun}: {unteamed
        .map((player) => player.nickname)
        .join(", ")}
    </p>
  {/if}

  <!-- Always rendered so the column's height does not change on join; disabled until there is
       a sound of yours to hear. -->
  <button
    type="button"
    class="practice-buzzer"
    class:flash={practiceFlash}
    disabled={!regions.seated}
    onclick={practice}
  >
    Buzzer practice
    <span class="practice-note">disarmed - plays on your phone only</span>
  </button>
</section>

<style>
  .roster-panel {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    color: var(--surface-text);
    min-width: 0;
  }

  .region-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .region-heading {
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 5vw, 1.9rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }

  .count {
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--surface-text-muted);
  }

  .waiting-line {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--surface-text-muted);
    /* Two lines reserved: the three sentences this can hold are different lengths. */
    min-height: 2.2rem;
  }

  .roster {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .roster li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.92rem;
  }

  /* Reserved whether or not this player picked an avatar, so names line up in one column. */
  .chip-slot {
    width: 26px;
    height: 26px;
    flex: none;
  }

  .roster li.away {
    opacity: 0.55;
  }

  .roster li.you .roster-name {
    color: var(--board-value-color);
  }

  .roster-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .away-tag {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--surface-text-muted);
  }

  .empty {
    color: var(--surface-text-muted);
    font-size: 0.88rem;
  }

  .unteamed-line {
    margin: 0;
    font-size: 0.82rem;
    color: var(--surface-text-muted);
  }

  .practice-buzzer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    margin-top: auto;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1rem;
    padding: 0.9rem;
    border-radius: 12px;
    border: 2px dashed var(--surface-border);
    background: var(--surface-raised);
    color: var(--surface-text-muted);
    cursor: pointer;
    transition: background 120ms;
  }

  .practice-buzzer:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .practice-buzzer.flash {
    background: color-mix(in srgb, var(--accent) 30%, var(--surface-raised));
    color: var(--surface-text);
  }

  .practice-note {
    font-size: 0.66rem;
    text-transform: none;
    letter-spacing: 0.02em;
  }

  .practice-buzzer:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
