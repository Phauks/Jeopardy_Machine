<script lang="ts">
  // THE FRONT DOOR. ONE screen: rejoin what you were in, join by code or from the live list, or
  // create a room - all present at once, none of them a separate page
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Landing and lobby":
  // browsing and joining are the same act, so /lobby folded back into / and was deleted).
  //
  // SIMPLIFIED 2026-08-17, after the owner read the deployed page: it was nominally one screen
  // and still read as three stacked things, because every region opened with a sentence
  // explaining itself and the page closed with a three-pillar marketing block. All of that
  // prose is deleted. The rule that replaced it: the page explains itself by being obvious. A
  // code box labelled "Room code" needs no paragraph about codes; two radio buttons labelled
  // Private/Public need no paragraph about listing; the product does not need a pitch on the
  // screen where someone is trying to type five characters. What is left is a header, four
  // controls, and no narration - the only running text on the page is the words a state
  // change needs (a refusal, a registry fault, a code that beat the list).
  //
  // ART DIRECTION (owner: the page read bland and AI-made). Built out of the BOARD'S OWN
  // MATERIALS rather than out of chrome: a full-bleed category-blue masthead, ink panels
  // separated by thick near-black gutters exactly the way board cells are, numbers in the
  // theme's value face and value color, square corners, and a type scale and spacing rhythm
  // declared once at the top of this file. Nothing here is a rounded card with a soft shadow on
  // a centered column, which is the generic look docs/research/05-ui-design.md section 2 names
  // as the tell. It also makes the palette guaranteed rather than hand-picked:
  // --board-cell-bg, --board-category-bg, --board-value-color and --clue-text-color are the
  // four the theme contract already pairs for legibility, so all four presets - including the
  // light paper one, where the derived chrome tokens converge - render this page correctly.
  //
  // Presentational by design: the route owns polling, fetching, storage and navigation, so this
  // whole screen server-renders in a test like every other surface here.
  import CreateRoomPanel from "#lib/landing/create-room-panel.svelte";
  import DevMenu from "#lib/landing/dev-menu.svelte";
  import RejoinPanel from "#lib/landing/rejoin-panel.svelte";
  import RoomBrowser from "#lib/lobby/room-browser.svelte";
  import RoomCodeField from "#lib/lobby/room-code-field.svelte";
  import { limits } from "@jeopardy/protocol/limits";
  import type { CreateRoomForm } from "#lib/landing/create-room-request.ts";
  import type { CreateState } from "#lib/landing/create-room-panel.svelte";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";
  import type { RejoinCandidate } from "#lib/landing/rejoin-panel.svelte";
  import type { SurfaceCard } from "#lib/landing/surface-cards.ts";

  type Props = {
    listing: LobbyListing;
    /** The listing fetch failed outright (offline, 500). Never fatal - the code still works. */
    listingError?: string | null;
    /** False until the first fetch answers: "no rooms" and "no answer yet" are different. */
    listingLoaded?: boolean;
    /** Rooms this tab has been in, with their liveness verdict. Empty = no offer, no slot. */
    rejoins?: readonly RejoinCandidate[];
    /**
     * Seed for the code box: a `?code=` arrival (a QR scan whose scanner opened the site root
     * rather than the room), and what lets the code-wins state be server-rendered in a test.
     */
    initialCode?: string;
    /** Seed for the room search box, so the filtered list can be server-rendered in a test. */
    initialSearch?: string;
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
    initialSearch = "",
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

  // A seed, deliberately read once: after the first render this box belongs to whoever is
  // typing in it, and a `?code=` in the URL must not fight them for it.
  // svelte-ignore state_referenced_locally
  let typedCode = $state(initialCode);
  let password = $state("");

  const codeComplete = $derived(typedCode.length === limits.room.roomCodeLength);
  // A registry that cannot answer must never be reported as "0 rooms" - that was the exact bug
  // docs/decisions/2026-08-14-room-visibility-and-lobby.md's status field exists to end.
  const listingAnswering = $derived(listing.registry.status === "ok" && listingError === null);
  const roomCount = $derived(listing.rooms.length);
</script>

<main class="front-door">
  <!-- Just a header: the wordmark and the way to the dev surfaces. Everything that used to sit
       around the title - an eyebrow, a lead, a supporting sentence and a row of statistics -
       is deleted (owner call 2026-08-17). -->
  <header class="masthead">
    <div class="masthead-inner">
      <h1 class="wordmark">Jeopardy Machine</h1>
      <DevMenu {surfaces} />
    </div>
  </header>

  <div class="deck">
    <div class="slot rejoin-slot">
      <RejoinPanel rooms={rejoins} {onRejoin} />
    </div>

    <section class="slot join-slot" aria-labelledby="join-heading">
      <h2 class="panel-heading" id="join-heading">Join a room</h2>

      <form
        class="join-form"
        onsubmit={(event) => {
          event.preventDefault();
          if (codeComplete) onJoin(typedCode, password);
        }}
      >
        <RoomCodeField
          value={typedCode}
          onInput={(code) => {
            typedCode = code;
          }}
        />
        <label class="password-field">
          <span class="field-label">Password</span>
          <input
            type="password"
            autocomplete="off"
            maxlength={limits.room.roomPasswordMaxLength}
            bind:value={password}
          />
        </label>
        <button class="join-button" type="submit" disabled={!codeComplete}>Join</button>
      </form>

      <!-- Reserved: the code-wins line and the list-unavailable line share one block, so
           typing the last character of a code does not move anything below it. Blank when
           there is nothing to say - the block holds its height either way. -->
      <p class="join-note" role="status">
        {#if codeComplete}
          Using the code you typed - the list is on hold. Clear the box to browse again.
        {:else if listingError !== null}
          The public list is unavailable right now ({listingError}). A room code still works.
        {/if}
      </p>
    </section>

    <div class="slot create-slot">
      <CreateRoomPanel
        form={createForm}
        state={createState}
        {onCreate}
        onContinue={onContinueCreate}
      />
    </div>

    <section class="slot browse-slot" aria-labelledby="browse-heading">
      <h2 class="panel-heading" id="browse-heading">
        <span class="heading-text">Public rooms</span>
        <span class="heading-count">
          {#if listingAnswering}
            {roomCount === 0 ? "none listed" : `${String(roomCount)} live`}
          {/if}
        </span>
      </h2>
      <RoomBrowser
        {listing}
        {listingError}
        loaded={listingLoaded}
        initialQuery={initialSearch}
        dimmed={codeComplete}
        {onJoinRoom}
        onRefresh={onRefreshListing}
      />
    </section>
  </div>
</main>

<style>
  .front-door {
    /* One type scale and one spacing rhythm, declared once. Every size below comes from these
       - the alternative (a fresh clamp() per element) is how a page ends up with eleven
       almost-equal sizes and no hierarchy. */
    --step-0: 1rem;
    --step-1: clamp(1.05rem, 0.99rem + 0.3vw, 1.25rem);
    --step-2: clamp(1.3rem, 1.15rem + 0.75vw, 1.85rem);
    --step-3: clamp(1.75rem, 1.4rem + 1.6vw, 2.75rem);
    --step-display: clamp(2.4rem, 1.1rem + 5.5vw, 5rem);
    --space-1: 0.25rem;
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1.25rem;
    --space-5: 2rem;
    --space-6: 3.25rem;
    --space-7: 5rem;
    /* The gutter is trade dress: the same thick rule that separates board cells separates the
       panels here, and it is the board background showing through, exactly as on the board. */
    --rule: clamp(0.5rem, 1.1vw, 0.9rem);
    --page-inset: clamp(1rem, 4vw, 3.5rem);
    --measure: 96rem;
    display: flex;
    flex-direction: column;
    color: var(--clue-text-color);
    min-height: 100dvh;
    background: var(--board-bg);
  }

  /* ---- masthead: an ink band with a name in it, and nothing else ------------------------- */

  .masthead {
    background: var(--board-category-bg);
    padding: clamp(1rem, 3vh, 1.75rem) var(--page-inset);
    border-bottom: var(--rule) solid var(--board-bg);
  }

  .masthead-inner {
    max-width: var(--measure);
    margin: 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .wordmark {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--step-display);
    line-height: 0.9;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    /* Balanced and measured even though it is two words: a wordmark that drops "Machine" onto
       a second line alone is the exact ragged break the reflow gate exists to prevent. */
    max-inline-size: 18ch;
    text-wrap: balance;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
  }

  /* ---- the deck: panels as cells, gutters as the ground between them --------------------- */

  .deck {
    display: grid;
    gap: var(--rule);
    max-width: var(--measure);
    width: 100%;
    margin: 0 auto;
    padding: var(--rule) var(--page-inset) var(--space-5);
  }

  @media (min-width: 62rem) {
    /* Wide on a laptop, and genuinely two-column: the control column holds join and create,
       the list runs full height beside them. A stretched phone column is the thing the owner
       called out, so the desktop layout is a different arrangement, not the same one wider. */
    .deck {
      grid-template-columns: minmax(21rem, 26rem) minmax(0, 1fr);
      grid-template-areas:
        "rejoin rejoin"
        "join   browse"
        "create browse";
      align-items: start;
    }

    .rejoin-slot {
      grid-area: rejoin;
    }

    .join-slot {
      grid-area: join;
    }

    .create-slot {
      grid-area: create;
    }

    .browse-slot {
      grid-area: browse;
      /* The tallest column sets the height; the list gets its own scroll rather than dragging
         the page down when forty rooms are listed. */
      max-height: calc(100dvh - 8rem);
      overflow-y: auto;
    }
  }

  .slot {
    min-width: 0;
  }

  .join-slot,
  .browse-slot {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: clamp(1rem, 2.2vw, 1.5rem);
  }

  /* The primary control gets the CELL fill; create and rejoin get the CATEGORY fill. That is
     the board's own hierarchy, reused: cells are what you act on, headers are what labels
     them. */
  .join-slot {
    background: var(--board-cell-bg);
    background-image: var(--effect-cell-overlay);
    box-shadow: var(--effect-cell-shadow);
  }

  .browse-slot {
    background: color-mix(in srgb, var(--board-cell-bg) 34%, #000000);
  }

  .panel-heading {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.95rem;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    text-wrap: balance;
  }

  .heading-text {
    font-weight: 400;
  }

  .heading-count {
    margin-left: auto;
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    color: var(--board-value-color);
  }

  /* One column, always. The control column is about 22rem wide on a laptop and the whole
     screen on a phone, so a code box and a button side by side would be cramped at every size
     this form is ever laid out at - and stacking keeps tab order equal to reading order. */
  .join-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .password-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.7rem;
    color: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
  }

  .password-field input {
    font: inherit;
    font-size: 0.95rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 26%, transparent);
    border-radius: 2px;
    background: color-mix(in srgb, var(--board-cell-bg) 55%, #000000);
    color: var(--clue-text-color);
  }

  .join-button {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 1.05rem;
    /* Matches the code input's own box height so the pair reads as one control. */
    padding: 1.15rem 1.5rem;
    width: 100%;
    border: none;
    border-radius: 2px;
    background: var(--board-value-color);
    color: color-mix(in srgb, var(--board-cell-bg) 26%, #000000);
    cursor: pointer;
  }

  .join-button:disabled {
    background: color-mix(in srgb, var(--clue-text-color) 18%, transparent);
    color: color-mix(in srgb, var(--clue-text-color) 55%, transparent);
    cursor: default;
  }

  .join-note {
    /* Reserved for two lines at the narrowest column: the message changes, the box does not. */
    min-height: 2.6rem;
    margin: 0;
    max-inline-size: 48ch;
    font-size: 0.8rem;
    line-height: 1.4;
    color: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
  }

  .join-button:focus-visible,
  .password-field input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
