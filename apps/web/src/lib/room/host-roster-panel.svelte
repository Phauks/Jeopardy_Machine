<script lang="ts">
  // THE ROSTER PANEL: everything the room knows about the people in it, and every power the
  // host has over them, on one rail beside the running console (owner, 2026-08-17: "You should
  // show all player data, so host can force renaming of teams, names, kicking, etc. Also show
  // spectators").
  //
  // Three rules shape it:
  //
  // 1. IN PLACE, NEVER A SCREEN. It opens as a rail that narrows the console, exactly like the
  //    settings cog, so the board, the clue and the judge row stay live and the keyboard
  //    shortcuts keep working while a host renames somebody
  //    (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md).
  // 2. CONTROL CHROME IS NOT THEMED. Every color and face here is a --control-* token
  //    (src/lib/theme/tokens.css): a panel a host reads under pressure must be legible under a
  //    theme nobody has authored yet. Player and team COLORS still show as swatches - those are
  //    data about a person, not the panel's styling.
  // 3. NEVER INVENT A NUMBER. Spectators hold no seat, so this panel reports the room's count or
  //    says it has none - never a plausible zero (room-view.ts, `spectatorCount`). The same goes
  //    for the caps: they render only once the room has actually reported its settings.
  //
  // Every action is one the protocol already grants the host (packages/protocol/src/room/
  // client-messages.ts): rename-player, kick-player, team-update (host names the team),
  // team-kick, team-handoff, and team-join carrying a playerId (the host seating somebody).
  // Destructive ones live behind a per-row "..." and a kick asks twice - the owner's standing
  // rule for administrative actions, and the reason a slip of the mouse cannot end a player's
  // night.
  import AvatarChip from "#lib/avatars/avatar-chip.svelte";
  import { accentById, avatarById, avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import { buzzSoundLabel } from "#lib/room/buzz-sound-catalog.ts";
  import {
    applyPlayerRename,
    applyTeamRename,
    applyTeamSelection,
  } from "#lib/room/host-roster-actions.ts";
  import { standingsFor } from "#lib/room/room-view.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { RoomPlayerView } from "#lib/room/room-view.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    onClose: () => void;
    /**
     * Start with one row's "..." menu open. The console never passes it; SSR tests do, because
     * apps/web renders components on the server and cannot click a trigger (the same reason the
     * console takes `settingsOpen`).
     */
    openMenu?: string | null;
  };
  let { store, onClose, openMenu = null }: Props = $props();

  const view = $derived(store.view);
  const roster = $derived(view.roster);
  // Join order, which is the order the room happened in - and the order the teams' succession
  // rule uses, so a host reading this list can see who inherits a team next.
  const players = $derived(roster.players.toSorted((left, right) => left.joinedAt - right.joinedAt));
  const connectedCount = $derived(players.filter((player) => player.connected).length);
  const scoreByEntity = $derived(
    new Map(standingsFor(view).map((row) => [row.entityId, row.score])),
  );
  const unteamed = $derived(players.filter((player) => player.teamId === null));

  // svelte-ignore state_referenced_locally - deliberately the INITIAL value only.
  let openMenuFor = $state<string | null>(openMenu);
  let confirmKickFor = $state<string | null>(null);
  let renamingPlayer = $state<string | null>(null);
  let playerNameDraft = $state("");
  let renamingTeam = $state<string | null>(null);
  let teamNameDraft = $state("");

  function teamName(teamId: string | null): string | null {
    if (teamId === null) return null;
    return roster.teams.find((team) => team.teamId === teamId)?.name ?? null;
  }

  /** The score this row is playing for: the team's in teams mode, their own otherwise. */
  function scoreFor(player: RoomPlayerView): number | null {
    return scoreByEntity.get(player.teamId ?? player.playerId) ?? null;
  }

  /** Already this team's leader? Then "make leader" would be a control that does nothing. */
  function isTeamLeader(player: RoomPlayerView): boolean {
    return roster.teams.some(
      (team) => team.teamId === player.teamId && team.leaderPlayerId === player.playerId,
    );
  }

  function teamColorHex(colorId: string | null): string {
    return avatarManifest.accents.find((entry) => entry.id === colorId)?.hex ?? "transparent";
  }

  function beginPlayerRename(player: RoomPlayerView): void {
    openMenuFor = null;
    renamingPlayer = player.playerId;
    playerNameDraft = player.nickname;
  }

  function commitPlayerRename(playerId: string): void {
    renamingPlayer = null;
    applyPlayerRename(store, playerId, playerNameDraft);
  }

  function commitTeamRename(teamId: string): void {
    renamingTeam = null;
    applyTeamRename(store, teamId, teamNameDraft);
  }
</script>

<aside class="roster-panel" aria-label="Room roster">
  <header class="panel-head">
    <h2>Roster</h2>
    <button type="button" class="control-chip" onclick={onClose}>Close</button>
  </header>

  <!-- THE CENSUS. Players are counted from the roster (they hold seats); the audience is
       whatever the room reported, and nothing at all when it reported nothing. -->
  <dl class="census">
    <dt>Players</dt>
    <dd data-census="players">
      {connectedCount} connected of {players.length}
      {#if view.settingsKnown}
        <span class="muted">· cap {view.settings.maxPlayers}</span>
      {/if}
    </dd>
    <dt>Teams</dt>
    <dd data-census="teams">{roster.teams.length}</dd>
    <dt>Spectators</dt>
    <dd data-census="spectators">
      {#if !view.settingsKnown && roster.spectatorCount === null}
        <span class="muted">not loaded yet</span>
      {:else if view.settingsKnown && !view.settings.spectatorsAllowed}
        <span class="muted">not allowed in this room</span>
      {:else if roster.spectatorCount === null}
        <!-- The honest empty: spectators hold no seat, so only a live room can count them, and
             a console that printed "0 watching" here would be making it up. -->
        <span class="muted">this room does not report its audience</span>
      {:else}
        {roster.spectatorCount} watching
        {#if view.settingsKnown}
          <span class="muted">· cap {view.settings.maxSpectators}</span>
        {/if}
      {/if}
    </dd>
  </dl>
  <p class="note">
    Spectators watch anonymously - they take no seat and give no name, so there is no list of
    them to show.
  </p>

  <section class="group">
    <h3>Players</h3>
    {#if players.length === 0}
      <p class="empty">
        Nobody has joined yet. Players arrive by scanning the code or typing <strong
          >{view.roomCode}</strong
        >.
      </p>
    {/if}
    <ul class="rows">
      {#each players as player (player.playerId)}
        {@const avatar = avatarById(player.avatarId)}
        {@const score = scoreFor(player)}
        {@const team = teamName(player.teamId)}
        <li class="row" class:away={!player.connected} data-player-id={player.playerId}>
          <span class="chip-slot">
            {#if avatar !== null}
              <AvatarChip {avatar} accent={accentById(player.accentId)} size="24px" />
            {/if}
          </span>
          {#if renamingPlayer === player.playerId}
            <!-- Renaming happens ON the row, so the list keeps its order and its position and
                 the host never loses their place in a room of thirty. -->
            <input
              class="rename-field"
              type="text"
              aria-label="Rename {player.nickname}"
              maxlength={limits.player.nicknameMaxLength}
              bind:value={playerNameDraft}
              onblur={() => {
                commitPlayerRename(player.playerId);
              }}
              onkeydown={(event) => {
                if (event.key === "Enter") commitPlayerRename(player.playerId);
                if (event.key === "Escape") renamingPlayer = null;
              }}
            />
          {:else}
            <span class="row-name">{player.nickname}</span>
          {/if}
          {#if team !== null}
            <span class="badge team-badge">{team}</span>
          {:else if roster.teams.length > 0}
            <span class="badge">no team</span>
          {/if}
          {#if score !== null}
            <span class="score">{score}</span>
          {/if}
          <span class="state" class:connected={player.connected}>
            {player.connected ? "here" : "away"}
          </span>
          <div class="overflow">
            <button
              type="button"
              class="overflow-trigger"
              aria-haspopup="menu"
              aria-expanded={openMenuFor === player.playerId}
              aria-label="Actions for {player.nickname}"
              onclick={() => {
                openMenuFor = openMenuFor === player.playerId ? null : player.playerId;
                confirmKickFor = null;
              }}
            >
              ...
            </button>
            {#if openMenuFor === player.playerId}
              <div class="overflow-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => {
                    beginPlayerRename(player);
                  }}
                >
                  Rename player
                </button>
                {#if roster.teams.length > 0}
                  <label class="menu-field">
                    Move to team
                    <select
                      value={player.teamId ?? ""}
                      onchange={(event) => {
                        const next = event.currentTarget.value;
                        openMenuFor = null;
                        applyTeamSelection(store, player.playerId, next);
                      }}
                    >
                      <option value="">No team</option>
                      {#each roster.teams as team (team.teamId)}
                        <option value={team.teamId}>{team.name}</option>
                      {/each}
                    </select>
                  </label>
                {/if}
                {#if player.teamId !== null && !isTeamLeader(player)}
                  <button
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      openMenuFor = null;
                      store.handOffLeadership(player.playerId);
                    }}
                  >
                    Make team leader
                  </button>
                {/if}
                {#if confirmKickFor === player.playerId}
                  <!-- Asked twice on purpose: a kick closes somebody's phone mid-evening. -->
                  <button
                    type="button"
                    role="menuitem"
                    class="destructive"
                    onclick={() => {
                      openMenuFor = null;
                      confirmKickFor = null;
                      store.kickFromRoom(player.playerId);
                    }}
                  >
                    Confirm: remove {player.nickname}
                  </button>
                {:else}
                  <button
                    type="button"
                    role="menuitem"
                    class="destructive"
                    onclick={() => {
                      confirmKickFor = player.playerId;
                    }}
                  >
                    Remove from room
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>

  {#if roster.teams.length > 0}
    <section class="group">
      <h3>Teams</h3>
      <ul class="rows">
        {#each roster.teams as team (team.teamId)}
          {@const members = players.filter((player) => player.teamId === team.teamId)}
          {@const leader = team.leaderPlayerId}
          <li class="team-row" data-team-id={team.teamId}>
            <div class="row">
              <span class="color-swatch" style="background: {teamColorHex(team.colorId)}"></span>
              {#if renamingTeam === team.teamId}
                <input
                  class="rename-field"
                  type="text"
                  aria-label="Rename {team.name}"
                  maxlength={limits.team.teamNameMaxLength}
                  bind:value={teamNameDraft}
                  onblur={() => {
                    commitTeamRename(team.teamId);
                  }}
                  onkeydown={(event) => {
                    if (event.key === "Enter") commitTeamRename(team.teamId);
                    if (event.key === "Escape") renamingTeam = null;
                  }}
                />
              {:else}
                <span class="row-name">{team.name}</span>
              {/if}
              {#if scoreByEntity.get(team.teamId) !== undefined}
                <span class="score">{scoreByEntity.get(team.teamId)}</span>
              {/if}
              {#if team.locked}
                <span class="badge">locked</span>
              {/if}
              <div class="overflow">
                <button
                  type="button"
                  class="overflow-trigger"
                  aria-haspopup="menu"
                  aria-expanded={openMenuFor === team.teamId}
                  aria-label="Actions for {team.name}"
                  onclick={() => {
                    openMenuFor = openMenuFor === team.teamId ? null : team.teamId;
                  }}
                >
                  ...
                </button>
                {#if openMenuFor === team.teamId}
                  <div class="overflow-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onclick={() => {
                        openMenuFor = null;
                        renamingTeam = team.teamId;
                        teamNameDraft = team.name;
                      }}
                    >
                      Rename team
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onclick={() => {
                        openMenuFor = null;
                        store.updateTeam({ locked: !team.locked }, team.teamId);
                      }}
                    >
                      {team.locked ? "Unlock team" : "Lock team"}
                    </button>
                  </div>
                {/if}
              </div>
            </div>
            <p class="members">
              {#if members.length === 0}
                <span class="muted">empty</span>
              {:else}
                {#each members as member (member.playerId)}
                  <span class="member" class:away={!member.connected}>
                    {member.nickname}{member.playerId === leader ? " (leader)" : ""}
                  </span>
                {/each}
              {/if}
            </p>
            <p class="members muted">Buzz sound: {buzzSoundLabel(team.buzzSoundId)}</p>
          </li>
        {/each}
      </ul>
      {#if unteamed.length > 0}
        <p class="note">
          Not on a team yet: {unteamed.map((player) => player.nickname).join(", ")}
        </p>
      {/if}
    </section>
  {/if}
</aside>

<style>
  /* CONTROL CHROME, NOT THEMED. Everything below paints from --control-* (tokens.css): the
     roster is where a host renames somebody in a hurry, and it must read the same under the
     paper theme, the retro theme, and whatever a host authors next. The only themed things on
     this panel are the AVATAR chips and the team color swatch, which are data about people. */
  .roster-panel {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    width: 21rem;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    padding: 0.8rem 0.9rem 1.2rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-page);
    color: var(--control-text);
    font-family: var(--control-font);
    font-size: 0.9rem;
    line-height: 1.35;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .panel-head h2 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .census {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.6rem;
    margin: 0;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-raised);
    font-size: 0.82rem;
  }

  .census dt {
    color: var(--control-text-muted);
  }

  .census dd {
    margin: 0;
  }

  .muted {
    color: var(--control-text-muted);
  }

  .note,
  .empty {
    margin: 0;
    font-size: 0.76rem;
    color: var(--control-text-muted);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .group h3 {
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--control-text-muted);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .team-row {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.35rem 0.4rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-raised);
  }

  li.away .row-name {
    color: var(--control-text-muted);
  }

  .chip-slot {
    width: 24px;
    height: 24px;
    flex: none;
  }

  .color-swatch {
    width: 12px;
    height: 12px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--control-border);
  }

  .row-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename-field {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 0.15rem 0.3rem;
    border: 1px solid var(--control-accent);
    border-radius: var(--control-radius);
    background: var(--control-page);
    color: var(--control-text);
  }

  .badge {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    border: 1px solid var(--control-border);
    color: var(--control-text-muted);
    white-space: nowrap;
    max-width: 7rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .team-badge {
    color: var(--control-text);
  }

  .score {
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
  }

  /* Connection state is a WORD, never a colored dot alone (color is never the only carrier). */
  .state {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--control-danger);
  }

  .state.connected {
    color: var(--control-text-muted);
  }

  .overflow {
    position: relative;
    flex: none;
  }

  .overflow-trigger {
    font: inherit;
    line-height: 1;
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-raised);
    color: var(--control-text);
    cursor: pointer;
  }

  .overflow-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.2rem);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 12rem;
    padding: 0.3rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-raised);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
  }

  .overflow-menu button {
    font: inherit;
    font-size: 0.82rem;
    text-align: left;
    padding: 0.25rem 0.4rem;
    border: none;
    border-radius: var(--control-radius);
    background: transparent;
    color: var(--control-text);
    cursor: pointer;
  }

  .overflow-menu button.destructive {
    color: var(--control-danger);
  }

  .menu-field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.72rem;
    color: var(--control-text-muted);
    padding: 0.25rem 0.4rem;
  }

  .menu-field select {
    font: inherit;
    font-size: 0.82rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-page);
    color: var(--control-text);
  }

  .members {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin: 0;
    font-size: 0.76rem;
  }

  .member.away {
    color: var(--control-text-muted);
  }

  .overflow-trigger:focus-visible,
  .overflow-menu button:focus-visible,
  .control-chip:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 3px solid var(--control-accent);
    outline-offset: 2px;
  }

  .control-chip {
    font: inherit;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-raised);
    color: var(--control-text);
    cursor: pointer;
  }

  @media (max-width: 64rem) {
    .roster-panel {
      width: auto;
      max-height: none;
    }
  }
</style>
