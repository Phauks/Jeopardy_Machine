<script lang="ts">
  // The masthead, as a STRIP: the shared header bar (#lib/chrome/app-bar.svelte) plus the one
  // thing only the front door puts in it - the developer index behind a gear.
  //
  // The SHELL is shared on purpose since 2026-08-19 (owner: "we should have a header bar, same
  // one on the other page"): the wordmark's size, the bar's ground and its rule live in one
  // file, so a room and the front door cannot drift into two different tops of page.
  //
  // The band this replaces was a full-bleed hero - an eyebrow, a display-size wordmark, a lead,
  // a supporting line and a three-fact strip - roughly 340px of the first screen on a laptop,
  // above the only control anyone came for. None of the products this page was researched
  // against (Kahoot, Jackbox, Google Meet, Among Us) puts a hero above its entry control
  // (docs/research/06-join-flow-patterns.md, pattern 7). The title here is a WORDMARK, not a
  // hero: one line of chrome type, the same height as the gear beside it.
  import { Settings } from "@lucide/svelte";
  import AppBar from "#lib/chrome/app-bar.svelte";
  import type { SurfaceCard } from "#lib/landing/surface-cards.ts";

  type Props = {
    /** The developer index. Complete, and one tap away - the owner's standing freshness rule. */
    surfaces: readonly SurfaceCard[];
  };
  let { surfaces }: Props = $props();
</script>

<!-- href null: the wordmark is already on this page, and a link to where you are is a control
     that cannot do anything. -->
<AppBar href={null}>
  {#snippet trailing()}
    <!-- `details` rather than a hand-rolled popover: it opens without JavaScript, closes on
         Escape, and is a real disclosure to a screen reader. Closed by default, so the index
         costs one button of height instead of a band at the bottom of the page. -->
    <details class="dev-menu">
      <summary aria-label="Developer surfaces">
        <!-- Lucide, not a hand-drawn path (owner, 2026-08-20: "use lucide icons ... replace
             all custom svg's like the settings icon at the top right"). The gear this replaces
             was two `d` attributes somebody had to eyeball against a 16px grid, and it was the
             only icon on the page, so it had nothing to be consistent WITH. Lucide is
             tree-shaken per icon, inherits currentColor exactly as the drawn one did, and every
             future icon comes out of the same drawing. Still not an emoji (CLAUDE.md) and still
             not an icon font - the objection to a font was the whole download for one glyph,
             which per-icon components do not have. -->
        <Settings class="icon" aria-hidden="true" />
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
  {/snippet}
</AppBar>

<style>
  /* The bar's own shell - ground, rule, height, wordmark - lives in #lib/chrome/app-bar.svelte
     now. What is left here is what only the front door hangs in it, which since 2026-08-20 is
     the developer gear alone: the tagline ("Quiz night, on everyone's phone") is deleted on
     the owner's call. It was the last of the marketing copy, and it was explaining the product
     to somebody who had already opened it. */

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

  /* Lucide draws at 24px with a 2px stroke; at 17px the stroke reads heavy next to chrome
     type this size, so it is thinned to match rather than left at the default. `:global`
     because the icon is a child component and Svelte's scoping does not reach into one. */
  .dev-menu summary :global(.icon) {
    width: 1.05rem;
    height: 1.05rem;
    stroke-width: 1.75;
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
