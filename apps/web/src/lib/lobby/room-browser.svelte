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
  import { formatRoomAge } from "#lib/lobby/room-age.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

  type Props = {
    listing: LobbyListing;
    /** The fetch itself failed (offline, 500). Never fatal - the code box still works. */
    listingError?: string | null;
    /** False until the first fetch answers - an empty list with no verdict behind it yet. */
    loaded?: boolean;
    /** Clock for the "updated Xm ago" line; injected so the region renders deterministically. */
    now?: number;
    /** A complete code is in the box: the list steps back rather than competing for the tap. */
    dimmed?: boolean;
    onJoinRoom: (room: RoomSummary, password: string) => void;
    onRefresh?: (() => void) | null;
  };
  let {
    listing,
    listingError = null,
    loaded = true,
    now = Date.now(),
    dimmed = false,
    onJoinRoom,
    onRefresh = null,
  }: Props = $props();

  let expandedRoomCode = $state<string | null>(null);

  const registryBroken = $derived(listing.registry.status !== "ok");
  const rooms = $derived(listing.rooms);
  // "Updated new ago" is what the coarse age formatter produces for a fresh fetch, which is
  // not a sentence - the freshest state gets its own words.
  const age = $derived(formatRoomAge(listing.fetchedAt, now));
  const freshness = $derived(age === "new" ? "Updated just now" : `Updated ${age} ago`);
</script>

<div class="room-browser" class:dimmed>
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
      <p class="state-note">
        That is the normal state, not a fault: rooms are unlisted unless the host chooses to
        advertise one. If someone gave you a {limits.room.roomCodeLength}-character code, type
        it on the left and you are in.
      </p>
    </div>
  {:else}
    <ul class="room-list">
      {#each rooms as room (room.code)}
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
    <span>
      {rooms.length === limits.lobby.listingMax
        ? `Showing the newest ${String(limits.lobby.listingMax)} rooms`
        : freshness}
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
    color: var(--browser-ink);
  }

  .state-note {
    margin: 0;
    max-inline-size: 52ch;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--browser-muted);
  }

  .waiting {
    flex: 1;
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
