<script lang="ts">
  // The public room list - a REGION of the front door, and deliberately the minority one
  // (docs/decisions/2026-08-18-front-door-architecture.md). Rooms are private unless a host
  // opts in, so the honest expectation is that this region is empty most nights; it earns a
  // band, not the page's proportions. The same reasoning the whole industry applied to server
  // browsers, which moved off the front screen once matchmaking arrived
  // (docs/research/06-join-flow-patterns.md, "the server-browser lineage").
  //
  // Server-browser conventions kept (docs/decisions/2026-08-14-room-visibility-and-lobby.md):
  // newest first, a lock on password rooms, capacity as a fraction, running games dimmed, an
  // inline per-card password prompt, and NO live socket - it polls, because browsing is not
  // playing. What is NOT kept is Steam's filter furniture: against a handful of rooms, a lock
  // badge plus one "open rooms only" toggle is the whole of what scales down.
  //
  // The rooms it shows are already filtered by the counter's field (#lib/lobby/room-filter.ts)
  // - one field serves both jobs, so this region has no search box of its own.
  //
  // Five states have to be distinguishable, and the whole reason this component exists is that
  // some of them once were not: rooms listed, nothing matching the filter, still loading,
  // genuinely nobody hosting, and the registry cannot answer. Each one occupies the SAME
  // reserved block, so the region does not jump when an answer arrives (the layout law).
  import RegistryStatusLine from "#lib/lobby/registry-status-line.svelte";
  import RoomCard from "#lib/lobby/room-card.svelte";
  import { formatRoomAge } from "#lib/lobby/room-age.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

  type Props = {
    listing: LobbyListing;
    /** The rooms left after the counter's field and the open-only toggle. */
    visibleRooms?: readonly RoomSummary[] | null;
    /** True when something is narrowing the list, so "none" can say which "none" it means. */
    filterActive?: boolean;
    openOnly?: boolean;
    onOpenOnly?: ((next: boolean) => void) | null;
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
    visibleRooms = null,
    filterActive = false,
    openOnly = false,
    onOpenOnly = null,
    listingError = null,
    loaded = true,
    now = Date.now(),
    dimmed = false,
    onJoinRoom,
    onRefresh = null,
  }: Props = $props();

  let expandedRoomCode = $state<string | null>(null);

  const registryBroken = $derived(listing.registry.status !== "ok");
  const listingAnswering = $derived(!registryBroken && listingError === null);
  const allRooms = $derived(listing.rooms);
  const rooms = $derived(visibleRooms ?? listing.rooms);
  // "Updated new ago" is what the coarse age formatter produces for a fresh fetch, which is
  // not a sentence - the freshest state gets its own words.
  const age = $derived(formatRoomAge(listing.fetchedAt, now));
  const freshness = $derived(age === "new" ? "Updated just now" : `Updated ${age} ago`);
  const count = $derived(
    filterActive
      ? `${String(rooms.length)} of ${String(allRooms.length)}`
      : allRooms.length === 0
        ? "none listed"
        : `${String(allRooms.length)} live`,
  );
</script>

<section class="room-browser" class:dimmed aria-labelledby="rooms-heading">
  <!-- One row carries what three elements used to: the label, the count, the one filter, the
       real timestamp and Refresh. Chrome on a minority region has to earn its height. -->
  <div class="browser-head">
    <h2 class="browser-title" id="rooms-heading">Public rooms</h2>
    {#if listingAnswering}
      <span class="browser-count">{count}</span>
    {/if}
    <div class="browser-tools">
      <label class="open-only" class:on={openOnly}>
        <input
          type="checkbox"
          checked={openOnly}
          onchange={(event) => onOpenOnly?.(event.currentTarget.checked)}
        />
        <span>Open rooms only</span>
      </label>
      <span class="freshness">
        {allRooms.length === limits.lobby.listingMax
          ? `Newest ${String(limits.lobby.listingMax)}`
          : freshness}
      </span>
      {#if onRefresh !== null}
        <button type="button" class="refresh" onclick={onRefresh}>Refresh</button>
      {/if}
    </div>
  </div>

  <div class="browser-body">
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
    {:else if allRooms.length === 0}
      <div class="state-block empty" aria-label="No public rooms">
        <h3>Nobody is hosting publicly right now</h3>
        <p class="state-note">
          That is the normal state, not a fault: rooms are unlisted unless the host chooses to
          advertise one. A {limits.room.roomCodeLength}-character code from the big screen gets
          you into any of them.
        </p>
      </div>
    {:else if rooms.length === 0}
      <div class="state-block empty" aria-label="No matching public rooms">
        <h3>Nothing here matches</h3>
        <p class="state-note">
          {allRooms.length === 1 ? "The one listed room does" : "None of the listed rooms do"} - clear
          the box above, or turn off "open rooms only", to see everything again.
        </p>
      </div>
    {:else}
      <ul class="room-grid">
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
  </div>
</section>

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
    gap: 0.7rem;
    color: var(--browser-ink);
    transition: opacity 150ms ease;
  }

  /* Stepped back rather than switched off: a complete code is what happens next, but the list
     it was typed over stays readable (decision 2026-08-18 §1). */
  .room-browser.dimmed {
    opacity: 0.55;
  }

  .browser-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem 0.9rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--browser-rule);
  }

  .browser-title {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.9rem;
  }

  .browser-count {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.7rem;
    color: var(--board-value-color);
  }

  .browser-tools {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem 0.9rem;
    margin-left: auto;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.66rem;
    color: var(--browser-muted);
  }

  /* The one filter the list's size justifies. The lock badge on a card carries the rest of the
     password story (docs/research/06-join-flow-patterns.md, pattern 5). */
  .open-only {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
  }

  .open-only.on {
    color: var(--board-value-color);
  }

  .open-only input {
    accent-color: var(--board-value-color);
    width: 0.9rem;
    height: 0.9rem;
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

  .browser-body {
    /* Reserved height: the five states occupy one block, so an answer arriving does not shove
       the page (the standing layout law). Two cards' worth - enough that the common case fills
       it rather than growing into it. */
    min-height: 11rem;
    display: flex;
    flex-direction: column;
  }

  /* A laptop fills its width with rooms instead of running one tall thin column, which is the
     shape the owner rejected on the play surfaces too; a phone gets the same cards in one. */
  .room-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
    gap: 0.45rem;
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
    max-inline-size: 60ch;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--browser-muted);
  }

  .waiting {
    flex: 1;
  }

  .open-only input:focus-visible,
  .refresh:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
