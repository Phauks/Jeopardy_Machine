<script lang="ts">
  // Post-join customization (owner-specified): joining is not a one-shot identity commitment.
  // Tapping your own chip opens this sheet - nickname, avatar/accent, personal buzzer sound;
  // leaders additionally get the team tier (name, color, team buzz sound, lock) in the same
  // sheet, kept visually separate so the two tiers never blur. Changes apply immediately via
  // the store; the armed-window lock is enforced store-side, not here.
  import AvatarPicker from "#lib/avatars/avatar-picker.svelte";
  import BuzzSoundPicker from "#lib/room/buzz-sound-picker.svelte";
  import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import type { IdentityPatch, TeamPatch } from "#lib/room/room-store.ts";
  import type { RoomPlayerView, RoomTeamView } from "#lib/room/room-view.ts";

  type Props = {
    player: RoomPlayerView;
    /** Present only when the viewer LEADS this team - unlocks the team tier below. */
    leaderOfTeam?: RoomTeamView | null;
    teamsMode: boolean;
    onUpdateIdentity: (patch: IdentityPatch) => void;
    onUpdateTeam?: ((patch: TeamPatch) => void) | null;
    onPreviewSound?: ((soundId: string) => void) | null;
    onClose: () => void;
  };
  let {
    player,
    leaderOfTeam = null,
    teamsMode,
    onUpdateIdentity,
    onUpdateTeam = null,
    onPreviewSound = null,
    onClose,
  }: Props = $props();

  let nicknameDraft = $state("");
  $effect.pre(() => {
    nicknameDraft = player.nickname;
  });

  function commitNickname(): void {
    const trimmed = nicknameDraft.trim();
    if (trimmed.length > 0 && trimmed !== player.nickname) {
      onUpdateIdentity({ nickname: trimmed });
    }
  }
</script>

<button type="button" class="sheet-scrim" aria-label="Close customization" onclick={onClose}
></button>
<div class="identity-sheet" role="dialog" aria-modal="true" aria-label="Customize appearance">
  <header class="sheet-header">
    <h2>Your look</h2>
    <button type="button" class="close" onclick={onClose} aria-label="Close">Done</button>
  </header>

  <label class="field-label" for="identity-nickname">Nickname</label>
  <div class="nickname-row">
    <input
      id="identity-nickname"
      type="text"
      maxlength="24"
      bind:value={nicknameDraft}
      onblur={commitNickname}
    />
  </div>

  <h3 class="tier-label">Avatar and accent</h3>
  <AvatarPicker
    avatars={avatarManifest.avatars}
    accents={avatarManifest.accents}
    selectedAvatarId={player.avatarId}
    selectedAccentId={player.accentId ?? avatarManifest.accents[0]?.id ?? "gold"}
    onSelectAvatar={(avatarId) => {
      onUpdateIdentity({ avatarId });
    }}
    onSelectAccent={(accentId) => {
      onUpdateIdentity({ accentId });
    }}
  />

  <h3 class="tier-label">
    Your buzzer sound
    {#if teamsMode}
      <span class="tier-note">plays on your phone only - the room hears the team's</span>
    {/if}
  </h3>
  <BuzzSoundPicker
    selectedSoundId={player.buzzSoundId}
    onSelect={(soundId) => {
      onUpdateIdentity({ buzzSoundId: soundId });
    }}
    onPreview={onPreviewSound}
  />

  {#if leaderOfTeam !== null && onUpdateTeam !== null}
    {@const team = leaderOfTeam}
    {@const updateTeam = onUpdateTeam}
    <hr class="tier-divider" />
    <h2 class="team-tier-title">Team settings <span class="tier-note">(you lead this team)</span></h2>

    <label class="field-label" for="team-name-field">Team name</label>
    <input
      id="team-name-field"
      type="text"
      maxlength="24"
      value={team.name}
      onchange={(event) => {
        const name = event.currentTarget.value.trim();
        if (name.length > 0) updateTeam({ name });
      }}
    />

    <h3 class="tier-label">Team color</h3>
    <div class="team-color-row" role="group" aria-label="Team color">
      {#each avatarManifest.accents as accent (accent.id)}
        <button
          type="button"
          class="team-swatch"
          class:selected={accent.id === team.colorId}
          style="--swatch-color: {accent.hex}"
          aria-pressed={accent.id === team.colorId}
          aria-label="Team color {accent.id}"
          onclick={() => {
            updateTeam({ colorId: accent.id });
          }}
        ></button>
      {/each}
    </div>

    <h3 class="tier-label">
      Team buzz sound
      <span class="tier-note">the room hears this when your team wins the buzz</span>
    </h3>
    <BuzzSoundPicker
      selectedSoundId={team.buzzSoundId}
      onSelect={(soundId) => {
        updateTeam({ buzzSoundId: soundId });
      }}
      onPreview={onPreviewSound}
    />

    <label class="lock-row">
      <input
        type="checkbox"
        checked={team.locked}
        onchange={(event) => {
          updateTeam({ locked: event.currentTarget.checked });
        }}
      />
      Lock team (no new joiners)
    </label>
  {/if}
</div>

<style>
  .sheet-scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--surface-scrim);
    border: none;
    padding: 0;
    cursor: default;
  }

  .identity-sheet {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 41;
    max-height: 82dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    background: var(--surface-page);
    color: var(--surface-text);
    border-top: 1px solid var(--surface-border);
    border-radius: 12px 12px 0 0;
    padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
  }

  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .sheet-header h2,
  .team-tier-title {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 1.1rem;
    margin: 0;
  }

  .close {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    padding: 0.4rem 0.9rem;
    cursor: pointer;
  }

  .field-label,
  .tier-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.8rem;
    color: var(--surface-text-muted);
    margin: 0;
  }

  .tier-note {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.72rem;
    opacity: 0.8;
  }

  input[type="text"] {
    font: inherit;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
  }

  .tier-divider {
    border: none;
    border-top: 1px solid var(--surface-border);
    margin: 0.4rem 0;
  }

  .team-color-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .team-swatch {
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--swatch-color);
    cursor: pointer;
    padding: 0;
  }

  .team-swatch.selected {
    border-color: currentColor;
    box-shadow: 0 0 0 2px var(--swatch-color);
  }

  .lock-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .close:focus-visible,
  .team-swatch:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
