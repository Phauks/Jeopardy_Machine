<script lang="ts">
  // THE FRONT DOOR. One counter, one list, one host button
  // (docs/decisions/2026-08-18-front-door-architecture.md, which supersedes the LAYOUT half of
  // docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md and keeps all of its
  // behavior).
  //
  // The page has three audiences and one primary job. Roughly thirty people per event arrive
  // holding a five-character code off a projector; one person per event arrives to host; a few
  // arrive curious, and the list they came to browse is usually empty because rooms are
  // private unless a host opts in. So the page is ordered rather than balanced: ONE field
  // spans the code and the search, the list hangs beneath it as that field's results, and
  // hosting is a button attached to the counter instead of a form standing beside it.
  //
  // What that replaces: four numbered panels of near-equal weight (rejoin, join, create,
  // browse) under a 340px marketing band. Equal weight IS the problem - a screen with four
  // primary actions has none (docs/research/06-join-flow-patterns.md, pattern 1).
  //
  // ART DIRECTION, unchanged and still the reason this looks like something: the page is built
  // from the BOARD'S OWN MATERIALS rather than from chrome. Ink bands separated by the same
  // thick gutters that separate board cells, the code in the theme's value face and value
  // color, square corners, and one spacing rhythm declared here rather than a fresh value per
  // element. The palette is guaranteed rather than hand-picked:
  // --board-cell-bg, --board-category-bg, --board-value-color and --clue-text-color are pairs
  // the theme contract already guarantees legible, so all four presets render this page.
  //
  // Presentational by design: the route owns polling, fetching, storage and navigation, so the
  // whole screen server-renders in a test like every other surface here.
  import CreateRoomPanel from "#lib/landing/create-room-panel.svelte";
  import EntryCounter from "#lib/landing/entry-counter.svelte";
  import MastheadBar from "#lib/landing/masthead-bar.svelte";
  import RejoinStrip from "#lib/landing/rejoin-strip.svelte";
  import RoomBrowser from "#lib/lobby/room-browser.svelte";
  import { describeCounter, listedRoomForCode, readCounter, roomsForCounter } from "#lib/lobby/room-filter.ts";
  import type { CreateRoomForm } from "#lib/landing/create-room-request.ts";
  import type { CreateState } from "#lib/landing/create-room-panel.svelte";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";
  import type { RejoinCandidate } from "#lib/lobby/room-liveness.ts";
  import type { SurfaceCard } from "#lib/landing/surface-cards.ts";

  type Props = {
    listing: LobbyListing;
    /** The listing fetch failed outright (offline, 500). Never fatal - the code still works. */
    listingError?: string | null;
    /** False until the first fetch answers: "no rooms" and "no answer yet" are different. */
    listingLoaded?: boolean;
    /** Rooms this tab has been in, with their liveness verdict. Empty = no strip, no slot. */
    rejoins?: readonly RejoinCandidate[];
    /**
     * Seed for the counter: a `?code=` arrival (a QR scan whose scanner opened the site root
     * rather than the room), and what lets the code-wins state be server-rendered in a test.
     */
    initialCode?: string;
    createForm: CreateRoomForm;
    createState: CreateState;
    surfaces: readonly SurfaceCard[];
    onJoin: (code: string) => void;
    onJoinRoom: (room: RoomSummary) => void;
    onRejoin: (room: RejoinCandidate) => void;
    onCreate: () => void;
    onContinueCreate: (code: string) => void;
    onRefreshListing?: (() => void) | null;
    /**
     * Injected by tests so the rejoin countdown is assertable without a clock; the strip ticks
     * its own otherwise (#lib/landing/rejoin-strip.svelte).
     */
    now?: number | null;
  };
  let {
    listing,
    listingError = null,
    listingLoaded = true,
    rejoins = [],
    initialCode = "",
    createForm,
    createState,
    surfaces,
    onJoin,
    onJoinRoom,
    onRejoin,
    onCreate,
    onContinueCreate,
    onRefreshListing = null,
    now = null,
  }: Props = $props();

  // A seed, deliberately read once: after the first render the field belongs to whoever is
  // typing in it, and a `?code=` in the URL must not fight them for it.
  // svelte-ignore state_referenced_locally
  let typed = $state(initialCode);

  const reading = $derived(readCounter(typed));
  const shownRooms = $derived(roomsForCounter(listing.rooms, reading));
  const match = $derived(
    reading.kind === "code" ? listedRoomForCode(listing.rooms, reading.code) : null,
  );
  // A registry that cannot answer must never be reported as "0 rooms" - that was the exact bug
  // docs/decisions/2026-08-14-room-visibility-and-lobby.md's status field exists to end.
  const registryAnswering = $derived(listing.registry.status === "ok" && listingError === null);
  const verdict = $derived(
    describeCounter({
      reading,
      match,
      shown: shownRooms.rooms.length,
      total: listing.rooms.length,
      listingError,
      registryAnswering,
    }),
  );
</script>

<main class="front-door">
  <MastheadBar {surfaces} />

  <!-- TWO COLUMNS, and the split is by WHO (owner, 2026-08-20: "separate the front page into a
       left and right, where the left is the join code and the lobby search and the right is the
       host area. this will be a better use of space").

       It was three stacked bands: the counter, then the host form when it was asked for, then
       the room list. On a laptop that put the only two things on the page a thousand pixels
       apart vertically while the right half of the window held nothing, and the room list -
       which is the counter's own second job, since the field searches it - sat below the fold
       under a form belonging to somebody else entirely.

       The columns are not two halves of one task. The LEFT is everybody: type a code, or look
       through what is on. The RIGHT is the one person in the room who is running it. Splitting
       by person rather than by step is what makes the widths right - the left column is sized
       by the room list, the right by a form. -->
  <div class="front-columns">
    <section class="join-column" aria-label="Join a room">
      <RejoinStrip rooms={rejoins} {onRejoin} {now} />
      <EntryCounter
        value={typed}
        onInput={(raw) => {
          typed = raw;
        }}
        {verdict}
        onJoin={() => {
          if (reading.kind === "code") {
            onJoin(reading.code);
          }
        }}
      />
      <!-- The list is under the field it belongs to, not in a band of its own: what a person
           types either joins by code or filters this, so putting a page fold between the two
           hid half of what the field does (docs/decisions/2026-08-18-front-door-architecture
           .md - the counter and its results are one control). -->
      <RoomBrowser
        {listing}
        visibleRooms={shownRooms.rooms}
        filterActive={shownRooms.filterActive}
        {listingError}
        loaded={listingLoaded}
        dimmed={verdict.codeWins}
        {onJoinRoom}
        onRefresh={onRefreshListing}
      />
    </section>

    <!-- THE HOST AREA, and it no longer opens: the form IS the column. The "Host a game" button
         was a disclosure because the form had nowhere to go without pushing the room list down
         a screen; given its own column it has somewhere, and a button to reveal a thing that
         has space to simply be there would be a tap charged for nothing. Same reasoning that
         took the Roster and Settings toggles out of the console header on the same day. -->
    <section class="host-column" id="create-room-panel" aria-label="Host a game">
      <CreateRoomPanel
        form={createForm}
        state={createState}
        {onCreate}
        onContinue={onContinueCreate}
      />
    </section>
  </div>
</main>

<style>
  .front-door {
    /* One spacing rhythm and one measure, declared once and inherited by every band and every
       component inside them - the alternative (a fresh value per element) is how a page ends
       up with eleven almost-equal sizes and no hierarchy. There is deliberately no TYPE scale
       here any more: the page has exactly three type registers left, each owned by the
       component that has a reason for it - the wordmark strip, the code itself, and the room
       card. A display step existed to size a hero this page no longer has. */
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1.25rem;
    --space-5: 2rem;
    --space-6: 3.25rem;
    --space-7: 5rem;
    /* The gutter is trade dress: the same thick rule that separates board cells separates the
       bands here, and it is the board background showing through, exactly as on the board. */
    --rule: clamp(0.5rem, 1.1vw, 0.9rem);
    --page-inset: clamp(1rem, 4vw, 3.5rem);
    --measure: 78rem;
    display: flex;
    flex-direction: column;
    color: var(--clue-text-color);
    min-height: 100dvh;
    background: var(--board-bg);
  }

  /* THE TWO COLUMNS (owner, 2026-08-20). Not a 50/50 split: the left is sized by the room
     list it holds and the right by a form, so the join side gets the room and the host side
     gets exactly what it needs. `minmax(0, ...)` on both because a grid track's default
     min-content would let a long room title push the whole page wider. */
  .front-columns {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
    gap: var(--rule);
    /* STRETCH, not start (owner, 2026-08-20: "let's have them the same height"). Two boxes of
       different heights beside each other read as one box and one leftover, and which one is
       taller changes with the number of rooms in the list - so the page's shape depended on
       how busy the night was. Equal height makes them a pair. */
    align-items: stretch;
    max-width: var(--measure);
    width: 100%;
    margin: 0 auto;
    padding: var(--space-4) var(--page-inset);
  }

  /* TWO BOXES, matched (owner, 2026-08-20: "let's match the host and join areas so they are
     two boxes next to each other"). Same padding, same rule, same corner - the only thing that
     differs is the fill, and that difference is the board's own hierarchy reused: the side you
     act on gets the CELL colour, the other sits on the board's darker ground. */
  .join-column,
  .host-column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 18%, transparent);
    border-radius: 2px;
  }

  .join-column {
    gap: var(--space-3);
    background: var(--board-cell-bg);
    background-image: var(--effect-cell-overlay);
    box-shadow: var(--effect-cell-shadow);
  }

  .host-column {
    background: color-mix(in srgb, var(--board-cell-bg) 34%, #000000);
  }

  /* The room list takes whatever height the join box has left, so "same height" means the two
     boxes end level rather than one of them ending early with a gap under it. `:global`
     because the browser is a child component and Svelte's scoping does not reach into one. */
  .join-column > :global(.room-browser) {
    flex: 1;
  }

  /* ONE COLUMN on anything narrower than a laptop, and the join side goes FIRST - hosting is
     one person and joining is everybody else, which is the same reason the split exists. */
  @media (max-width: 62rem) {
    .front-columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }

</style>
