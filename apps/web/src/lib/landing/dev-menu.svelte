<script lang="ts">
  // The developer index, as a header control (owner call 2026-08-17). It used to be a drawer
  // at the FOOT of the front door - which meant the last thing a visitor scrolled past was a
  // list of engineering routes, and the owner's own shortcut to those routes was the furthest
  // thing on the page from where they arrive.
  //
  // The owner rule is unchanged and still in force: every meaningful surface gets an entry, in
  // the same PR that ships it. It is the PLACE that moved - the entries live in
  // #lib/landing/surface-cards.ts exactly as before, so adding a surface is still a one-line
  // edit in an obvious file.
  //
  // <details> rather than a scripted popover, deliberately: it opens and closes with no
  // JavaScript, it server-renders closed (so the test can assert both), the summary is a real
  // button to a keyboard, and Escape closes it in every browser without a handler.
  import type { SurfaceCard } from "#lib/landing/surface-cards.ts";

  type Props = { surfaces: readonly SurfaceCard[] };
  let { surfaces }: Props = $props();
</script>

<details class="dev-menu">
  <summary aria-label="Developer surfaces">
    <!-- A drawn gear, not an emoji (CLAUDE.md forbids emojis in the UI) and not an icon font:
         a two-path SVG inheriting currentColor is smaller than either and themes for free. -->
    <svg class="gear" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 1.4 9.3 3l2-.3.6 2 1.8 1-.7 1.9.7 1.9-1.8 1-.6 2-2-.3L8 14.6 6.7 13l-2 .3-.6-2-1.8-1L3 8.4l-.7-1.9 1.8-1 .6-2 2 .3Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
      <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.2" />
    </svg>
    <span class="menu-label">Dev</span>
  </summary>

  <div class="menu-sheet">
    <ul class="surface-list">
      {#each surfaces as surface (surface.href)}
        <li class="surface-item">
          <a href={surface.href}>{surface.title}</a>
          <p>{surface.note}</p>
        </li>
      {/each}
    </ul>
  </div>
</details>

<style>
  .dev-menu {
    position: relative;
    flex: none;
  }

  .dev-menu summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    list-style: none;
    border: 1px solid color-mix(in srgb, var(--board-value-color) 45%, transparent);
    border-radius: 2px;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.7rem;
    color: var(--board-value-color);
  }

  .dev-menu summary::-webkit-details-marker {
    display: none;
  }

  .dev-menu summary:hover,
  .dev-menu[open] summary {
    border-color: var(--board-value-color);
    background: color-mix(in srgb, var(--board-value-color) 14%, transparent);
  }

  .dev-menu summary:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .gear {
    width: 1rem;
    height: 1rem;
    flex: none;
  }

  /* Anchored to the control and floated over the page: the menu is chrome, so opening it must
     not push the front door's own regions around (the standing layout law). */
  .menu-sheet {
    position: absolute;
    inset-inline-end: 0;
    top: calc(100% + 0.4rem);
    z-index: 20;
    width: min(26rem, 88vw);
    max-height: min(70vh, 34rem);
    overflow-y: auto;
    padding: 0.6rem;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    background: color-mix(in srgb, var(--board-cell-bg) 30%, #000000);
    color: var(--clue-text-color);
  }

  .surface-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .surface-item {
    padding: 0.5rem 0.6rem;
    border-left: 2px solid color-mix(in srgb, var(--board-value-color) 55%, transparent);
    background: color-mix(in srgb, var(--board-cell-bg) 22%, transparent);
  }

  .surface-item a {
    font-family: var(--font-chrome);
    font-size: 0.88rem;
    letter-spacing: 0.03em;
    color: var(--board-value-color);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .surface-item a:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .surface-item p {
    margin: 0.2rem 0 0;
    max-inline-size: 46ch;
    font-size: 0.76rem;
    line-height: 1.45;
    color: color-mix(in srgb, var(--clue-text-color) 62%, transparent);
  }
</style>
