<script lang="ts">
  // The public room browser as a place worth looking at, rather than a list of links.
  //
  // Server-browser conventions we keep (docs/decisions/2026-08-14-room-visibility-and-lobby.md):
  // newest first, a lock on password rooms, capacity as a fraction, running games dimmed, and
  // NO live socket - the page polls, because browsing is not playing.
  //
  // Three states have to be distinguishable, and the whole reason this screen exists is that
  // they once were not: rooms listed, genuinely nobody hosting publicly, and the registry
  // cannot answer. The third is loud; the second explains itself; both keep the code box.
  import RegistryStatusLine from "#lib/lobby/registry-status-line.svelte";
  import RoomCard from "#lib/lobby/room-card.svelte";
  import RoomCodeField from "#lib/lobby/room-code-field.svelte";
  import { formatRoomAge } from "#lib/lobby/room-age.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

  type Props = {
    listing: LobbyListing;
    listingError?: string | null;
    /** False until the first fetch answers - an empty list with no verdict behind it yet. */
    loaded?: boolean;
    /** Clock for the "updated Xm ago" line; injected so the screen renders deterministically. */
    now?: number;
    onJoinRoom: (room: RoomSummary, password: string) => void;
    onJoinCode: (code: string, password: string) => void;
    onRefresh?: (() => void) | null;
  };
  let {
    listing,
    listingError = null,
    loaded = true,
    now = Date.now(),
    onJoinRoom,
    onJoinCode,
    onRefresh = null,
  }: Props = $props();

  let typedCode = $state("");
  let expandedRoomCode = $state<string | null>(null);

  const codeComplete = $derived(typedCode.length === limits.room.roomCodeLength);
  const registryBroken = $derived(listing.registry.status !== "ok");
  const rooms = $derived(listing.rooms);
</script>

<main class="lobby">
  <header class="lobby-header">
    <a class="back-link" href="/">Jeopardy Machine</a>
    <h1>Public rooms</h1>
    <p class="lede">
      Hosts opt in to being listed - most rooms are unlisted and joined by code. Picking a room
      here does exactly what typing its code does.
    </p>
  </header>

  <section class="code-strip" aria-label="Join by code">
    <form
      class="code-form"
      onsubmit={(event) => {
        event.preventDefault();
        if (codeComplete) onJoinCode(typedCode, "");
      }}
    >
      <RoomCodeField
        value={typedCode}
        label="Have a code?"
        onInput={(code) => {
          typedCode = code;
        }}
      />
      <button type="submit" class="code-go" disabled={!codeComplete}>Join</button>
    </form>
    {#if codeComplete}
      <p class="code-wins">
        The code wins - the list below is on hold. Clear the box to browse again.
      </p>
    {/if}
  </section>

  {#if registryBroken || listingError !== null}
    <section class="state-block" aria-label="Lobby unavailable">
      <RegistryStatusLine status={listing.registry} />
      {#if listingError !== null}
        <p class="state-note">The listing request itself failed: {listingError}.</p>
      {/if}
      <p class="state-note">
        Rooms are still being created and joined by code - only the listing is affected.
      </p>
    </section>
  {:else if !loaded}
    <p class="state-note" role="status">Looking for rooms...</p>
  {:else if rooms.length === 0}
    <section class="state-block empty" aria-label="No public rooms">
      <h2>Nobody is hosting publicly right now</h2>
      <p class="state-note">
        That is the normal state, not a fault: rooms are unlisted unless the host chooses to
        advertise one. If someone gave you a {limits.room.roomCodeLength}-character code, type
        it above and you are in.
      </p>
    </section>
  {:else}
    <ul class="room-list">
      {#each rooms as room (room.code)}
        <li>
          <RoomCard
            {room}
            fetchedAt={listing.fetchedAt}
            dimmed={codeComplete}
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

  <footer class="lobby-footer">
    <span>
      {rooms.length === limits.lobby.listingMax
        ? `Showing the newest ${String(limits.lobby.listingMax)} rooms`
        : `Updated ${formatRoomAge(listing.fetchedAt, now)} ago`}
    </span>
    {#if onRefresh !== null}
      <button type="button" class="refresh" onclick={onRefresh}>Refresh now</button>
    {/if}
  </footer>
</main>

<style>
  .lobby {
    display: flex;
    flex-direction: column;
    gap: clamp(1rem, 3vh, 1.75rem);
    max-width: 48rem;
    margin: 0 auto;
    padding: clamp(1.5rem, 6vh, 3.5rem) clamp(1rem, 5vw, 2.5rem) 4rem;
    color: var(--surface-text);
  }

  .lobby-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .back-link {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.7rem;
    color: var(--surface-text-muted);
    text-decoration: none;
    width: fit-content;
  }

  .back-link::before {
    content: "< ";
    color: var(--accent);
  }

  .lobby-header h1 {
    font-family: var(--font-display);
    font-size: clamp(2rem, 7vw, 3.2rem);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    margin: 0;
  }

  .lede {
    margin: 0;
    max-width: 52ch;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--surface-text-muted);
  }

  .code-strip {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.9rem 1rem;
    border-radius: calc(var(--board-radius) + 4px);
    border: 1px solid var(--surface-border);
    border-left: 3px solid var(--accent);
    background: var(--surface-raised);
  }

  .code-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 0.75rem;
  }

  .code-go {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 1rem 1.3rem;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    cursor: pointer;
  }

  .code-go:disabled {
    background: var(--surface-border);
    color: var(--surface-text-muted);
    cursor: default;
  }

  .state-block {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .state-block.empty {
    padding: clamp(1.25rem, 5vw, 2.5rem);
    border-radius: calc(var(--board-radius) + 4px);
    border: 1px dashed var(--surface-border);
    text-align: center;
    align-items: center;
  }

  .state-block h2 {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 1.05rem;
    margin: 0;
  }

  .state-note,
  .code-wins {
    margin: 0;
    max-width: 52ch;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--surface-text-muted);
  }

  .room-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .lobby-footer {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.7rem;
    color: var(--surface-text-muted);
  }

  .refresh {
    font: inherit;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .code-go:focus-visible,
  .refresh:focus-visible,
  .back-link:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 30rem) {
    .code-form {
      grid-template-columns: 1fr;
    }
  }
</style>
