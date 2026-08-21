<script lang="ts">
  // THE CHARACTER REGION of the one pre-game surface: who you are and what you look like.
  //
  // It replaces character-screen.svelte, and the difference is the whole point of the
  // 2026-08-16 rework. That component was a SCREEN: it owned your name, avatar, accent and
  // sound in its own state, and the moment you pressed Continue it unmounted and the teams
  // appeared in its place. This is a REGION. It is fully controlled - every value arrives as a
  // prop and every change leaves as a callback - which is what lets the same markup serve both
  // sides of taking a seat:
  //
  //   draft - no seat yet; the parent holds the values and sends them with the join.
  //   live  - seated; the parent forwards each change to the room as an identity-update.
  //
  // Identical controls in both. Picking a colour after you have joined is the same tap in the
  // same place as picking one before, and neither ever hides the teams beside it.
  import AvatarAnimated from "#lib/avatars/avatar-animated.svelte";
  import AvatarPicker from "#lib/avatars/avatar-picker.svelte";
  import BuzzSoundPicker from "#lib/room/buzz-sound-picker.svelte";
  import {
    accentById,
    avatarById,
    avatarManifest,
    avatarTakesSkinTone,
    skinToneById,
  } from "#lib/avatars/avatar-manifest.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { IdentityMode } from "#lib/room/pre-game.ts";

  export type CharacterDraft = {
    nickname: string;
    avatarId: string | null;
    accentId: string;
    buzzSoundId: string | null;
    skinToneId: string | null;
  };

  type Props = {
    value: CharacterDraft;
    mode: IdentityMode;
    /** Teams mode changes what the buzz-sound section promises about who hears it. */
    /** Teams exist in this room (teams or mixed) - the buzz-sound note differs when they do. */
    teamsOffered: boolean;
    /** ...and everyone must be on one, which is what makes the note unconditional. */
    teamsRequired: boolean;
    /** Inline name error, owned by the parent so the action bar and the field agree. */
    nameProblem?: string | null;
    onChange: (patch: Partial<CharacterDraft>) => void;
    onPreviewSound?: ((soundId: string) => void) | null;
    /** Enter in the name field means "do the main thing" - join, or nothing once seated. */
    onSubmit?: (() => void) | null;
  };
  let {
    value,
    mode,
    teamsOffered,
    teamsRequired,
    nameProblem = null,
    onChange,
    onPreviewSound = null,
    onSubmit = null,
  }: Props = $props();

  const previewAvatar = $derived(avatarById(value.avatarId) ?? avatarManifest.avatars[0] ?? null);
  const previewAccent = $derived(accentById(value.accentId));
  const previewTone = $derived(skinToneById(value.skinToneId));
  const nicknameLength = $derived(value.nickname.trim().length);
</script>

<section class="character-panel" aria-label="Your character" data-identity-mode={mode}>
  <h2 class="region-heading">
    {mode === "live" ? "You" : "Choose your character"}
  </h2>

  <!-- The preview leads and it MOVES, which is what makes an avatar grid feel like a character
       select rather than a settings form (tier 2 of the avatars-in-motion decision). Its box is
       a fixed height so the panel does not jump when the walk sheet finishes recolouring. -->
  <div class="preview">
    {#if previewAvatar !== null}
      <AvatarAnimated
        avatar={previewAvatar}
        accent={previewAccent}
        skinTone={previewTone}
        size="var(--character-preview-size)"
      />
      <p class="preview-name">{previewAvatar.displayName}</p>
    {/if}
  </div>

  <div class="field-group">
    <div class="field-head">
      <label class="field-label" for="character-nickname">Your name</label>
      <!-- The owner's replacement for "Up to 24 characters. You can change it later.": a live
           counter says the same thing while you type and takes one line instead of two. -->
      <span class="counter" class:full={nicknameLength >= limits.player.nicknameMaxLength}>
        {nicknameLength}/{limits.player.nicknameMaxLength}
      </span>
    </div>
    <input
      id="character-nickname"
      type="text"
      maxlength={limits.player.nicknameMaxLength}
      autocomplete="off"
      enterkeyhint="go"
      placeholder="What should the room call you?"
      aria-invalid={nameProblem !== null}
      value={value.nickname}
      oninput={(event) => {
        onChange({ nickname: event.currentTarget.value });
      }}
      onkeydown={(event) => {
        if (event.key === "Enter") onSubmit?.();
      }}
    />
    <!-- The slot is always here, so an error appearing does not push the pickers down. -->
    <p class="validation" role={nameProblem === null ? undefined : "alert"} aria-live="polite">
      {nameProblem ?? ""}
    </p>
  </div>

  <h3 class="section-label">
    Look
    {#if avatarTakesSkinTone(previewAvatar)}
      <span class="section-note">colour tints the character; tone is yours to choose</span>
    {/if}
  </h3>
  <AvatarPicker
    avatars={avatarManifest.avatars}
    accents={avatarManifest.accents}
    skinTones={avatarManifest.skinTones}
    selectedAvatarId={value.avatarId}
    selectedAccentId={value.accentId}
    selectedSkinToneId={value.skinToneId}
    onSelectAvatar={(avatarId) => {
      onChange({ avatarId });
    }}
    onSelectAccent={(accentId) => {
      onChange({ accentId });
    }}
    onSelectSkinTone={(skinToneId) => {
      onChange({ skinToneId });
    }}
  />

  <h3 class="section-label">
    Buzzer sound
    {#if teamsOffered}
      <span class="section-note">
        {teamsRequired
          ? "yours plays on your phone; the room hears your team's sound"
          : "yours plays on your phone; on a team, the room hears the team's"}
      </span>
    {/if}
  </h3>
  <BuzzSoundPicker
    selectedSoundId={value.buzzSoundId}
    onSelect={(buzzSoundId) => {
      onChange({ buzzSoundId });
    }}
    onPreview={onPreviewSound}
  />
</section>

<style>
  .character-panel {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    color: var(--surface-text);
    /* Set here rather than inline so the wide layout can grow the preview with one override. */
    --character-preview-size: min(40vw, 150px);
  }

  .region-heading {
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 5vw, 1.9rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0;
  }

  .preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    /* Reserved: the preview's own box plus its caption, so nothing below it moves when the
       avatar changes or the recoloured filmstrip arrives. */
    min-height: calc(var(--character-preview-size) + 1.6rem);
    padding: 0.4rem 0;
  }

  .preview-name {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.85rem;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .field-label,
  .section-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.78rem;
    color: var(--surface-text-muted);
    margin: 0.4rem 0 0;
  }

  .counter {
    font-family: var(--font-chrome);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--surface-text-muted);
  }

  .counter.full {
    color: var(--board-value-color);
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

  /* Always present, so its height is part of the layout whether or not it has words in it. */
  .validation {
    margin: 0;
    min-height: 1.1rem;
    font-size: 0.8rem;
    line-height: 1.1rem;
    color: var(--score-negative);
  }

  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
