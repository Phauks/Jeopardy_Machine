<script lang="ts">
  // The masthead, as a STRIP. One row: the wordmark, one short line saying what this is, and
  // the developer index behind a gear.
  //
  // The band this replaces was a full-bleed hero - an eyebrow, a display-size wordmark, a lead,
  // a supporting line and a three-fact strip - roughly 340px of the first screen on a laptop,
  // above the only control anyone came for. None of the products this page was researched
  // against (Kahoot, Jackbox, Google Meet, Among Us) puts a hero above its entry control
  // (docs/research/06-join-flow-patterns.md, pattern 7). The title here is a WORDMARK, not a
  // hero: one line of chrome type, the same height as the gear beside it.
  import type { SurfaceCard } from "#lib/landing/surface-cards.ts";

  type Props = {
    /** The developer index. Complete, and one tap away - the owner's standing freshness rule. */
    surfaces: readonly SurfaceCard[];
  };
  let { surfaces }: Props = $props();
</script>

<header class="masthead-bar">
  <div class="masthead-inner">
    <p class="wordmark">Jeopardy Machine</p>
    <p class="tagline">Quiz night, on everyone's phone</p>

    <!-- `details` rather than a hand-rolled popover: it opens without JavaScript, closes on
         Escape, and is a real disclosure to a screen reader. Closed by default, so the index
         costs one button of height instead of a band at the bottom of the page. -->
    <details class="dev-menu">
      <summary aria-label="Developer surfaces">
        <!-- A drawn gear, not an emoji (CLAUDE.md forbids those in the UI) and not an icon
             font (a whole download for one glyph); it inherits currentColor and themes free. -->
        <svg class="gear" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M8 5.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
          />
          <path
            d="M8 1.2 9 3l2-.6.6 2 2 1-1 1.6 1 1.6-2 1-.6 2L9 13l-1 1.8L7 13l-2 .6-.6-2-2-1 1-1.6-1-1.6 2-1L5 2.4 7 3Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linejoin="round"
          />
        </svg>
      </summary>
      <div class="dev-panel">
        <p class="dev-lede">
          {surfaces.length} developer surfaces - the suite is still being built milestone by milestone.
        </p>
        <ul class="surface-list">
          {#each surfaces as surface (surface.href)}
            <li>
              <a href={surface.href}>{surface.title}</a>
              <span>{surface.note}</span>
            </li>
          {/each}
        </ul>
      </div>
    </details>
  </div>
</header>

<style>
  .masthead-bar {
    background: var(--board-category-bg);
    border-bottom: var(--rule) solid var(--board-bg);
  }

  .masthead-inner {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    /* The whole point of this file: one line of text plus padding. The band it replaces was
       ten times this tall (decision 2026-08-18 §5). */
    min-height: 3rem;
    max-width: var(--measure);
    margin: 0 auto;
    padding: 0.4rem var(--page-inset);
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
  }

  .tagline {
    margin: 0;
    flex: 1;
    min-width: 0;
    font-size: 0.8rem;
    line-height: 1.2;
    color: color-mix(in srgb, var(--clue-text-color) 70%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A phone spends its whole width on the wordmark and the gear; the line is chrome. */
  @media (max-width: 34rem) {
    .tagline {
      display: none;
    }
  }

  .dev-menu {
    position: relative;
    margin-left: auto;
  }

  .dev-menu summary {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.1rem;
    height: 2.1rem;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    border-radius: 2px;
    color: color-mix(in srgb, var(--clue-text-color) 78%, transparent);
    cursor: pointer;
    list-style: none;
  }

  .dev-menu summary::-webkit-details-marker {
    display: none;
  }

  .dev-menu[open] summary {
    border-color: var(--board-value-color);
    color: var(--board-value-color);
  }

  .gear {
    width: 1.05rem;
    height: 1.05rem;
  }

  .dev-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 0.4rem);
    z-index: 20;
    width: min(26rem, calc(100vw - 2rem));
    max-height: min(28rem, 70dvh);
    overflow-y: auto;
    padding: 0.8rem;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    /* Darker than the band it drops over, so it reads as a panel in front of the page rather
       than a lighter patch of it - the cell fill at full strength is a bright blue. */
    background: color-mix(in srgb, var(--board-cell-bg) 40%, #000000);
    color: var(--clue-text-color);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
  }

  .dev-lede {
    margin: 0 0 0.6rem;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.68rem;
    color: color-mix(in srgb, var(--clue-text-color) 60%, transparent);
  }

  .surface-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .surface-list li {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-top: 0.5rem;
    border-top: 1px solid color-mix(in srgb, var(--clue-text-color) 14%, transparent);
  }

  .surface-list a {
    font-family: var(--font-chrome);
    font-size: 0.88rem;
    letter-spacing: 0.03em;
    color: var(--board-value-color);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .surface-list span {
    font-size: 0.75rem;
    line-height: 1.4;
    color: color-mix(in srgb, var(--clue-text-color) 60%, transparent);
  }

  .dev-menu summary:focus-visible,
  .surface-list a:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
