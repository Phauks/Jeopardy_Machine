<script lang="ts">
  // The A2 join screen: ONE screen, under 15 seconds - nickname, avatar+accent, buzzer sound
  // (tap to preview locally), team cards in teams mode, Join. No accounts, no prompts,
  // nothing else (guiding principle 3). Validation is inline; duplicate nicknames get an
  // auto-suffix here rather than an error (A2: "duplicate names get an auto-suffix").
  import AvatarPicker from "#lib/avatars/avatar-picker.svelte";
  import BuzzSoundPicker from "#lib/room/buzz-sound-picker.svelte";
  import TeamCard from "#lib/room/team-card.svelte";
  import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import type { JoinRequest } from "#lib/room/room-store.ts";
  import type { RoomRosterView } from "#lib/room/room-view.ts";

  type Props = {
    roomCode: string;
    roster: RoomRosterView;
    teamsMode: boolean;
    onJoin: (request: JoinRequest) => void;
    onPreviewSound?: ((soundId: string) => void) | null;
  };
  let { roomCode, roster, teamsMode, onJoin, onPreviewSound = null }: Props = $props();

  let nickname = $state("");
  let avatarId = $state<string | null>(avatarManifest.avatars[0]?.id ?? null);
  let accentId = $state<string>(avatarManifest.accents[0]?.id ?? "gold");
  let buzzSoundId = $state<string | null>(null);
  let newTeamName = $state("");
  let validationMessage = $state<string | null>(null);

  function uniqueNickname(candidate: string): string {
    const taken = new Set(roster.players.map((player) => player.nickname.toLowerCase()));
    if (!taken.has(candidate.toLowerCase())) return candidate;
    let suffix = 2;
    while (taken.has(`${candidate.toLowerCase()} ${String(suffix)}`)) suffix += 1;
    return `${candidate} ${String(suffix)}`;
  }

  function buildRequest(): Omit<JoinRequest, "team"> | null {
    const trimmed = nickname.trim();
    if (trimmed.length === 0) {
      validationMessage = "Pick a nickname first";
      return null;
    }
    validationMessage = null;
    return { nickname: uniqueNickname(trimmed), avatarId, accentId, buzzSoundId };
  }

  function joinSolo(): void {
    const base = buildRequest();
    if (base !== null) onJoin(base);
  }

  function joinTeam(teamId: string): void {
    const base = buildRequest();
    if (base !== null) onJoin({ ...base, team: { kind: "join", teamId } });
  }

  function createTeam(): void {
    const base = buildRequest();
    const teamName = newTeamName.trim();
    if (base === null) return;
    if (teamName.length === 0) {
      validationMessage = "Name your new team";
      return;
    }
    onJoin({ ...base, team: { kind: "create", name: teamName } });
  }
</script>

<section class="join-screen">
  <header class="join-header">
    <p class="room-line">Room <strong>{roomCode}</strong></p>
    <h1>Join the game</h1>
  </header>

  <label class="field-label" for="join-nickname">Nickname</label>
  <input
    id="join-nickname"
    type="text"
    maxlength="24"
    autocomplete="off"
    placeholder="What should we call you?"
    bind:value={nickname}
  />
  {#if validationMessage !== null}
    <p class="validation" role="alert">{validationMessage}</p>
  {/if}

  <h2 class="section-label">Pick your look</h2>
  <AvatarPicker
    avatars={avatarManifest.avatars}
    accents={avatarManifest.accents}
    selectedAvatarId={avatarId}
    selectedAccentId={accentId}
    onSelectAvatar={(id) => {
      avatarId = id;
    }}
    onSelectAccent={(id) => {
      accentId = id;
    }}
  />

  <h2 class="section-label">
    Buzzer sound
    {#if teamsMode}
      <span class="section-note">
        yours plays on your phone; the room hears your team's sound
      </span>
    {/if}
  </h2>
  <BuzzSoundPicker
    selectedSoundId={buzzSoundId}
    onSelect={(soundId) => {
      buzzSoundId = soundId;
    }}
    onPreview={onPreviewSound}
  />

  {#if teamsMode}
    <h2 class="section-label">Pick your team</h2>
    <div class="team-grid">
      {#each roster.teams as team (team.teamId)}
        <TeamCard
          {team}
          members={roster.players.filter((player) => player.teamId === team.teamId)}
          onJoin={joinTeam}
        />
      {/each}
    </div>
    <form
      class="new-team-row"
      onsubmit={(event) => {
        event.preventDefault();
        createTeam();
      }}
    >
      <input
        type="text"
        maxlength="24"
        placeholder="+ new team name"
        aria-label="New team name"
        bind:value={newTeamName}
      />
      <button type="submit" class="secondary">Create team and join</button>
    </form>
    <button type="button" class="tertiary" onclick={joinSolo}>Join without a team</button>
  {:else}
    <button type="button" class="primary" onclick={joinSolo}>Join</button>
  {/if}
</section>

<style>
  .join-screen {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-width: 34rem;
    margin: 0 auto;
    padding: 1rem 1rem 2.5rem;
    color: var(--surface-text);
  }

  .join-header h1 {
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

  .field-label,
  .section-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.85rem;
    color: var(--surface-text-muted);
    margin: 0.4rem 0 0;
  }

  .section-note {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.72rem;
    opacity: 0.85;
  }

  input[type="text"] {
    font: inherit;
    font-size: 1.05rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
  }

  .validation {
    color: var(--score-negative);
    font-size: 0.85rem;
    margin: 0;
  }

  .team-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.6rem;
  }

  .new-team-row {
    display: flex;
    gap: 0.5rem;
  }

  .new-team-row input {
    flex: 1;
    min-width: 0;
  }

  .primary,
  .secondary,
  .tertiary {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: var(--board-radius);
    cursor: pointer;
    padding: 0.7rem 1rem;
  }

  .primary {
    border: none;
    background: var(--accent);
    color: var(--surface-page);
    font-size: 1.15rem;
  }

  .secondary {
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
  }

  .tertiary {
    border: none;
    background: transparent;
    color: var(--surface-text-muted);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .primary:focus-visible,
  .secondary:focus-visible,
  .tertiary:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
