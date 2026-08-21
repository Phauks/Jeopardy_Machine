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
    onJoin: (code: string, password: string) => void;
    onJoinRoom: (room: RoomSummary, password: string) => void;
    onRejoin: (room: RejoinCandidate) => void;
    onCreate: () => void;
    onContinueCreate: (code: string) => void;
    onRefreshListing?: (() => void) | null;
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
  }: Props = $props();

  // A seed, deliberately read once: after the first render the field belongs to whoever is
  // typing in it, and a `?code=` in the URL must not fight them for it.
  // svelte-ignore state_referenced_locally
  let typed = $state(initialCode);
  let password = $state("");
  let openOnly = $state(false);
  let hostRequested = $state(false);

  const reading = $derived(readCounter(typed));
  const shownRooms = $derived(roomsForCounter(listing.rooms, reading, openOnly));
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
  // A creation in flight, refused, or held cannot be closed out from under itself: the panel
  // stays open until it is finished with, which is the layout law applied to a disclosure.
  const hostOpen = $derived(hostRequested || createState.status !== "idle");
</script>

<main class="front-door">
  <MastheadBar {surfaces} />

  <section class="counter-band" aria-label="Join or host a room">
    <div class="band-inner">
      <div class="counter-column">
        <RejoinStrip rooms={rejoins} {onRejoin} />
        <EntryCounter
          value={typed}
          onInput={(raw) => {
            typed = raw;
          }}
          {verdict}
          {password}
          onPassword={(next) => {
            password = next;
          }}
          onJoin={() => {
            if (reading.kind === "code") {
              onJoin(reading.code, verdict.password === "hidden" ? "" : password);
            }
          }}
          {hostOpen}
          onToggleHost={() => {
            hostRequested = !hostOpen;
          }}
        />

        {#if hostOpen}
          <div class="host-slot" id="create-room-panel">
            <CreateRoomPanel
              form={createForm}
              state={createState}
              {onCreate}
              onContinue={onContinueCreate}
            />
          </div>
        {/if}
      </div>
    </div>
  </section>

  <section class="rooms-band">
    <div class="band-inner">
      <RoomBrowser
        {listing}
        visibleRooms={shownRooms.rooms}
        filterActive={shownRooms.filterActive}
        {openOnly}
        onOpenOnly={(next) => {
          openOnly = next;
        }}
        {listingError}
        loaded={listingLoaded}
        dimmed={verdict.codeWins}
        {onJoinRoom}
        onRefresh={onRefreshListing}
      />
    </div>
  </section>

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

  .band-inner {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: var(--measure);
    width: 100%;
    margin: 0 auto;
    padding: var(--space-4) var(--page-inset);
  }

  /* The counter gets the CELL fill; the list sits on a darker ground and the footer on the
     board's own. That is the board's hierarchy reused: cells are what you act on. */
  .counter-band {
    background: var(--board-cell-bg);
    background-image: var(--effect-cell-overlay);
    box-shadow: var(--effect-cell-shadow);
    border-bottom: var(--rule) solid var(--board-bg);
  }

  /* The counter is a COLUMN inside a full-bleed band, not a full-width row: at 1440px a verdict
     sentence on the left and a Host button pinned to the far right are a thousand pixels apart
     and stop reading as one control. The band still spans the page (it is a board cell) and the
     column starts at the same left inset as the room list below it, so the two regions share an
     edge instead of floating independently. */
  .counter-column {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    max-width: 58rem;
  }

  .host-slot {
    /* The create form opens INSIDE the counter band, under the field that is still on screen -
       a disclosure, never a second screen (decision 2026-08-18 §3). */
    border-top: 1px solid color-mix(in srgb, var(--clue-text-color) 20%, transparent);
    padding-top: var(--space-3);
  }

  .rooms-band {
    flex: 1;
    background: color-mix(in srgb, var(--board-cell-bg) 34%, #000000);
    border-bottom: var(--rule) solid var(--board-bg);
  }
</style>
