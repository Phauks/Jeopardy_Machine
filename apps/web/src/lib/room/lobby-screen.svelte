<script lang="ts">
  // The A3 lobby: "You're in as X on Team Y" + live roster + explicit waiting state. Your own
  // chip opens post-join customization (identity sheet); team leaders get the same sheet's
  // team tier plus per-member overflow actions on their team card. Buzzer practice is a
  // disarmed demo button - LOCAL feedback only, never room sound (A3 rule).
  import AvatarChip from "#lib/avatars/avatar-chip.svelte";
  import IdentitySheet from "#lib/room/identity-sheet.svelte";
  import TeamCard from "#lib/room/team-card.svelte";
  import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    onPreviewSound?: ((soundId: string) => void) | null;
  };
  let { store, onPreviewSound = null }: Props = $props();

  let sheetOpen = $state(false);
  let practiceFlash = $state(false);

  const view = $derived(store.view);
  const me = $derived(
    view.roster.players.find((player) => player.playerId === view.myPlayerId) ?? null,
  );
  const myTeam = $derived(
    view.roster.teams.find((team) => team.teamId === me?.teamId) ?? null,
  );
  const leadsTeam = $derived(myTeam !== null && myTeam.leaderPlayerId === me?.playerId);
  const unteamedPlayers = $derived(view.roster.players.filter((player) => player.teamId === null));

  function practiceBuzz(): void {
    practiceFlash = true;
    onPreviewSound?.(me?.buzzSoundId ?? "");
    setTimeout(() => {
      practiceFlash = false;
    }, 350);
  }

  function avatarFor(playerAvatarId: string | null) {
    return avatarManifest.avatars.find((entry) => entry.id === playerAvatarId) ?? null;
  }

  function accentFor(playerAccentId: string | null) {
    return (
      avatarManifest.accents.find((entry) => entry.id === playerAccentId) ??
      avatarManifest.accents[0]
    );
  }
</script>

<section class="lobby-screen">
  {#if me !== null}
    <header class="you-line">
      {#if avatarFor(me.avatarId) && accentFor(me.accentId)}
        {@const avatar = avatarFor(me.avatarId)}
        {@const accent = accentFor(me.accentId)}
        {#if avatar && accent}
          <button
            type="button"
            class="self-chip"
            aria-label="Customize your appearance"
            onclick={() => {
              sheetOpen = true;
            }}
          >
            <AvatarChip {avatar} {accent} size="44px" />
          </button>
        {/if}
      {/if}
      <p>
        You're in as <strong>{me.nickname}</strong>
        {#if myTeam !== null}
          on <strong>{myTeam.name}</strong>
        {/if}
        <button
          type="button"
          class="edit-link"
          onclick={() => {
            sheetOpen = true;
          }}
        >
          change look
        </button>
      </p>
    </header>

    <button type="button" class="practice-buzzer" class:flash={practiceFlash} onclick={practiceBuzz}>
      Buzzer practice
      <span class="practice-note">disarmed - plays on your phone only</span>
    </button>
  {/if}

  <p class="waiting-line" role="status">Waiting for the host to start...</p>

  {#if view.teamsMode}
    <div class="team-grid">
      {#each view.roster.teams as team (team.teamId)}
        <TeamCard
          {team}
          members={view.roster.players.filter((player) => player.teamId === team.teamId)}
          viewerPlayerId={view.myPlayerId}
          viewerIsAdmin={team.teamId === myTeam?.teamId && leadsTeam}
          onKick={(playerId) => {
            store.kickFromTeam(playerId);
          }}
          onHandOff={(playerId) => {
            store.handOffLeadership(playerId);
          }}
          onEditSelf={() => {
            sheetOpen = true;
          }}
        />
      {/each}
    </div>
    {#if unteamedPlayers.length > 0}
      <p class="unteamed-line">
        Solo: {unteamedPlayers.map((player) => player.nickname).join(", ")}
      </p>
    {/if}
  {:else}
    <ul class="solo-roster">
      {#each view.roster.players as player (player.playerId)}
        {@const avatar = avatarFor(player.avatarId)}
        {@const accent = accentFor(player.accentId)}
        <li class:away={!player.connected}>
          {#if avatar && accent}
            <AvatarChip {avatar} {accent} size="24px" />
          {/if}
          {player.nickname}{player.playerId === view.myPlayerId ? " (you)" : ""}
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if sheetOpen && me !== null}
  <IdentitySheet
    player={me}
    leaderOfTeam={leadsTeam ? myTeam : null}
    teamsMode={view.teamsMode}
    onUpdateIdentity={(patch) => {
      store.updateIdentity(patch);
    }}
    onUpdateTeam={(patch) => {
      store.updateTeam(patch);
    }}
    onPreviewSound={onPreviewSound}
    onClose={() => {
      sheetOpen = false;
    }}
  />
{/if}

<style>
  .lobby-screen {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-width: 34rem;
    margin: 0 auto;
    padding: 1rem 1rem 2.5rem;
    color: var(--surface-text);
  }

  .you-line {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }

  .you-line p {
    margin: 0;
    font-size: 1.05rem;
  }

  .self-chip {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    border-radius: 50%;
  }

  .edit-link {
    background: none;
    border: none;
    padding: 0;
    margin-left: 0.5rem;
    font-size: 0.8rem;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .practice-buzzer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1.05rem;
    padding: 1rem;
    border-radius: 12px;
    border: 2px dashed var(--surface-border);
    background: var(--surface-raised);
    color: var(--surface-text-muted);
    cursor: pointer;
    transition: background 120ms;
  }

  .practice-buzzer.flash {
    background: color-mix(in srgb, var(--accent) 30%, var(--surface-raised));
    color: var(--surface-text);
  }

  .practice-note {
    font-size: 0.68rem;
    text-transform: none;
    letter-spacing: 0.02em;
  }

  .waiting-line {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.85rem;
    color: var(--surface-text-muted);
    text-align: center;
    margin: 0;
  }

  .team-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.6rem;
  }

  .unteamed-line {
    font-size: 0.85rem;
    color: var(--surface-text-muted);
    margin: 0;
  }

  .solo-roster {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .solo-roster li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .solo-roster li.away {
    opacity: 0.55;
  }

  .self-chip:focus-visible,
  .edit-link:focus-visible,
  .practice-buzzer:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
