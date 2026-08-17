<script lang="ts">
  // The way back, on every surface (docs/decisions/2026-08-16-persistent-layout-and-pregame-
  // rework.md: "Home button everywhere"). ONE component so the affordance is the same shape,
  // the same size and the same words wherever it appears - a per-surface hand-rolled back link
  // is how a suite ends up with five different ways home, three of which are missing.
  //
  // It is an ANCHOR, always, and never `history.back()`. Half the arrivals here are a QR scan
  // or a pasted link, so there is no "back" to go to; a link is also middle-clickable,
  // openable in a new tab, and readable by a screen reader as the destination it actually is.
  //
  // Token-only styling (docs/design/theming.md), so it inherits whatever theme the surface it
  // is dropped into applies - including the unthemed /dev pages, where tokens.css defaults
  // supply the retro-tv look.
  type Props = {
    /** Where back leads. Defaults to the front door, which is what "home" means here. */
    href?: string;
    /** The words. Kept short - this is chrome, not a nav bar. */
    label?: string;
    /**
     * `inline` sits in a surface's own header row and scrolls with it.
     * `floating` pins itself to the top-left corner for surfaces that have no header to sit in
     * (the play surfaces, the dev pages), clear of the safe-area inset on a notched phone.
     */
    variant?: "inline" | "floating";
    /**
     * Ask before leaving. A surface mid-game (a host console with a live room) passes a
     * sentence here; anything else leaves it null and the link is an ordinary link.
     */
    confirm?: string | null;
  };
  let {
    href = "/",
    label = "Home",
    variant = "inline",
    confirm: confirmMessage = null,
  }: Props = $props();
</script>

<a
  class="home-button"
  data-variant={variant}
  {href}
  data-testid="home-button"
  onclick={(event) => {
    if (confirmMessage === null) return;
    if (!globalThis.confirm(confirmMessage)) event.preventDefault();
  }}
>
  <!-- A drawn chevron rather than an emoji or an icon font (CLAUDE.md forbids the first, and
       the second is a whole download for one glyph); it inherits currentColor and themes for
       free. -->
  <svg class="chevron" viewBox="0 0 8 12" aria-hidden="true" focusable="false">
    <path d="M6.5 1 1.5 6l5 5" fill="none" stroke="currentColor" stroke-width="1.6" />
  </svg>
  <span class="label">{label}</span>
</a>

<style>
  .home-button {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    width: fit-content;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.72rem;
    line-height: 1;
    padding: 0.5rem 0.7rem 0.5rem 0.55rem;
    color: var(--surface-text);
    text-decoration: none;
    border: 1px solid var(--surface-border);
    /* Square-ish on purpose: this is a stamped chrome control, not a pill. */
    border-radius: 2px;
    background: color-mix(in srgb, var(--surface-page) 72%, transparent);
  }

  .home-button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .home-button:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .chevron {
    width: 0.55em;
    height: 0.85em;
    flex: none;
    color: var(--accent);
  }

  .home-button[data-variant="floating"] {
    position: fixed;
    /* Above page content, below any modal layer a surface raises for a clue card. */
    z-index: 20;
    top: calc(env(safe-area-inset-top, 0px) + 0.6rem);
    left: calc(env(safe-area-inset-left, 0px) + 0.6rem);
    backdrop-filter: blur(6px);
  }
</style>
