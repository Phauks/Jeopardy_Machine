<script lang="ts">
  // The join-screen identity picker (M4 phase 2 consumes this; /dev/theme reviews it):
  // accent swatches + the full avatar grid rendered in the chosen accent. Purely
  // presentational and prop-driven - selection state and persistence belong to the caller,
  // so the same component serves the dev gallery today and the join flow later.
  import type { AvatarAccent, AvatarEntry } from "#lib/avatars/avatar-manifest.ts";
  import { avatarSpriteUrl } from "#lib/avatars/avatar-manifest.ts";

  type Props = {
    avatars: readonly AvatarEntry[];
    accents: readonly AvatarAccent[];
    selectedAvatarId?: string | null;
    selectedAccentId: string;
    onSelectAvatar?: (avatarId: string) => void;
    onSelectAccent?: (accentId: string) => void;
  };
  let {
    avatars,
    accents,
    selectedAvatarId = null,
    selectedAccentId,
    onSelectAvatar,
    onSelectAccent,
  }: Props = $props();

  const selectedAccent = $derived(
    accents.find((accent) => accent.id === selectedAccentId) ?? accents[0],
  );
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
  .avatar-cell:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
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
