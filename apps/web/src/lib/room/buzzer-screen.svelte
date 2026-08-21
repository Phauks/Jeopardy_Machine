<script lang="ts">
  // The A4 buzzer screen: a single FIXED layout (no scroll, no zoom, no pull-to-refresh -
  // position:fixed sidesteps iOS rubber-banding, research 05-ui-design.md section 6) with a
  // status strip, the buzz area, and a score strip. Every room state maps to a stage via
  // buzzerStageFor (room-view.ts) - this component only renders stages.
  //
  // Latency contract: buzz fires on POINTERDOWN with instant local flash + haptic; the
  // server verdict (synchronous in mock mode) resolves the optimistic state. Wake lock is
  // requested on mount and re-requested on visibility regain (locks release when tabs hide).
  import { prefersReducedMotion } from "svelte/motion";
  import { buzzerStageFor, standingsFor } from "#lib/room/room-view.ts";
  import AnswerClock from "#lib/room/answer-clock.svelte";
  import ScoresStrip from "#lib/room/scores-strip.svelte";
  import WagerPad from "#lib/room/wager-pad.svelte";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    /** Local feedback hook for the losing/pressing phone (never room audio). */
    onLocalBuzzFeedback?: (() => void) | null;
  };
  let { store, onLocalBuzzFeedback = null }: Props = $props();

  const view = $derived(store.view);

  // A coarse clock drives time-based stage transitions (judged flash decay, lockout ring).
  let now = $state(Date.now());
  $effect(() => {
    const interval = setInterval(() => {
      now = Date.now();
    }, 200);
    return () => {
      clearInterval(interval);
    };
  });

  const stage = $derived(buzzerStageFor(view, now));
  const standings = $derived(standingsFor(view));

  let pressed = $state(false);
  let finalAnswerDraft = $state("");

  // The armed button is on screen: tell the store, because that paint is t0 for this phone's
  // reaction time (docs/decisions/2026-08-17-buzz-latency-compensation.md - the room ranks
  // presses by the thumb, and the thumb cannot start before the button is visible). An $effect
  // runs after the DOM is updated, which is as close to "the player can see it" as a component
  // can honestly get. Derived to a BOOLEAN so the coarse clock's ticks, which rebuild `stage`
  // five times a second, do not re-run this; the store's own guard makes the first call win
  // anyway, and a store with no arming (the local simulation) ignores it entirely.
  const armedOnScreen = $derived(stage.kind === "armed");
  $effect(() => {
    const arming = view.arming;
    if (!armedOnScreen || arming === null || arming.paintedAt !== null) return;
    store.markArmedPainted(arming.armId);
  });

  // The press is CONFIRMED to the presser immediately and stays confirmed until the room
  // answers. The room may hold the announcement for up to `arming.compensationMs` while it
  // ranks the field, and this is the half of that beat the player must never feel: the button
  // reports "buzzed" the instant it is let go, rather than snapping back to hot and inviting a
  // second press at a room that has already heard the first.
  const buzzSent = $derived(view.myBuzz.status === "pending");

  function onBuzzPointerDown(event: PointerEvent): void {
    // Instant local feedback BEFORE any store work - never wait for a verdict visually.
    event.preventDefault();
    pressed = true;
    setTimeout(() => {
      pressed = false;
    }, 180);
    if (typeof navigator !== "undefined") navigator.vibrate?.(40);
    onLocalBuzzFeedback?.();
    store.buzz();
  }

  // Wake lock: request on mount, re-request when the tab becomes visible again (A5: phones
  // sleep constantly at real events). Feature-detected; failure is silent by design.
  $effect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    async function request(): Promise<void> {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") void request();
    }
    void request();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void lock?.release();
    };
  });

  // Ring/deadline fractions from the store's pending timers - rendered from one timestamp,
  // updated by the coarse clock, never width-per-frame.
  function timerFraction(kinds: readonly string[]): number | null {
    const timer = view.pendingTimers.find((entry) => kinds.includes(entry.kind));
    if (timer === undefined) return null;
    return Math.max(0, Math.min(1, (timer.firesAt - now) / timer.durationMs));
  }

  const answerTimer = $derived(
    view.pendingTimers.find((entry) => entry.kind === "answer-window") ?? null,
  );
  const finalWritingFraction = $derived(
    timerFraction(["final-writing", "everyone-answers-window"]),
  );
  const lockoutRemaining = $derived(
    stage.kind === "locked-out" ? Math.max(0, stage.lockedUntil - now) : 0,
  );

  const pulseAllowed = $derived(!prefersReducedMotion.current);
</script>

<div class="buzzer-screen" data-stage={stage.kind}>
  <header class="status-strip">
    <span class="room-code">{view.roomCode}</span>
    {#if view.connection !== "connected"}
      <span class="reconnecting" role="status">reconnecting...</span>
    {/if}
    {#if view.paused}
      <span class="paused-note" role="status">one moment - the host paused</span>
    {/if}
  </header>

  <main class="buzz-area">
    {#if stage.kind === "lobby"}
      <p class="stage-line">Waiting in the lobby...</p>
    {:else if stage.kind === "waiting"}
      <div class="stage-block">
        <p class="stage-line">
          {#if stage.pickerName !== null}
            <strong>{stage.pickerName}</strong> is picking...
          {:else}
            The host is picking...
          {/if}
        </p>
        <ScoresStrip rows={standings} size="compact" />
      </div>
    {:else if stage.kind === "reading" || stage.kind === "armed" || stage.kind === "locked-out"}
      <button
        type="button"
        class="buzz-button"
        class:cold={stage.kind === "reading"}
        class:hot={stage.kind === "armed" && !buzzSent}
        class:sent={stage.kind === "armed" && buzzSent}
        class:locked={stage.kind === "locked-out"}
        class:pressed
        class:pulse={stage.kind === "armed" && !buzzSent && pulseAllowed}
        disabled={stage.kind === "locked-out"}
        onpointerdown={onBuzzPointerDown}
      >
        {#if stage.kind === "reading"}
          <span class="buzz-label">wait for it...</span>
        {:else if stage.kind === "armed"}
          <span class="buzz-label">{buzzSent ? "BUZZED" : "BUZZ"}</span>
        {:else}
          <span class="buzz-label">Too soon</span>
          <span class="lockout-ring" aria-hidden="true"></span>
          <span class="lockout-note">{(lockoutRemaining / 1000).toFixed(2)}s</span>
        {/if}
      </button>
    {:else if stage.kind === "you-won"}
      <div class="stage-block winner" role="alert">
        <p class="you-line">YOU!</p>
        <p class="stage-line">Answer out loud</p>
        <!-- The SAME clock the projector now shows (answer-clock.svelte, owner 2026-08-20).
             It was a bare bar here with no number and no end state, which was fine while this
             was the only place it appeared; once the room can see one too, two hand-rolled
             countdowns would drift apart within a clue and the room would watch them
             disagree about whether time was up. -->
        {#if answerTimer !== null}
          <AnswerClock
            timer={answerTimer}
            {now}
            variant="inline"
            endsTheAttempt={view.rules.answerTimeoutOutcome === "counts-as-wrong"}
            label="Your time to answer"
          />
        {/if}
      </div>
    {:else if stage.kind === "other-won"}
      <div class="stage-block dimmed" role="status">
        <p class="stage-line"><strong>{stage.winnerName}</strong> buzzed</p>
      </div>
    {:else if stage.kind === "judged"}
      <div
        class="stage-block judged-flash"
        class:positive={stage.delta > 0}
        class:negative={stage.delta < 0}
        role="status"
      >
        <p class="delta">
          {stage.delta > 0 ? "+" : stage.delta < 0 ? "-" : ""}${Math.abs(stage.delta)}
        </p>
        <p class="stage-line">{stage.verdict === "no-penalty" ? "no penalty" : stage.verdict}</p>
      </div>
    {:else if stage.kind === "wager"}
      <div class="stage-block">
        <p class="stage-line">You found the <strong>{stage.label}</strong>!</p>
        <WagerPad
          range={stage.range}
          trueDoubleLabel="True {stage.label}"
          deadlineFraction={timerFraction(["wager-entry"])}
          onCommit={(amount) => {
            store.commitWager(amount);
          }}
        />
      </div>
    {:else if stage.kind === "wager-other"}
      <div class="stage-block dimmed" role="status">
        <p class="stage-line">
          <strong>{stage.name}</strong> found the {stage.label}! Wager: hidden
        </p>
      </div>
    {:else if stage.kind === "final-wager"}
      <div class="stage-block">
        {#if stage.committed}
          <p class="stage-line">Wager locked in</p>
        {:else if stage.range !== null}
          <p class="stage-line">Final wager</p>
          <WagerPad
            range={stage.range}
            deadlineFraction={timerFraction(["final-wager"])}
            onCommit={(amount) => {
              store.commitFinalWager(amount);
            }}
          />
        {:else}
          <p class="stage-line">Waiting for the final round...</p>
        {/if}
      </div>
    {:else if stage.kind === "final-answer"}
      <div class="stage-block">
        {#if stage.categoryTitle !== null}
          <p class="category-line">{stage.categoryTitle}</p>
        {/if}
        {#if stage.submitted}
          <p class="stage-line">Locked in</p>
        {:else}
          <form
            class="final-answer-form"
            onsubmit={(event) => {
              event.preventDefault();
              if (finalAnswerDraft.trim().length > 0) {
                store.submitFinalAnswer(finalAnswerDraft.trim());
              }
            }}
          >
            <label class="answer-label" for="final-answer-field">Your answer</label>
            <input id="final-answer-field" type="text" maxlength="300" bind:value={finalAnswerDraft} />
            {#if finalWritingFraction !== null}
              <div class="time-track" aria-hidden="true">
                <div class="time-bar" style="transform: scaleX({finalWritingFraction})"></div>
              </div>
            {/if}
            <button type="submit" class="submit-answer">Lock it in</button>
          </form>
        {/if}
      </div>
    {:else if stage.kind === "final-reveal"}
      <div class="stage-block">
        <p class="stage-line">Watch the big screen...</p>
        <ScoresStrip rows={standings} size="compact" />
      </div>
    {:else if stage.kind === "between-rounds"}
      <div class="stage-block">
        <p class="stage-line">
          {stage.next === "game-over"
            ? "Final scores coming up"
            : stage.next === "final"
              ? "The final round is next"
              : "Next round coming up"}
        </p>
        <ScoresStrip rows={standings} size="compact" />
      </div>
    {:else if stage.kind === "game-over"}
      <div class="stage-block">
        {#if stage.placement !== null}
          <p class="you-line">#{stage.placement}</p>
        {/if}
        <p class="stage-line">Thanks for playing</p>
        <ScoresStrip rows={standings} size="compact" />
      </div>
    {/if}
  </main>

  <footer class="score-strip-holder">
    {#if stage.kind === "reading" || stage.kind === "armed" || stage.kind === "locked-out" || stage.kind === "you-won" || stage.kind === "other-won"}
      <ScoresStrip rows={standings} size="compact" />
    {/if}
  </footer>
</div>

<style>
  .buzzer-screen {
    /* Fixed, non-scrolling layout: sidesteps pull-to-refresh/rubber-banding entirely
     * (overscroll-behavior is not enough on iOS). Gesture suppression per research: no
     * double-tap zoom, no selection, no long-press callout. */
    position: fixed;
    inset: 0;
    overflow: hidden;
    display: grid;
    grid-template-rows: auto 1fr auto;
    background: var(--page-bg);
    color: var(--surface-text);
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }

  .status-strip {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.8rem;
    font-family: var(--font-chrome);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--surface-text-muted);
  }

  .room-code {
    color: var(--board-value-color);
  }

  .reconnecting,
  .paused-note {
    color: var(--surface-text);
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    padding: 0.1rem 0.5rem;
  }

  .buzz-area {
    display: grid;
    place-items: center;
    padding: 0.6rem;
    min-height: 0;
  }

  /* The one sacred surface: >= 60% of the viewport height, pointerdown-driven. */
  .buzz-button {
    width: min(92vw, 70dvh);
    height: 62dvh;
    border-radius: 24px;
    position: relative;
    font-family: var(--font-display);
    cursor: pointer;
    color: var(--surface-text);
    background: var(--surface-raised);
    border: 3px solid var(--surface-border);
    will-change: transform;
    transition: background 100ms, transform 60ms;
  }

  .buzz-button.cold {
    color: var(--surface-text-muted);
  }

  .buzz-button.hot {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--surface-page);
  }

  .buzz-button.pressed {
    transform: scale(0.97);
  }

  /* Sent, waiting on the room's verdict. Still the accent (this phone DID buzz and must not
   * be told otherwise), held back so it no longer reads as an invitation to press again. */
  .buzz-button.sent {
    background: color-mix(in srgb, var(--accent) 55%, var(--surface-raised));
    border-color: var(--accent);
    color: var(--surface-page);
  }

  .buzz-button.pulse {
    animation: buzzer-pulse 1.2s ease-in-out infinite;
  }

  .buzz-button.locked {
    background: var(--surface-raised);
    border-color: var(--score-negative);
    color: var(--score-negative);
  }

  .buzz-label {
    font-size: clamp(1.6rem, 9vw, 3.2rem);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .lockout-ring {
    position: absolute;
    inset: 12px;
    border: 4px solid var(--score-negative);
    border-radius: 18px;
    opacity: 0.7;
  }

  .lockout-note {
    display: block;
    font-family: var(--font-values);
    font-size: 1.2rem;
    margin-top: 0.4rem;
  }

  .stage-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    width: min(92vw, 30rem);
    text-align: center;
  }

  .stage-block.dimmed {
    opacity: 0.6;
  }

  .stage-line {
    font-family: var(--font-chrome);
    font-size: 1.15rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0;
  }

  .category-line {
    font-family: var(--font-clue);
    font-size: 1.1rem;
    text-transform: uppercase;
    margin: 0;
    color: var(--clue-text-color);
  }

  .you-line {
    font-family: var(--font-display);
    font-size: clamp(3rem, 18vw, 6rem);
    line-height: 1;
    margin: 0;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
  }

  .judged-flash .delta {
    font-family: var(--font-values);
    font-size: clamp(3rem, 16vw, 5.5rem);
    line-height: 1;
    margin: 0;
  }

  .judged-flash.positive .delta {
    color: var(--score-positive);
  }

  .judged-flash.negative .delta {
    color: var(--score-negative);
  }

  .time-track {
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-border);
    overflow: hidden;
  }

  .time-bar {
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
  }

  .final-answer-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
  }

  .answer-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.8rem;
    color: var(--surface-text-muted);
    text-align: left;
  }

  .final-answer-form input {
    font: inherit;
    font-size: 1.1rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
    user-select: text;
    -webkit-user-select: text;
  }

  .submit-answer {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 1.05rem;
    padding: 0.7rem;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    cursor: pointer;
  }

  .score-strip-holder {
    padding: 0.4rem 0.8rem calc(0.6rem + env(safe-area-inset-bottom));
    overflow-x: auto;
  }

  .buzz-button:focus-visible,
  .submit-answer:focus-visible,
  .final-answer-form input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  @keyframes buzzer-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
    }
    50% {
      box-shadow: 0 0 0 14px color-mix(in srgb, var(--accent) 0%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .buzz-button.pulse {
      animation: none;
    }
  }
</style>
