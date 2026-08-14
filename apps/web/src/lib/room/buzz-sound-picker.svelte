<script lang="ts">
  // Pick-your-buzzer-sound (A2): the approved 14 by name, tap to preview LOCALLY (no room
  // sound spam - lobby practice is always local, user-flows A3). Also serves the team tier:
  // the leader picks the team's room-audible sound with the same component.
  import { buzzSoundCatalog } from "#lib/room/buzz-sound-catalog.ts";

  type Props = {
    selectedSoundId: string | null;
    onSelect: (soundId: string) => void;
    /** Local preview hook (RoomAudio.playLocalPreview); optional so SSR renders silent. */
    onPreview?: ((soundId: string) => void) | null;
  };
  let { selectedSoundId, onSelect, onPreview = null }: Props = $props();
</script>

<div class="sound-grid" role="group" aria-label="Buzzer sound">
  {#each buzzSoundCatalog as sound (sound.id)}
    <button
      type="button"
      class="sound-chip"
      class:selected={sound.id === selectedSoundId}
      aria-pressed={sound.id === selectedSoundId}
      onclick={() => {
        onSelect(sound.id);
        onPreview?.(sound.id);
      }}
    >
      {sound.label}
    </button>
  {/each}
</div>

<style>
  .sound-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: 0.4rem;
  }

  .sound-chip {
    font-family: var(--font-chrome);
    font-size: 0.85rem;
    letter-spacing: 0.03em;
    padding: 0.5rem 0.4rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
    background: var(--surface-raised);
    color: var(--surface-text);
    cursor: pointer;
  }

  .sound-chip.selected {
    border-color: var(--accent);
    color: var(--accent);
  }

  .sound-chip:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
