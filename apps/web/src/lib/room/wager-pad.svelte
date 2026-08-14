<script lang="ts">
  // The wager pad (A4 Daily-Double row + final wagers): slider for feel, numeric entry for
  // precision, min/max computed and SHOWN, and the "true DD" shortcut that bets the maximum.
  // Reused by the buzzer screen (own wager), the final-wager stage, and the host console
  // (typing a wager on a player's behalf, C4 step 6).
  import type { WagerRangeView } from "#lib/room/room-view.ts";

  type Props = {
    range: WagerRangeView;
    /** Label for the shortcut ("True Double Down" on wager cells; hidden for finals). */
    trueDoubleLabel?: string | null;
    currencyPrefix?: string;
    onCommit: (amount: number) => void;
    /** Deadline bar fraction 0..1 (from the pending wager timer); null hides the bar. */
    deadlineFraction?: number | null;
  };
  let {
    range,
    trueDoubleLabel = null,
    currencyPrefix = "$",
    onCommit,
    deadlineFraction = null,
  }: Props = $props();

  let amount = $state(0);
  $effect.pre(() => {
    // Re-clamp when the range changes (a new wager clue reuses the mounted pad).
    amount = Math.min(Math.max(amount, range.minimum), range.maximum);
  });

  function clamp(next: number): number {
    if (Number.isNaN(next)) return range.minimum;
    return Math.min(Math.max(Math.round(next), range.minimum), range.maximum);
  }

  function commit(): void {
    onCommit(clamp(amount));
  }
</script>

<form
  class="wager-pad"
  onsubmit={(event) => {
    event.preventDefault();
    commit();
  }}
>
  <p class="range-line">
    <span>{range.label}</span>
    <span>
      {currencyPrefix}{range.minimum} - {currencyPrefix}{range.maximum}
    </span>
  </p>

  <output class="amount" for="wager-slider wager-number">{currencyPrefix}{clamp(amount)}</output>

  <input
    id="wager-slider"
    class="slider"
    type="range"
    min={range.minimum}
    max={range.maximum}
    step="100"
    bind:value={amount}
    aria-label="Wager amount slider"
  />

  <div class="entry-row">
    <input
      id="wager-number"
      class="number"
      type="number"
      inputmode="numeric"
      min={range.minimum}
      max={range.maximum}
      bind:value={amount}
      aria-label="Wager amount"
    />
    {#if trueDoubleLabel !== null}
      <button
        type="button"
        class="true-double"
        onclick={() => {
          amount = range.maximum;
          commit();
        }}
      >
        {trueDoubleLabel}
      </button>
    {/if}
  </div>

  {#if deadlineFraction !== null}
    <div class="deadline-track" aria-hidden="true">
      <div class="deadline-bar" style="transform: scaleX({Math.max(0, Math.min(1, deadlineFraction))})"></div>
    </div>
  {/if}

  <button type="submit" class="commit">Lock it in</button>
</form>

<style>
  .wager-pad {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    width: 100%;
  }

  .range-line {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.85rem;
    color: var(--surface-text-muted);
    margin: 0;
  }

  .amount {
    font-family: var(--font-values);
    font-size: clamp(2.2rem, 9vw, 4rem);
    color: var(--board-value-color);
    text-align: center;
    text-shadow: var(--effect-value-glow);
    line-height: 1;
  }

  .slider {
    width: 100%;
    accent-color: var(--accent);
  }

  .entry-row {
    display: flex;
    gap: 0.6rem;
  }

  .number {
    flex: 1;
    min-width: 0;
    font-family: var(--font-values);
    font-size: 1.3rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-page);
    color: var(--surface-text);
  }

  .true-double,
  .commit {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.55rem 1rem;
    border-radius: var(--board-radius);
    cursor: pointer;
  }

  .true-double {
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
  }

  .commit {
    border: none;
    background: var(--accent);
    color: var(--surface-page);
    font-size: 1.05rem;
    padding: 0.75rem 1rem;
  }

  .true-double:focus-visible,
  .commit:focus-visible,
  .number:focus-visible,
  .slider:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .deadline-track {
    height: 6px;
    border-radius: 3px;
    background: var(--surface-border);
    overflow: hidden;
  }

  .deadline-bar {
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
    /* Driven by a fraction prop computed from one start timestamp - never width-per-frame
     * (research 05-ui-design.md section 4 timer-bar rule). */
  }
</style>
