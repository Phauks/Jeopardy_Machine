<script lang="ts">
  // ONE SECTION OF THE HOST DOCK: a caret, a title, and a body that scrolls by itself.
  //
  // Owner, 2026-08-20, three complaints that turn out to be one shape:
  //   "we treat roster, settings, and join info differently relating to if they glow or not.
  //    Really, these should be carrot menus."
  //   "if we have different sections for hosting, they should be separately scrollable."
  //   "there is a lot of space on the left side of the screen we are not using."
  //
  // The old console had three panels that opened as RAILS on the right, each with its own
  // border, its own heading, its own Close button, and its own scrollbar - three objects that
  // looked like three different kinds of thing and competed for one column. They are now one
  // dock of identical sections, and the only thing that varies between them is their content.
  //
  // WHY <details> AND NOT A BUTTON PLUS A FLAG. Disclosure is exactly what this is, and the
  // element brings the semantics (a real expandable region for a screen reader), keyboard
  // operation, and find-in-page opening a collapsed section - all things a hand-rolled toggle
  // has to re-earn and usually does not. `open` is bound so the console still owns the state
  // and can open the roster in the lobby without reaching into the DOM.
  //
  // WHY EACH BODY SCROLLS ITSELF. A dock whose whole column scrolls means opening the roster
  // pushes the settings out of reach, which is the persistent-layout law broken in a new
  // place: what was on screen must not leave because something else arrived. Each body caps
  // its own height and scrolls inside it, so five open sections are five reachable things
  // rather than one long page - and `scrollbar-gutter: stable` keeps the content still when a
  // list grows past the cap.
  import type { Snippet } from "svelte";

  type Props = {
    title: string;
    open: boolean;
    onToggle: (open: boolean) => void;
    /**
     * A live number or word for the collapsed state - "26/30 connected", "2 waiting". The
     * reason a section can stay shut: a host who can read the fact off the header does not
     * have to open the section to check it.
     */
    badge?: string | null;
    /** Marks a section as the one the room is waiting on, e.g. an unstarted game's roster. */
    tone?: "plain" | "attention";
    children: Snippet;
  };
  let { title, open, onToggle, badge = null, tone = "plain", children }: Props = $props();
</script>

<details
  class="dock-section"
  data-tone={tone}
  {open}
  ontoggle={(event) => {
    const next = event.currentTarget.open;
    if (next !== open) onToggle(next);
  }}
>
  <summary>
    <!-- The caret is drawn rather than borrowed from the browser's default marker, which
         differs per engine and cannot be animated: a host looking at two of these side by
         side must not see two different triangles. -->
    <span class="caret" aria-hidden="true"></span>
    <span class="title">{title}</span>
    {#if badge !== null}<span class="badge">{badge}</span>{/if}
  </summary>
  <div class="body">
    {@render children()}
  </div>
</details>

<style>
  .dock-section {
    /* No border and no background: the DOCK is the object, and a bordered section inside a
       bordered dock is the boxes-in-boxes the owner rejected. What separates sections is a
       hairline and the caret row's own weight. */
    border-block-end: 1px solid var(--control-border);
  }

  .dock-section:last-child {
    border-block-end: none;
  }

  summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.2rem;
    cursor: pointer;
    font-family: var(--control-font);
    font-size: 0.78em;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--control-text);
    /* The default disclosure triangle is replaced by .caret below; ::marker has to go in both
       spellings because engines disagree about which one applies to summary. */
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::marker {
    content: "";
  }

  summary:focus-visible {
    outline: 2px solid var(--control-accent);
    outline-offset: -2px;
    border-radius: var(--control-radius);
  }

  .caret {
    width: 0.5em;
    height: 0.5em;
    flex: none;
    border-right: 2px solid var(--control-text-muted);
    border-bottom: 2px solid var(--control-text-muted);
    transform: rotate(-45deg);
    transition: transform 120ms ease;
  }

  .dock-section[open] .caret {
    transform: rotate(45deg);
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The fact that lets a section stay shut. Tabular figures so a changing count does not make
     the header jitter every time somebody connects. */
  .badge {
    flex: none;
    font-size: 0.9em;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    color: var(--control-text-muted);
  }

  .dock-section[data-tone="attention"] .badge {
    color: var(--control-accent);
  }

  .body {
    /* Each section's own scroll, so opening one never pushes another out of reach. The cap is
       a viewport fraction rather than a fixed height: on a laptop three open sections fit, and
       on a short window each one gives up height at the same rate. */
    max-height: min(52vh, 34rem);
    overflow-y: auto;
    scrollbar-gutter: stable;
    padding: 0.1rem 0.2rem 0.8rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .caret {
      transition: none;
    }
  }
</style>
