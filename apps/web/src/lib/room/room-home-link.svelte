<script lang="ts">
  // The pre-game surface's way back to the front door ("Home button everywhere" -
  // docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md).
  //
  // THIS IS AN INSERTION POINT, NOT THE FINAL COMPONENT. A parallel workstream owns the shared
  // home/back chrome and is expected to publish it as #lib/chrome/. When it lands, delete this
  // file and swap the single usage in pre-game-screen.svelte for that import - the surface asks
  // for nothing this file provides beyond "a link home", so the swap is one line and no styling
  // of the pre-game screen depends on which component answers.
  //
  // It is deliberately a plain <a href="/">, not a router call or a history.back(): a phone that
  // opened the room from a QR code has no history to go back TO, and "back" would strand it.
  type Props = {
    /** Softens the link where the surface already has a loud header. */
    tone?: "normal" | "quiet";
  };
  let { tone = "normal" }: Props = $props();
</script>

<a class="room-home-link" class:quiet={tone === "quiet"} href="/">Home</a>

<style>
  .room-home-link {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.72rem;
    color: var(--surface-text-muted);
    text-decoration: none;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    padding: 0.3rem 0.7rem;
    /* Comfortably tappable on a phone without becoming a button that competes with Join. */
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
  }

  .room-home-link.quiet {
    border-color: transparent;
  }

  .room-home-link:hover {
    color: var(--surface-text);
    border-color: var(--surface-border);
  }

  .room-home-link:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
