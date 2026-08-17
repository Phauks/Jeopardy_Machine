<script lang="ts">
  // "You were in a room. Want to go back?" - the first thing on the front door when it applies
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Rejoin memory").
  //
  // Session-scoped, no account, nothing to log into: the memory is a per-tab note this browser
  // wrote to itself when it walked into a room (#lib/lobby/room-memory.ts), and the only fact
  // asked of the server is whether that code still names a room (#lib/lobby/room-liveness.ts).
  //
  // Layout law: the offer is drawn as soon as the memory is read, and the liveness verdict
  // changes it IN PLACE - a checking room and a confirmed one occupy the same box, so the page
  // does not jump when the probe answers. A room that has genuinely ended removes itself
  // silently, which is the one disappearance the decision doc asks for: an offer to rejoin a
  // finished game is worse than no offer.
  import { limits } from "@jeopardy/protocol/limits";
  import type { RejoinVerdict } from "#lib/lobby/room-liveness.ts";
  import type { RememberedRoom } from "#lib/lobby/room-memory.ts";

  export type RejoinCandidate = RememberedRoom & { verdict: RejoinVerdict };

  type Props = {
    rooms: readonly RejoinCandidate[];
    onRejoin: (room: RejoinCandidate) => void;
  };
  let { rooms, onRejoin }: Props = $props();
</script>

{#if rooms.length > 0}
  <section class="rejoin" aria-labelledby="rejoin-heading">
    <h2 class="panel-heading" id="rejoin-heading">
      <span class="marker">Back in</span>
      <span class="heading-text">Rooms this tab was in</span>
    </h2>

    <ul class="rejoin-list">
      {#each rooms as room (room.code)}
        <li>
          <button type="button" class="rejoin-button" onclick={() => onRejoin(room)}>
            <span class="rejoin-lead">Rejoin</span>
            <span class="rejoin-title">
              {room.title === "" ? `room ${room.code}` : room.title}
            </span>
            <span class="rejoin-meta">
              <span class="rejoin-code">{room.code}</span>
              <span class="rejoin-role">{room.role === "host" ? "as host" : "as player"}</span>
              <!-- The verdict box always exists, so a resolved probe never resizes the row. -->
              <span class="rejoin-verdict" data-verdict={room.verdict}>
                {room.verdict === "unknown" ? "checking it is still live" : "still live"}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="rejoin-note">
      Kept in this tab only, for as long as it is open - never an account. Rooms end on their
      own after {String(Math.round(limits.room.idleExpiryMs / 3_600_000))}h idle.
    </p>
  </section>
{/if}

<style>
  .rejoin {
    --rejoin-ink: var(--clue-text-color);
    --rejoin-muted: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: clamp(0.9rem, 2vw, 1.25rem);
    background: var(--board-category-bg);
    color: var(--rejoin-ink);
    border-radius: 0;
  }

  .panel-heading {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    text-wrap: balance;
    color: var(--rejoin-muted);
  }

  .marker {
    color: var(--board-value-color);
    letter-spacing: 0.24em;
  }

  .heading-text {
    font-weight: 400;
  }

  .rejoin-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .rejoin-button {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: 0.2rem 0.7rem;
    width: 100%;
    text-align: left;
    font: inherit;
    cursor: pointer;
    padding: 0.7rem 0.85rem;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 26%, transparent);
    border-left: 3px solid var(--board-value-color);
    border-radius: 2px;
    background: color-mix(in srgb, var(--board-category-bg) 60%, #000000);
    color: var(--rejoin-ink);
  }

  .rejoin-button:hover {
    border-color: var(--board-value-color);
  }

  .rejoin-button:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .rejoin-lead {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.7rem;
    color: var(--board-value-color);
  }

  .rejoin-title {
    font-family: var(--font-chrome);
    font-size: clamp(1.05rem, 0.98rem + 0.4vw, 1.35rem);
    line-height: 1.1;
    /* A room name is one line of a button, not a paragraph: it truncates rather than reflowing
       the row it lives in. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .rejoin-meta {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    font-family: var(--font-chrome);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rejoin-muted);
  }

  .rejoin-code {
    font-family: var(--font-chrome);
    font-size: 0.78rem;
    letter-spacing: 0.22em;
    color: var(--board-value-color);
  }

  .rejoin-verdict[data-verdict="unknown"] {
    font-style: italic;
    opacity: 0.75;
  }

  .rejoin-note {
    margin: 0;
    max-inline-size: 54ch;
    font-size: 0.76rem;
    line-height: 1.5;
    color: var(--rejoin-muted);
  }
</style>
