<script lang="ts">
  // "You were in a room. Want to go back?" - first in reading order, small in weight
  // (docs/decisions/2026-08-18-front-door-architecture.md; the offer itself was decided in
  // docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Rejoin memory").
  //
  // It was a full panel with its own heading and a paragraph of explanation, sitting above the
  // control everyone came for. Being FIRST and being BIG are different things: this is a strip
  // of chips, one per remembered room, and it disappears entirely - not as an empty box - when
  // this tab remembers nothing. Figma and Notion open onto recents for the same reason: coming
  // back is more common than starting, but it is not the page's headline.
  //
  // Session-scoped, no account, nothing to log into: the memory is a per-tab note this browser
  // wrote to itself (#lib/lobby/room-memory.ts), and the only fact asked of the server is
  // whether the code still names a room (#lib/lobby/room-liveness.ts). The liveness verdict
  // changes the chip IN PLACE - a checking room and a confirmed one are the same chip.
  import { formatExpiryCountdown } from "#lib/lobby/room-liveness.ts";
  import type { RejoinCandidate } from "#lib/lobby/room-liveness.ts";

  type Props = {
    rooms: readonly RejoinCandidate[];
    onRejoin: (room: RejoinCandidate) => void;
    /** Injected by tests so the countdown is assertable without a clock. */
    now?: number | null;
  };
  let { rooms, onRejoin, now: injectedNow = null }: Props = $props();

  // A COUNTDOWN, not a claim (owner, 2026-08-20: "instead of rejoining as a host saying still
  // live, we should show the countdown until the room will expire").
  //
  // "still live" answered a question nobody was asking. Of course it is live - it is being
  // offered, and the offer is deleted the moment the probe says otherwise. What a host
  // actually wants to know when they see their own room sitting there is how long they have,
  // because a room expires on an idle timer and the answer decides whether they finish their
  // coffee first.
  //
  // Ticked once a minute, which is all the precision the format has (room-liveness.ts rounds
  // to minutes): a per-second interval would re-render the front page sixty times for a number
  // that changes once.
  let tick = $state(Date.now());
  $effect(() => {
    const interval = setInterval(() => {
      tick = Date.now();
    }, 30_000);
    return () => {
      clearInterval(interval);
    };
  });
  const now = $derived(injectedNow ?? tick);
</script>

{#if rooms.length > 0}
  <div class="rejoin-strip">
    <span class="strip-label">Back in</span>
    <ul class="chips">
      {#each rooms as room (room.code)}
        {@const countdown = formatExpiryCountdown(room.expiresAt, now)}
        <li>
          <button type="button" class="chip" onclick={() => onRejoin(room)}>
            <span class="chip-lead">Rejoin</span>
            <span class="chip-title">{room.title === "" ? `room ${room.code}` : room.title}</span>
            <span class="chip-role">{room.role === "host" ? "as host" : "as player"}</span>
            <!-- The verdict box always exists, so a resolved probe never resizes the chip.
                 Three states, and the middle one is the point: a room whose deadline nothing
                 could report still says nothing rather than inventing a countdown - the same
                 absent-is-not-zero rule the lobby's capacity lines follow. -->
            <span class="chip-verdict" data-verdict={room.verdict}>
              {#if room.verdict === "unknown"}
                checking
              {:else if countdown !== null}
                {countdown} left
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .rejoin-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }

  .strip-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-size: 0.68rem;
    color: var(--board-value-color);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }

  .chip {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    max-width: 100%;
    font: inherit;
    text-align: left;
    cursor: pointer;
    padding: 0.4rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 26%, transparent);
    border-left: 3px solid var(--board-value-color);
    border-radius: 2px;
    background: color-mix(in srgb, var(--board-category-bg) 70%, #000000);
    color: var(--clue-text-color);
  }

  .chip:hover {
    border-color: var(--board-value-color);
  }

  .chip-lead {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.66rem;
    color: var(--board-value-color);
  }

  .chip-title {
    font-family: var(--font-chrome);
    font-size: 0.95rem;
    /* A room name is one line of a chip, not a paragraph: it truncates rather than reflowing
       the strip it lives in. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .chip-role,
  .chip-verdict {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.64rem;
    color: color-mix(in srgb, var(--clue-text-color) 62%, transparent);
    white-space: nowrap;
  }

  .chip-verdict[data-verdict="unknown"] {
    font-style: italic;
    opacity: 0.75;
  }

  .chip:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
