<script lang="ts">
  // A2, first half: THE IDENTITY MOMENT. Who are you, and what do you look like.
  //
  // This used to be one screen carrying identity, sounds, and team choice together, and the
  // identity half was three lines squeezed above a grid of team cards. It is its own screen
  // now because it is the only moment in the whole product that is about the player rather
  // than the game, and because the team choice needs the staged lobby beside it (the boats,
  // src/lib/staging/) which there was no room for.
  //
  // The preview is the animated walk sheet - it MOVES, which is the point (tier 2 of
  // docs/decisions/2026-08-14-avatars-in-motion.md, one of exactly two places it is allowed).
  // Everything else on the screen is arranged around it: pick a body, pick a colour, watch it
  // walk, name it, go.
  import AvatarAnimated from "#lib/avatars/avatar-animated.svelte";
  import AvatarPicker from "#lib/avatars/avatar-picker.svelte";
  import BuzzSoundPicker from "#lib/room/buzz-sound-picker.svelte";
  import { accentById, avatarById, avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { RoomRosterView } from "#lib/room/room-view.ts";

  export type CharacterChoice = {
    nickname: string;
    avatarId: string | null;
    accentId: string | null;
    buzzSoundId: string | null;
  };

  type Props = {
    roomCode: string;
    roster: RoomRosterView;
    /** Drives the continue button's wording: teams mode has one more question to ask. */
    teamsMode: boolean;
    /** True for a phone arriving mid-game - it goes straight to the buzzer after this. */
    lateJoin?: boolean;
    onConfirm: (choice: CharacterChoice) => void;
    onPreviewSound?: ((soundId: string) => void) | null;
  };
  let {
    roomCode,
    roster,
    teamsMode,
    lateJoin = false,
    onConfirm,
    onPreviewSound = null,
  }: Props = $props();

  let nickname = $state("");
  let avatarId = $state<string | null>(avatarManifest.avatars[0]?.id ?? null);
  let accentId = $state<string>(avatarManifest.accents[0]?.id ?? "gold");
  let buzzSoundId = $state<string | null>(null);
  let validationMessage = $state<string | null>(null);
  /** Suppresses the inline error until the player has actually tried to continue once. */
  let attempted = $state(false);

  const previewAvatar = $derived(avatarById(avatarId));
  const previewAccent = $derived(accentById(accentId));
  const trimmedNickname = $derived(nickname.trim());
  const nameReady = $derived(trimmedNickname.length >= limits.player.nicknameMinLength);

  /** A2: "duplicate names get an auto-suffix" - an error here would be pure friction. */
  function uniqueNickname(candidate: string): string {
    const taken = new Set(roster.players.map((player) => player.nickname.toLowerCase()));
    if (!taken.has(candidate.toLowerCase())) return candidate;
    let suffix = 2;
    while (taken.has(`${candidate.toLowerCase()} ${String(suffix)}`)) suffix += 1;
    return `${candidate} ${String(suffix)}`;
  }

  function confirm(): void {
    attempted = true;
    if (!nameReady) {
      validationMessage = "Tell us what to call you first";
      return;
    }
    validationMessage = null;
    onConfirm({
      nickname: uniqueNickname(trimmedNickname),
      avatarId,
      accentId,
      buzzSoundId,
    });
  }

  const continueLabel = $derived(
    lateJoin ? "Join the game" : teamsMode ? "Next: pick a team" : "Join the room",
  );
</script>

<section class="character-screen">
  <header class="screen-header">
    <p class="room-line">Room <strong>{roomCode}</strong></p>
    <h1>Choose your character</h1>
  </header>

  <!-- The preview leads. It is the largest thing on the screen and it is moving, which is what
       makes an avatar grid feel like a character select rather than a settings form. -->
  <div class="preview">
    {#if previewAvatar !== null}
      <AvatarAnimated avatar={previewAvatar} accent={previewAccent} size="min(44vw, 168px)" />
      <p class="preview-name">{previewAvatar.displayName}</p>
    {/if}
    <p class="preview-hint">Tap a colour or a creature below - the preview follows.</p>
  </div>

  <div class="field-group">
    <label class="field-label" for="character-nickname">Your name</label>
    <input
      id="character-nickname"
      type="text"
      maxlength={limits.player.nicknameMaxLength}
      autocomplete="off"
      enterkeyhint="go"
      placeholder="What should the room call you?"
      aria-invalid={attempted && !nameReady}
      bind:value={nickname}
      onkeydown={(event) => {
        if (event.key === "Enter") confirm();
      }}
    />
    {#if validationMessage !== null && !nameReady}
      <p class="validation" role="alert">{validationMessage}</p>
    {:else}
      <p class="field-note">
        Up to {limits.player.nicknameMaxLength} characters. You can change it later.
      </p>
    {/if}
  </div>

  <h2 class="section-label">Look</h2>
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
      <span class="section-note">yours plays on your phone; the room hears your team's sound</span>
    {/if}
  </h2>
  <BuzzSoundPicker
    selectedSoundId={buzzSoundId}
    onSelect={(soundId) => {
      buzzSoundId = soundId;
    }}
    onPreview={onPreviewSound}
  />

  <!-- Sticky, because the pickers are long and the way forward should never be a scroll away. -->
  <div class="continue-bar">
    <button type="button" class="primary" onclick={confirm}>{continueLabel}</button>
  </div>
</section>

<style>
  .character-screen {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-width: 34rem;
    margin: 0 auto;
    padding: 1rem 1rem 1.5rem;
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

  .preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 1rem 0 0.5rem;
  }

  .preview-name {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.9rem;
    color: var(--surface-text);
  }

  .preview-hint,
  .field-note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--surface-text-muted);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field-label,
  .section-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.78rem;
    color: var(--surface-text-muted);
    margin: 0.5rem 0 0;
  }

  .section-note {
    display: block;
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.7rem;
    opacity: 0.85;
  }

  input[type="text"] {
    font: inherit;
    font-size: 1.1rem;
    padding: 0.7rem 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
  }

  input[aria-invalid="true"] {
    border-color: var(--score-negative);
  }

  .validation {
    color: var(--score-negative);
    font-size: 0.8rem;
    margin: 0;
  }

  .continue-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    padding: 0.75rem 0 max(0.75rem, env(safe-area-inset-bottom));
    margin-top: 0.5rem;
    background: linear-gradient(transparent, var(--surface-page) 35%);
  }

  .primary {
    flex: 1;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1.15rem;
    padding: 0.9rem 1rem;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    cursor: pointer;
  }

  .primary:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
