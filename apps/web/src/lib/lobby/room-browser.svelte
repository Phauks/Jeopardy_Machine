<script lang="ts">
  // The public room list, as a REGION of the front door rather than a page of its own
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md: browsing and joining
  // are the same act, so /lobby folded back into /). Everything the separate page did, it
  // still does - it simply does it beside the code box instead of one navigation away.
  //
  // Server-browser conventions kept (docs/decisions/2026-08-14-room-visibility-and-lobby.md):
  // newest first, a lock on password rooms, capacity as a fraction, running games dimmed, an
  // inline per-card password prompt, and NO live socket - it polls, because browsing is not
  // playing.
  //
  // Four states have to be distinguishable, and the whole reason this component exists is that
  // they once were not: rooms listed, still loading, genuinely nobody hosting, and the registry
  // cannot answer. Each one occupies the SAME reserved block, so the column does not jump when
  // an answer arrives (the standing layout law, same decision doc).
  import RegistryStatusLine from "#lib/lobby/registry-status-line.svelte";
  import RoomCard from "#lib/lobby/room-card.svelte";
  import { formatClockTime } from "#lib/lobby/room-age.ts";
  import { filterRooms } from "#lib/lobby/room-search.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

  type Props = {
    listing: LobbyListing;
    /** The fetch itself failed (offline, 500). Never fatal - the code box still works. */
    listingError?: string | null;
    /** False until the first fetch answers - an empty list with no verdict behind it yet. */
    loaded?: boolean;
    /** A complete code is in the box: the list steps back rather than competing for the tap. */
    dimmed?: boolean;
    /** Seed for the search box, so the filtered state can be server-rendered in a test. */
    initialQuery?: string;
    onJoinRoom: (room: RoomSummary, password: string) => void;
    onRefresh?: (() => void) | null;
  };
  let {
    listing,
    listingError = null,
    loaded = true,
    dimmed = false,
    initialQuery = "",
    onJoinRoom,
    onRefresh = null,
  }: Props = $props();

  let expandedRoomCode = $state<string | null>(null);
  // A seed, read once: after the first render the box belongs to whoever is typing in it.
  // svelte-ignore state_referenced_locally
  let query = $state(initialQuery);

  const registryBroken = $derived(listing.registry.status !== "ok");
  const rooms = $derived(listing.rooms);
  // Filtering is instant and local - the whole listing is already in hand, capped at
  // limits.lobby.listingMax (room-search.ts explains why no request is involved).
  const shown = $derived(filterRooms(rooms, query));
  const filtering = $derived(query.trim() !== "");
  // The fetch's own wall-clock stamp rather than "updated 2m ago": a relative phrase is only
  // true while something re-renders it, and staleness is the exact question this line answers
  // (owner call 2026-08-17, room-age.ts).
  const freshness = $derived(`Updated ${formatClockTime(listing.fetchedAt)}`);
</script>

<div class="room-browser" class:dimmed>
  <!-- The search box is always drawn, whatever the list is doing: a control that appears when
       the first rooms arrive would move everything under it (the standing layout law). -->
  <label class="search">
    <span class="visually-hidden">Search public rooms</span>
    <input
      type="search"
      autocomplete="off"
      placeholder="Search by room or host"
      bind:value={query}
    />
  </label>

  {#if registryBroken || listingError !== null}
    <div class="state-block" aria-label="Room list unavailable">
      <RegistryStatusLine status={listing.registry} />
      {#if listingError !== null}
        <p class="state-note">The listing request itself failed: {listingError}.</p>
      {/if}
      <p class="state-note">
        Rooms are still being created and joined by code - only the listing is affected.
      </p>
    </div>
  {:else if !loaded}
    <p class="state-note waiting" role="status">Looking for rooms...</p>
  {:else if rooms.length === 0}
    <div class="state-block empty" aria-label="No public rooms">
      <h3>Nobody is hosting publicly right now</h3>
      <p class="state-note">Most rooms are private. A code still gets you in.</p>
    </div>
  {:else if shown.length === 0}
    <div class="state-block empty" aria-label="No matching rooms">
      <h3>No room matches that search</h3>
      <button
        type="button"
        class="clear-search"
        onclick={() => {
          query = "";
        }}
      >
        Show all {rooms.length}
      </button>
    </div>
  {:else}
    <ul class="room-list">
      {#each shown as room (room.code)}
        <li>
          <RoomCard
            {room}
            fetchedAt={listing.fetchedAt}
            {dimmed}
            expanded={expandedRoomCode === room.code}
            onSelect={(picked, password) => {
              onJoinRoom(picked, password);
            }}
            onExpand={(picked) => {
              expandedRoomCode = picked.code;
            }}
            onCollapse={() => {
              expandedRoomCode = null;
            }}
          />
        </li>
      {/each}
    </ul>
  {/if}

  <footer class="browser-footer">
    <span class="stamp">{freshness}</span>
    <span>
      {#if filtering && shown.length > 0}
        {shown.length} of {rooms.length}
      {:else if rooms.length === limits.lobby.listingMax}
        Newest {limits.lobby.listingMax}
      {/if}
    </span>
    {#if onRefresh !== null}
      <button type="button" class="refresh" onclick={onRefresh}>Refresh now</button>
    {/if}
  </footer>
</div>

<style>
  /* Board materials, not chrome materials: this region sits on the gutter color and its rooms
     are cells (room-card.svelte). Deriving from --board-* keeps it legible under every preset,
     including the light paper one, where the chrome tokens collapse toward each other. */
  .room-browser {
    --browser-ink: var(--clue-text-color);
    --browser-muted: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
    --browser-rule: color-mix(in srgb, var(--clue-text-color) 22%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    /* Reserved height: the four states occupy one block, so an answer arriving does not shove
       the page (the standing layout law). Two cards' worth - enough that the common case fills
       it rather than growing into it. */
    min-height: 13rem;
    color: var(--browser-ink);
    transition: opacity 150ms ease;
  }

  .room-browser.dimmed {
    opacity: 0.4;
  }

  .search {
    display: flex;
    flex-direction: column;
  }

  /* A well sunk into the panel, like every other field on this page - not a rounded pill on a
     card, which is the generic search box the art direction rejects. */
  .search input {
    font: inherit;
    font-size: 0.95rem;
    padding: 0.5rem 0.65rem;
    width: 100%;
    min-width: 0;
    border: 1px solid var(--browser-rule);
    border-radius: 2px;
    background: color-mix(in srgb, var(--board-cell-bg) 45%, #000000);
    color: var(--browser-ink);
  }

  .search input::placeholder {
    color: var(--browser-muted);
  }

  .search input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .clear-search {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--browser-rule);
    border-radius: 2px;
    background: transparent;
    color: var(--board-value-color);
    cursor: pointer;
  }

  .clear-search:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .room-list {
    display: flex;
    flex-direction: column;
    /* The gutter again, one step finer: rooms read as cells stacked on the board's ground. */
    gap: 0.4rem;
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
  }

  .state-block {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    flex: 1;
  }

  .state-block.empty {
    justify-content: center;
    padding: clamp(1.25rem, 4vw, 2.25rem);
    border: 1px dashed var(--browser-rule);
  }

  .state-block h3 {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 1rem;
    margin: 0;
    /* Balanced: an empty-state heading that drops its last word alone is the ragged break the
       owner reported, in the one place the eye has nothing else to look at. */
    text-wrap: balance;
    color: var(--browser-ink);
  }

  .state-note {
    margin: 0;
    max-inline-size: 52ch;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--browser-muted);
  }

  /* Reserved like every other state in this block: "looking for rooms" occupies the height the
     rooms will, so the answer arriving changes words rather than positions. */
  .waiting {
    flex: 1;
    min-height: 6rem;
  }

  .browser-footer {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding-top: 0.6rem;
    border-top: 1px solid var(--browser-rule);
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.68rem;
    color: var(--browser-muted);
  }

  /* The stamp is the fact this footer exists for, so it is the one that keeps the value color
     and never wraps mid-time. */
  .stamp {
    white-space: nowrap;
    color: var(--board-value-color);
  }

  .refresh {
    font: inherit;
    background: none;
    border: none;
    padding: 0;
    color: var(--board-value-color);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .refresh:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
