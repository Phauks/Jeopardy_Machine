<script lang="ts">
  // THE HEADER BAR, and it is the same object on every surface a person can arrive at
  // (owner, 2026-08-19: "home button is randomly on the right side of the screen. We should
  // have a header bar, same one on the other page").
  //
  // What it replaces on the play surfaces: a `HomeButton variant="inline"` floated to the
  // right-hand end of a room line. That button is the standing way BACK - an anchor, never
  // history.back(), because half the arrivals here are a QR scan with nothing behind them
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md) - but as a lone
  // control at the far edge of a screen it reads as a stray, and it made the room line and the
  // front door's masthead two different kinds of top-of-page. One bar, one place the wordmark
  // sits, one way home from anywhere: the wordmark IS the way home.
  //
  // The bar carries nothing of its own beyond the wordmark. What each surface needs beside it
  // - the front door's tagline and developer gear, a room's code and status note - arrives as
  // the `trailing` snippet, so the shell cannot accumulate one surface's furniture.
  //
  // Board materials, like every other band on these screens: the category ground, the value
  // colour for the wordmark, and the same thick gutter that separates board cells as its
  // bottom rule. The three layout tokens are declared here with fallbacks rather than borrowed
  // from a page that may not declare them - this bar renders inside the front door's shell AND
  // inside a room, and a missing custom property would silently collapse its padding.
  import type { Snippet } from "svelte";

  type Props = {
    /**
     * Where the wordmark goes. A string makes it a link (every surface but the front door);
     * null renders plain text, because a link to the page you are already on is a control that
     * cannot do anything.
     */
    href?: string | null;
    /** This surface's own header content, rendered after the wordmark. */
    trailing?: Snippet;
  };
  let { href = "/", trailing }: Props = $props();
</script>

<header class="app-bar">
  <div class="bar-inner">
    {#if href === null}
      <p class="wordmark">Jeopardy Machine</p>
    {:else}
      <a class="wordmark" {href}>Jeopardy Machine</a>
    {/if}
    {@render trailing?.()}
  </div>
</header>

<style>
  .app-bar {
    --bar-inset: var(--page-inset, clamp(1rem, 4vw, 3.5rem));
    --bar-measure: var(--measure, 78rem);
    --bar-rule: var(--rule, clamp(0.5rem, 1.1vw, 0.9rem));
    background: var(--board-category-bg);
    border-bottom: var(--bar-rule) solid var(--board-bg);
  }

  .bar-inner {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    /* One line of text plus padding, and that is the whole specification: the band this
       descends from was ten times as tall (docs/decisions/2026-08-18-front-door-architecture.md
       section 5). front-door.layout.gate.test.ts holds the ceiling. */
    min-height: 3rem;
    max-width: var(--bar-measure);
    margin: 0 auto;
    padding: 0.4rem var(--bar-inset);
  }

  .wordmark {
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 1.15rem;
    line-height: 1.1;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--board-value-color);
    white-space: nowrap;
    text-decoration: none;
  }

  a.wordmark:hover,
  a.wordmark:focus-visible {
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }

  a.wordmark:focus-visible {
    outline: 3px solid var(--board-value-color);
    outline-offset: 3px;
  }
</style>
