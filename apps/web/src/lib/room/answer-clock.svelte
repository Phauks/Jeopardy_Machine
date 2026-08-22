<script lang="ts">
  // THE ANSWER CLOCK, on the big screen as well as in the hand (owner, 2026-08-20: "the timer
  // for answering should be on the screen as well as the device").
  //
  // It only ever existed on the phone, as a ring around the buzzer, which is the wrong place
  // for it to live ALONE: the person answering is the one who least needs to watch a clock,
  // and the twenty people deciding whether to shout a correction are the ones who cannot see
  // it at all. Putting the same countdown on the projector is what makes the pressure of the
  // clue shared rather than private.
  //
  // ONE COMPONENT, both surfaces, for the reason two would fail: a display counting from its
  // own arithmetic and a phone counting from its own would drift apart within a clue, and the
  // room would watch two different clocks disagree about whether time was up. Both read the
  // same `PendingTimerView` the room broadcast, and both stop at the same instant.
  //
  // WHAT IT NEVER DOES is decide anything, and there is no longer a setting that would let it
  // (owner, 2026-08-20: "all scoring is manual"). An expired clock is information - so this
  // keeps rendering after zero, saying the time is over, rather than vanishing as though the
  // clue had ended. A timer that disappears exactly when a person looks up is how a room
  // concludes the game moved on without them. It renders NOTHING when there is no timer at
  // all, which is the room whose answer clock is turned off entirely.
  import type { PendingTimerView } from "#lib/room/room-view.ts";

  type Props = {
    /** The room's own timer, or null when nothing is being counted. */
    timer: PendingTimerView | null;
    /** This surface's clock, ticked by whoever owns the render loop. */
    now: number;
    /**
     * stage = the projector: big, centred, read from across a room.
     * inline = beside a control, at the size of the text around it.
     */
    variant?: "stage" | "inline";

    /** Screen-reader label; the visual is a number, which is not a sentence. */
    label?: string;
  };
  let { timer, now, variant = "stage", label = "Time to answer" }: Props = $props();

  const remainingMs = $derived(timer === null ? null : Math.max(0, timer.firesAt - now));
  // Ceil, so the last whole second is shown as "1" for its whole duration rather than
  // flicking to 0 with a second still to run. A clock that reads 0 while a person still has
  // time is worse than no clock.
  const seconds = $derived(remainingMs === null ? null : Math.ceil(remainingMs / 1000));
  const fraction = $derived(
    timer === null || remainingMs === null
      ? 0
      : Math.max(0, Math.min(1, remainingMs / timer.durationMs)),
  );
  const expired = $derived(remainingMs !== null && remainingMs <= 0);
  // The last three seconds are the ones a room reacts to, so they are the ones that change
  // colour - not a gradient nobody can read at a glance.
  const urgent = $derived(seconds !== null && seconds <= 3 && !expired);
</script>

{#if timer !== null}
  <div
    class="answer-clock"
    data-variant={variant}
    class:urgent
    class:expired
    role="timer"
    aria-label={label}
  >
    <!-- The bar is the thing read from the back of a room; the number is for the people who
         can see it. Both come from the same fraction, so they cannot disagree. -->
    <div class="track" aria-hidden="true">
      <div class="fill" style="transform: scaleX({fraction})"></div>
    </div>
    <p class="readout">
      {#if expired}
        Over time
      {:else}
        {seconds}
      {/if}
    </p>
  </div>
{/if}

<style>
  .answer-clock {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35em;
    /* Every size below is in em, so the ONE component is sized by whatever it sits inside -
       the display's type scale on a projector, the surrounding text on a phone - instead of
       carrying two hard-coded sets of dimensions that would drift apart. */
    font-size: 1em;
  }

  .answer-clock[data-variant="stage"] {
    font-size: calc(clamp(1.1rem, 3.4vh, 2.4rem) * var(--type-scale));
  }

  .track {
    height: 0.36em;
    border-radius: 999px;
    overflow: hidden;
    /* The unfilled part is the clue card's own ground darkened, not a grey: on a light paper
       theme a grey track disappears and on a dark one it glows (docs/design/theming.md). */
    background: color-mix(in srgb, var(--clue-text-color) 18%, transparent);
  }

  .fill {
    height: 100%;
    /* Scale rather than width: the browser animates a transform on the compositor, and a
       projector at 720p cannot afford a layout pass every frame of a five-second countdown. */
    transform-origin: left center;
    background: var(--board-value-color);
    transition: transform 200ms linear;
  }

  .readout {
    margin: 0;
    font-family: var(--font-legible);
    font-variant-numeric: tabular-nums;
    font-size: 1em;
    line-height: 1;
    text-align: center;
    letter-spacing: 0.04em;
    color: var(--clue-text-color);
  }

  .answer-clock.urgent .fill,
  .answer-clock.expired .fill {
    background: var(--score-negative);
  }

  .answer-clock.urgent .readout,
  .answer-clock.expired .readout {
    color: var(--score-negative);
  }

  /* At zero the bar is empty and the words carry the state, so the empty track would read as
     a decoration nobody needs. */
  .answer-clock.expired .track {
    opacity: 0.4;
  }

  .answer-clock.expired .readout {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.7em;
  }

  @media (prefers-reduced-motion: reduce) {
    .fill {
      transition: none;
    }
  }
</style>
