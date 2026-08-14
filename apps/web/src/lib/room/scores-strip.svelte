<script lang="ts">
  // The shared score readout: display bottom strip, buzzer top strip, console roster, and
  // the hotseat page all render standings through this one component. Tokens only; the
  // entity's accent arrives as a palette id and resolves through the avatar manifest (the
  // single accent source - docs/design/theming.md "Player accents and avatars").
  import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import type { StandingRow } from "#lib/room/room-view.ts";

  type Props = {
    rows: StandingRow[];
    /** Currency/points prefix from the game's settings label; "$" for the fixture game. */
    currencyPrefix?: string;
    /** Extra emphasis for one entity (the buzz winner, the entity being judged). */
    highlightEntityId?: string | null;
    /** Compact fits the phone status strip; regular fits display/console. */
    size?: "regular" | "compact";
  };
  let { rows, currencyPrefix = "$", highlightEntityId = null, size = "regular" }: Props = $props();

  function accentHex(colorId: string | null): string {
    if (colorId === null) return "var(--surface-border)";
    return (
      avatarManifest.accents.find((entry) => entry.id === colorId)?.hex ?? "var(--surface-border)"
    );
  }
</script>

<ul class="scores-strip" class:compact={size === "compact"}>
  {#each rows as row (row.entityId)}
    <li
      class="score-chip"
      class:control={row.hasControl}
      class:highlight={row.entityId === highlightEntityId}
      style="--entity-accent: {accentHex(row.colorId)}"
    >
      <span class="name">{row.name}</span>
      <span class="score" class:negative={row.score < 0}>
        {row.score < 0 ? "-" : ""}{currencyPrefix}{Math.abs(row.score)}
      </span>
      {#if row.hasControl}
        <span class="control-mark" title="has board control" aria-label="has board control">
          picks
        </span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .scores-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .score-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.3rem 0.65rem;
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    /* The entity accent is the left edge, not the fill: color-blind-safe (never color
     * alone - the name is right there) and readable on any theme's raised surface. */
    border-left: 4px solid var(--entity-accent);
    font-family: var(--font-chrome);
  }

  .compact .score-chip {
    padding: 0.15rem 0.45rem;
    gap: 0.3rem;
    font-size: 0.78rem;
  }

  .score-chip.control {
    border-color: var(--accent);
    border-left-color: var(--entity-accent);
  }

  .score-chip.highlight {
    outline: 2px solid var(--accent);
  }

  .name {
    color: var(--surface-text);
    letter-spacing: 0.02em;
  }

  .score {
    color: var(--surface-text);
    font-family: var(--font-values);
    font-size: 1.05em;
  }

  .score.negative {
    color: var(--score-negative);
  }

  .control-mark {
    font-size: 0.7em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
</style>
