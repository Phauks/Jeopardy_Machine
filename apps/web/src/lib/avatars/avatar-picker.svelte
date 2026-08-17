<script lang="ts">
  // The join-screen identity picker (M4 phase 2 consumes this; /dev/theme reviews it):
  // accent swatches + the full avatar grid rendered in the chosen accent. Purely
  // presentational and prop-driven - selection state and persistence belong to the caller,
  // so the same component serves the dev gallery today and the join flow later.
  import type { AvatarAccent, AvatarEntry, AvatarSkinTone } from "#lib/avatars/avatar-manifest.ts";
  import { avatarSpriteUrl, avatarTakesSkinTone } from "#lib/avatars/avatar-manifest.ts";

  type Props = {
    avatars: readonly AvatarEntry[];
    accents: readonly AvatarAccent[];
    selectedAvatarId?: string | null;
    selectedAccentId: string;
    /**
     * The curated skin-tone axis. Pass it to offer the control; the picker still shows it ONLY
     * when the selected avatar is one it applies to, because a pet has no skin cells and a
     * control that silently does nothing is worse than no control
     * (tools/avatar-bake/src/skin-tone-palette.mjs).
     */
    skinTones?: readonly AvatarSkinTone[];
    /** null = not chosen, which renders the pack's own colors. Never inferred. */
    selectedSkinToneId?: string | null;
    onSelectAvatar?: (avatarId: string) => void;
    onSelectAccent?: (accentId: string) => void;
    onSelectSkinTone?: (skinToneId: string | null) => void;
  };
  let {
    avatars,
    accents,
    selectedAvatarId = null,
    selectedAccentId,
    skinTones = [],
    selectedSkinToneId = null,
    onSelectAvatar,
    onSelectAccent,
    onSelectSkinTone,
  }: Props = $props();

  const selectedAccent = $derived(
    accents.find((accent) => accent.id === selectedAccentId) ?? accents[0],
  );
  const selectedAvatar = $derived(
    avatars.find((avatar) => avatar.id === selectedAvatarId) ?? null,
  );
  // The grid cells stay accent-only even when a tone is chosen: tinting 27 sprites would mean
  // 27 canvas recolors on a phone to answer a question the big preview beside them is already
  // answering at full size (#lib/avatars/avatar-animated.svelte).
  const showSkinTones = $derived(skinTones.length > 0 && avatarTakesSkinTone(selectedAvatar));
</script>

<div class="avatar-picker">
  <div class="accent-row" role="group" aria-label="Accent color">
    {#each accents as accent (accent.id)}
      <button
        type="button"
        class="accent-swatch"
        class:selected={accent.id === selectedAccent?.id}
        style="--swatch-color: {accent.hex}"
        aria-label="Accent {accent.id}"
        aria-pressed={accent.id === selectedAccent?.id}
        onclick={() => {
          onSelectAccent?.(accent.id);
        }}
      ></button>
    {/each}
  </div>

  {#if showSkinTones}
    <div class="tone-row" role="group" aria-label="Skin tone">
      <!-- "Not chosen" is a first-class option with its own swatch, not the absence of a
           choice: it is what every player starts as, and it must be possible to go back to it
           (the neutral-default rule in tools/avatar-bake/src/skin-tone-palette.mjs). -->
      <button
        type="button"
        class="tone-swatch as-drawn"
        class:selected={selectedSkinToneId === null}
        aria-label="Skin tone: as drawn"
        aria-pressed={selectedSkinToneId === null}
        onclick={() => {
          onSelectSkinTone?.(null);
        }}
      ></button>
      {#each skinTones as tone (tone.id)}
        <button
          type="button"
          class="tone-swatch"
          class:selected={tone.id === selectedSkinToneId}
          style="--swatch-color: {tone.hex}"
          aria-label="Skin {tone.label}"
          aria-pressed={tone.id === selectedSkinToneId}
          onclick={() => {
            onSelectSkinTone?.(tone.id);
          }}
        ></button>
      {/each}
    </div>
  {/if}

  <div class="avatar-grid" role="group" aria-label="Avatar">
    {#each avatars as avatar (avatar.id)}
      <button
        type="button"
        class="avatar-cell"
        class:selected={avatar.id === selectedAvatarId}
        style="--cell-accent: {selectedAccent?.hex ?? 'transparent'}"
        aria-pressed={avatar.id === selectedAvatarId}
        onclick={() => {
          onSelectAvatar?.(avatar.id);
        }}
      >
        {#if selectedAccent}
          <img
            src={avatarSpriteUrl(avatar, selectedAccent.id)}
            alt=""
            loading="lazy"
            draggable="false"
          />
        {/if}
        <span class="avatar-name">{avatar.displayName}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .avatar-picker {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .accent-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .accent-swatch {
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--swatch-color);
    cursor: pointer;
    padding: 0;
  }

  .accent-swatch.selected {
    /* Selection ring separates from any swatch color via the page-side gap. */
    border-color: currentColor;
    box-shadow: 0 0 0 2px var(--swatch-color);
  }

  .accent-swatch:focus-visible,
  .tone-swatch:focus-visible,
  .avatar-cell:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .tone-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tone-swatch {
    width: 1.9rem;
    height: 1.9rem;
    /* Squircles, not circles: the accent row above is round, and at a glance the two rows must
       not read as one palette split over two lines. */
    border-radius: 6px;
    border: 2px solid transparent;
    background: var(--swatch-color);
    cursor: pointer;
    padding: 0;
  }

  /* "As drawn" cannot be a colour - there is no single colour it means - so it is the only
     swatch drawn as an outline. */
  .tone-swatch.as-drawn {
    background: transparent;
    border-color: var(--surface-border);
    background-image: linear-gradient(
      135deg,
      transparent 45%,
      var(--surface-text-muted) 45%,
      var(--surface-text-muted) 55%,
      transparent 55%
    );
  }

  .tone-swatch.selected {
    border-color: currentColor;
    box-shadow: 0 0 0 2px var(--swatch-color, var(--surface-border));
  }

  .avatar-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.2rem, 1fr));
    gap: 0.5rem;
  }

  .avatar-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.55rem 0.25rem 0.45rem;
    border-radius: 8px;
    border: 2px solid transparent;
    background: transparent;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }

  .avatar-cell.selected {
    border-color: var(--cell-accent);
    background: color-mix(in oklab, var(--cell-accent) 18%, transparent);
  }

  .avatar-cell img {
    width: 3.5rem;
    height: 3.5rem;
    display: block;
    user-select: none;
  }

  .avatar-name {
    font-size: 0.72rem;
    opacity: 0.75;
    letter-spacing: 0.03em;
  }
</style>
