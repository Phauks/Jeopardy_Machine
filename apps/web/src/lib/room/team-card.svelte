<script lang="ts">
  // One team's card (A2 join tap-target, A3 lobby roster): team color bearing each member's
  // personal avatar chip (the two customization tiers visibly coexisting - user-flows "Teams
  // & leadership"), leader crown, lock state, team buzz sound. Leader/host administrative
  // actions (kick, hand-off) live behind a per-member "..." overflow menu - owner-specified:
  // destructive actions are one deliberate tap away, never always-visible buttons.
  import AvatarChip from "#lib/avatars/avatar-chip.svelte";
  import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import { buzzSoundLabel } from "#lib/room/buzz-sound-catalog.ts";
  import type { RoomPlayerView, RoomTeamView } from "#lib/room/room-view.ts";

  type Props = {
    team: RoomTeamView;
    members: RoomPlayerView[];
    /** The viewing player - drives "(you)" and which overflow actions render. */
    viewerPlayerId?: string | null;
    /** True when the viewer holds admin power over this team (its leader, or the host). */
    viewerIsAdmin?: boolean;
    /** Join-screen mode: the whole card is a tap target. */
    onJoin?: ((teamId: string) => void) | null;
    onKick?: ((playerId: string) => void) | null;
    onHandOff?: ((playerId: string) => void) | null;
    /** Tapping your own chip opens post-join customization (identity sheet). */
    onEditSelf?: (() => void) | null;
  };
  let {
    team,
    members,
    viewerPlayerId = null,
    viewerIsAdmin = false,
    onJoin = null,
    onKick = null,
    onHandOff = null,
    onEditSelf = null,
  }: Props = $props();

  let openMenuFor = $state<string | null>(null);

  const teamHex = $derived(
    avatarManifest.accents.find((entry) => entry.id === team.colorId)?.hex ??
      "var(--surface-border)",
  );

  function accentFor(player: RoomPlayerView) {
    return (
      avatarManifest.accents.find((entry) => entry.id === player.accentId) ??
      avatarManifest.accents[0]
    );
  }

  function avatarFor(player: RoomPlayerView) {
    return avatarManifest.avatars.find((entry) => entry.id === player.avatarId) ?? null;
  }
</script>

<article class="team-card" style="--team-color: {teamHex}" data-team-id={team.teamId}>
  <header class="team-header">
    <h3 class="team-name">{team.name}</h3>
    <span class="team-sound" title="Team buzz sound">{buzzSoundLabel(team.buzzSoundId)}</span>
    {#if team.locked}
      <span class="locked-badge" title="Team locked - no new joiners">locked</span>
    {/if}
  </header>

  <ul class="member-list">
    {#each members as member (member.playerId)}
      {@const avatar = avatarFor(member)}
      {@const accent = accentFor(member)}
      {@const isLeader = member.playerId === team.leaderPlayerId}
      {@const isViewer = member.playerId === viewerPlayerId}
      <li class="member-row" class:away={!member.connected}>
        {#if avatar && accent}
          <AvatarChip {avatar} {accent} size="28px" />
        {/if}
        {#if isViewer && onEditSelf !== null}
          <button type="button" class="member-name self-edit" onclick={onEditSelf}>
            {member.nickname} (you)
          </button>
        {:else}
          <span class="member-name">
            {member.nickname}{isViewer ? " (you)" : ""}
          </span>
        {/if}
        {#if isLeader}
          <span class="crown" title="Team leader" aria-label="Team leader">leader</span>
        {/if}
        {#if !member.connected}
          <span class="away-dot" title="Away">away</span>
        {/if}
        {#if viewerIsAdmin && !isViewer && (onKick !== null || onHandOff !== null)}
          <div class="overflow">
            <button
              type="button"
              class="overflow-trigger"
              aria-haspopup="menu"
              aria-expanded={openMenuFor === member.playerId}
              aria-label="Actions for {member.nickname}"
              onclick={() => {
                openMenuFor = openMenuFor === member.playerId ? null : member.playerId;
              }}
            >
              ...
            </button>
            {#if openMenuFor === member.playerId}
              <div class="overflow-menu" role="menu">
                {#if onHandOff !== null && !isLeader}
                  <button
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      openMenuFor = null;
                      onHandOff(member.playerId);
                    }}
                  >
                    Make leader
                  </button>
                {/if}
                {#if onKick !== null}
                  <button
                    type="button"
                    role="menuitem"
                    class="destructive"
                    onclick={() => {
                      openMenuFor = null;
                      onKick(member.playerId);
                    }}
                  >
                    Kick from team
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
    {#if members.length === 0}
      <li class="member-row empty">No players yet</li>
    {/if}
  </ul>

  {#if onJoin !== null}
    <button
      type="button"
      class="join-button"
      disabled={team.locked}
      onclick={() => {
        onJoin(team.teamId);
      }}
    >
      {team.locked ? "Locked" : "Join this team"}
    </button>
  {/if}
</article>

<style>
  .team-card {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.7rem 0.8rem;
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    border-top: 4px solid var(--team-color);
  }

  .team-header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .team-name {
    font-family: var(--font-chrome);
    font-size: 1.05rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--surface-text);
    margin: 0;
    flex: 1;
  }

  .team-sound {
    font-size: 0.72rem;
    color: var(--surface-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .locked-badge {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--surface-text-muted);
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    padding: 0.05rem 0.35rem;
  }

  .member-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--surface-text);
    position: relative;
  }

  .member-row.away {
    opacity: 0.55;
  }

  .member-row.empty {
    color: var(--surface-text-muted);
    font-size: 0.85rem;
  }

  .member-name {
    font-size: 0.92rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  .self-edit {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .crown {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--board-value-color);
    border: 1px solid currentColor;
    border-radius: var(--board-radius);
    padding: 0.05rem 0.3rem;
  }

  .away-dot {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--surface-text-muted);
  }

  .overflow {
    position: relative;
  }

  .overflow-trigger {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--board-radius);
    color: var(--surface-text-muted);
    font-size: 1rem;
    line-height: 1;
    padding: 0.1rem 0.4rem;
    cursor: pointer;
  }

  .overflow-trigger:hover,
  .overflow-trigger[aria-expanded="true"] {
    border-color: var(--surface-border);
    color: var(--surface-text);
  }

  .overflow-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.2rem);
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 9rem;
    background: var(--surface-page);
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
    overflow: hidden;
  }

  .overflow-menu button {
    background: none;
    border: none;
    color: var(--surface-text);
    font: inherit;
    font-size: 0.88rem;
    text-align: left;
    padding: 0.5rem 0.7rem;
    cursor: pointer;
  }

  .overflow-menu button:hover {
    background: var(--surface-raised);
  }

  .overflow-menu .destructive {
    color: var(--score-negative);
  }

  .join-button {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.5rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--team-color);
    background: transparent;
    color: var(--surface-text);
    cursor: pointer;
  }

  .join-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .join-button:focus-visible,
  .overflow-trigger:focus-visible,
  .self-edit:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
