<script lang="ts">
  // A2, second half: pick a team - with the staged lobby above the cards, showing you where
  // you are while you decide.
  //
  // You are already IN the room by the time you get here: the character screen took your seat,
  // so you are standing in the holding area (the water, with the boats theme) and everyone
  // else can see you there. Tapping a team is the move, and the staged view is where the move
  // happens - the same picture the projector is showing the room. That is the whole reason
  // this is its own screen rather than a grid at the bottom of the join form.
  //
  // The overflow menu rule is the owner's and is enforced by test: kick, hand-off, and lock
  // are administrative actions and live one deliberate tap behind "...", never as buttons
  // sitting next to a teammate's name.
  import StagedLobby from "#lib/staging/staged-lobby.svelte";
  import TeamCard from "#lib/room/team-card.svelte";
  import { limits } from "@jeopardy/protocol/limits";
  import { stagingFromRoom } from "#lib/staging/room-staging.ts";
  import { stagingThemeById } from "#lib/staging/staging-theme-registry.ts";
  import { refusalCopy } from "#lib/room/room-refusal.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    /** Staging theme id - the theme document's `staging` slot (staging-theme-registry.ts). */
    stagingThemeId?: string | null;
    /** "Play on my own" - the route remembers it so this screen stops asking. */
    onPlaySolo: () => void;
  };
  let { store, stagingThemeId = null, onPlaySolo }: Props = $props();

  let newTeamName = $state("");
  let validationMessage = $state<string | null>(null);

  const view = $derived(store.view);
  const me = $derived(
    view.roster.players.find((player) => player.playerId === view.myPlayerId) ?? null,
  );
  const theme = $derived(stagingThemeById(stagingThemeId));
  const staging = $derived(stagingFromRoom(view));
  const atCap = $derived(view.roster.teams.length >= limits.team.teamMaxCount);
  // The room's own answer to the last thing this phone tried - a locked team, a team that was
  // disbanded while the screen was open (room-refusal.ts turns the protocol's reason into the
  // sentence). Team-level refusals keep the connection, so this is a notice on a working
  // screen rather than an error page: pick another station and carry on.
  const refused = $derived(view.refusal === null ? null : refusalCopy(view.refusal.reason));

  function createTeam(event: SubmitEvent): void {
    event.preventDefault();
    const name = newTeamName.trim();
    if (name.length < limits.team.teamNameMinLength) {
      validationMessage = "Name the team first";
      return;
    }
    if (atCap) {
      validationMessage = `This room already has the maximum ${String(limits.team.teamMaxCount)} teams`;
      return;
    }
    validationMessage = null;
    newTeamName = "";
    // Creating a team makes you its leader (user-flows "Teams & leadership") and moves you
    // out of the holding area in the same beat - the store does both.
    store.createTeam(name);
  }
</script>

<section class="team-screen">
  <header class="screen-header">
    <p class="room-line">Room <strong>{view.roomCode}</strong></p>
    <h1>Pick your team</h1>
    <p class="lede">
      You are in {theme.holdingAreaNoun} until you choose. Tap a {theme.stationNoun} to
      {theme.boardVerb} it - the whole room watches you move across.
    </p>
  </header>

  <!-- The staged view is the primary affordance here, not decoration: tapping a station in it
       boards that team, exactly like tapping the card below. -->
  <div class="stage">
    <StagedLobby
      {theme}
      stations={staging.stations}
      occupants={staging.occupants}
      waitingEntityIds={staging.waitingEntityIds}
      selectedStationId={me?.teamId ?? null}
      onSelectStation={(stationId) => {
        store.joinTeam(stationId);
      }}
    />
  </div>

  {#if refused !== null}
    <p class="refusal" role="status">
      <strong>{refused.headline}</strong>
      {#if refused.advice !== null}
        <span>{refused.advice}</span>
      {/if}
    </p>
  {/if}

  <div class="team-grid">
    {#each view.roster.teams as team (team.teamId)}
      <TeamCard
        {team}
        members={view.roster.players.filter((player) => player.teamId === team.teamId)}
        viewerPlayerId={view.myPlayerId}
        viewerIsAdmin={team.leaderPlayerId === view.myPlayerId}
        onJoin={(teamId) => {
          store.joinTeam(teamId);
        }}
        onKick={(playerId) => {
          store.kickFromTeam(playerId);
        }}
        onHandOff={(playerId) => {
          store.handOffLeadership(playerId);
        }}
        onToggleLock={(locked) => {
          store.updateTeam({ locked }, team.teamId);
        }}
      />
    {/each}
    {#if view.roster.teams.length === 0}
      <p class="no-teams">
        No teams yet. Whoever makes the first one leads it - that could be you.
      </p>
    {/if}
  </div>

  <form class="new-team-row" onsubmit={createTeam}>
    <label class="new-team-field">
      <span>Start a new team</span>
      <input
        type="text"
        maxlength={limits.team.teamNameMaxLength}
        placeholder="Team name"
        bind:value={newTeamName}
      />
    </label>
    <button type="submit" class="secondary" disabled={atCap}>Create and lead</button>
  </form>
  {#if validationMessage !== null}
    <p class="validation" role="alert">{validationMessage}</p>
  {/if}

  <button type="button" class="tertiary" onclick={onPlaySolo}>
    Play on my own instead
  </button>
</section>

<style>
  .refusal {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.9rem;
    color: var(--surface-text);
  }

  .refusal span {
    color: var(--surface-text-muted);
    font-size: 0.85em;
  }

  .team-screen {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-width: 34rem;
    margin: 0 auto;
    padding: 1rem 1rem 2.5rem;
    color: var(--surface-text);
  }

  .screen-header h1 {
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 7vw, 2.6rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }

  .room-line {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--surface-text-muted);
    margin: 0;
  }

  .room-line strong {
    color: var(--board-value-color);
  }

  .lede {
    margin: 0.3rem 0 0;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--surface-text-muted);
  }

  /* A minimum height rather than a fixed one: the 3D stage wants a band to render into, and
     the 2D degradation wants to be as tall as the teams it is listing. */
  .stage {
    min-height: 13rem;
    margin: 0.4rem 0;
  }

  .team-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.6rem;
  }

  .no-teams {
    margin: 0;
    padding: 1rem;
    text-align: center;
    font-size: 0.88rem;
    color: var(--surface-text-muted);
    border: 1px dashed var(--surface-border);
    border-radius: var(--board-radius);
  }

  .new-team-row {
    display: flex;
    align-items: end;
    gap: 0.5rem;
  }

  .new-team-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
  }

  .new-team-field span {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.72rem;
    color: var(--surface-text-muted);
  }

  input[type="text"] {
    font: inherit;
    font-size: 1rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
    min-width: 0;
  }

  .validation {
    color: var(--score-negative);
    font-size: 0.82rem;
    margin: 0;
  }

  .secondary,
  .tertiary {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: var(--board-radius);
    cursor: pointer;
    padding: 0.65rem 1rem;
  }

  .secondary {
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
  }

  .secondary:disabled {
    border-color: var(--surface-border);
    color: var(--surface-text-muted);
    cursor: default;
  }

  .tertiary {
    align-self: center;
    border: none;
    background: transparent;
    color: var(--surface-text-muted);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .secondary:focus-visible,
  .tertiary:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
