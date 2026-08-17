<script lang="ts">
  // THE TEAMS REGION of the one pre-game surface: the staged lobby, the team cards, and real
  // team management for players.
  //
  // It replaces team-screen.svelte. The old screen only existed while you were teamless - it
  // was shown by the stage chain when your teamId was null and unmounted the instant it stopped
  // being - so the moment you joined a team, every other team disappeared and there was no way
  // to move. This region is mounted the whole time, and it is what makes the three abilities
  // the owner asked for possible at all (docs/decisions/2026-08-16-persistent-layout-and-
  // pregame-rework.md, "Team management belongs to players"):
  //
  //   create  - the form below, present whether or not you have a team
  //   move    - every other card keeps a button, reading "Move here" once you are on one
  //   rename  - leaders, in place on their own card, behind the "..." (team-card.svelte)
  //
  // It is also live BEFORE you have a seat: you can see who is on which team while you are
  // still choosing a name. Only the actions wait for the seat.
  import StagedLobby from "#lib/staging/staged-lobby.svelte";
  import TeamCard from "#lib/room/team-card.svelte";
  import { limits } from "@jeopardy/protocol/limits";
  import { stagingFromRoom } from "#lib/staging/room-staging.ts";
  import { stagingThemeById } from "#lib/staging/staging-theme-registry.ts";
  import { refusalCopy } from "#lib/room/room-refusal.ts";
  import { teamNameProblem, teamNameProblemCopy } from "#lib/room/pre-game.ts";
  import type { PreGameRegions } from "#lib/room/pre-game.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    regions: PreGameRegions;
    /** Staging theme id - the theme document's `staging` slot (staging-theme-registry.ts). */
    stagingThemeId?: string | null;
  };
  let { store, regions, stagingThemeId = null }: Props = $props();

  let newTeamName = $state("");
  let createProblem = $state<string | null>(null);

  const view = $derived(store.view);
  const theme = $derived(stagingThemeById(stagingThemeId));
  const staging = $derived(stagingFromRoom(view));
  // The room's own answer to the last thing this phone tried - a locked team, a team disbanded
  // while the screen was open, the team cap. Team-level refusals keep the connection, so this
  // is a notice on a working screen rather than an error page.
  const refused = $derived(view.refusal === null ? null : refusalCopy(view.refusal.reason));

  function createTeam(event: SubmitEvent): void {
    event.preventDefault();
    const problem = teamNameProblem(newTeamName, regions);
    if (problem !== null) {
      createProblem = teamNameProblemCopy(problem);
      return;
    }
    createProblem = null;
    const name = newTeamName.trim();
    newTeamName = "";
    // Creating a team makes you its leader and moves you out of the holding area in the same
    // beat (user-flows "Teams & leadership") - the store does both.
    store.createTeam(name);
  }
</script>

<section class="teams-panel" aria-label="Teams">
  <header class="region-head">
    <h2 class="region-heading">Teams</h2>
    <p class="region-note">
      {#if !regions.teams.actionable}
        Pick a name and join to take a {theme.stationNoun}.
      {:else if regions.teams.hasTeam}
        Tap another {theme.stationNoun} to move - the whole room watches you cross.
      {:else}
        You are in {theme.holdingAreaNoun}. Tap a {theme.stationNoun} to {theme.boardVerb} it.
      {/if}
    </p>
  </header>

  <!-- The staged view is an affordance, not decoration: tapping a station boards that team,
       exactly like the card below it. Its box is reserved so the panel does not jump when the
       3D stage finishes loading or a team appears. -->
  <div class="stage">
    <StagedLobby
      {theme}
      stations={staging.stations}
      occupants={staging.occupants}
      waitingEntityIds={staging.waitingEntityIds}
      selectedStationId={regions.teams.myTeamId}
      onSelectStation={(stationId) => {
        if (regions.teams.actionable) store.joinTeam(stationId);
      }}
    />
  </div>

  <!-- Always rendered, so a refusal arriving does not shove the cards down the screen. -->
  <p class="refusal" role="status" aria-live="polite" class:empty={refused === null}>
    {#if refused !== null}
      <strong>{refused.headline}</strong>
      {#if refused.advice !== null}<span>{refused.advice}</span>{/if}
    {/if}
  </p>

  <div class="team-grid">
    {#each view.roster.teams as team (team.teamId)}
      <TeamCard
        {team}
        members={view.roster.players.filter((player) => player.teamId === team.teamId)}
        viewerPlayerId={view.myPlayerId}
        viewerIsAdmin={regions.teams.leadsTeam && team.teamId === regions.teams.myTeamId}
        viewerHasTeam={regions.teams.hasTeam}
        onJoin={regions.teams.actionable
          ? (teamId) => {
              store.joinTeam(teamId);
            }
          : null}
        onRename={(name) => {
          store.updateTeam({ name }, team.teamId);
        }}
        onLeave={() => {
          store.leaveTeam();
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
      <span>{regions.teams.hasTeam ? "Start another team" : "Start a new team"}</span>
      <input
        type="text"
        maxlength={limits.team.teamNameMaxLength}
        placeholder="Team name"
        disabled={!regions.teams.canCreateTeam}
        bind:value={newTeamName}
      />
    </label>
    <button type="submit" class="secondary" disabled={!regions.teams.canCreateTeam}>
      Create and lead
    </button>
  </form>
  <p class="validation" role={createProblem === null ? undefined : "alert"} aria-live="polite">
    {#if createProblem !== null}
      {createProblem}
    {:else if regions.teams.atTeamCap}
      {teamNameProblemCopy("at-cap")}
    {/if}
  </p>
</section>

<style>
  .teams-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    color: var(--surface-text);
    min-width: 0;
  }

  .region-heading {
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 5vw, 1.9rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }

  .region-note {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--surface-text-muted);
    /* Two lines' worth, always: the sentence changes as you move between states and the cards
       below it must not slide up and down when it does. */
    min-height: 2.5rem;
  }

  .stage {
    min-height: 13rem;
    margin: 0.2rem 0;
  }

  .refusal {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
    min-height: 1.2rem;
    font-family: var(--font-chrome);
    font-size: 0.9rem;
    color: var(--surface-text);
  }

  .refusal.empty {
    /* Keeps its reserved line without announcing an empty status to a screen reader. */
    visibility: hidden;
  }

  .refusal span {
    color: var(--surface-text-muted);
    font-size: 0.85em;
  }

  .team-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.6rem;
    align-content: start;
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
    margin-top: 0.3rem;
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

  input:disabled {
    opacity: 0.55;
  }

  .validation {
    margin: 0;
    min-height: 1.1rem;
    font-size: 0.82rem;
    line-height: 1.1rem;
    color: var(--score-negative);
  }

  .secondary {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: var(--board-radius);
    cursor: pointer;
    padding: 0.65rem 1rem;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
  }

  .secondary:disabled {
    border-color: var(--surface-border);
    color: var(--surface-text-muted);
    cursor: default;
  }

  .secondary:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
