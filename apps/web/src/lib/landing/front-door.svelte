<script lang="ts">
  // THE FRONT DOOR. One screen, three ways in - rejoin what you were in, join by code or from
  // the live list, or create a room - all present at once, none of them a separate page
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Landing and lobby":
  // browsing and joining are the same act, so /lobby folded back into / and was deleted).
  //
  // ART DIRECTION (owner: the page read bland and AI-made). The page is built out of the
  // BOARD'S OWN MATERIALS rather than out of chrome: a full-bleed category-blue masthead, ink
  // panels separated by thick near-black gutters exactly the way board cells are, values and
  // numbers in the theme's value face and value color, square corners, and a type scale and
  // spacing rhythm declared once at the top of this file instead of a default 1rem everywhere.
  // Nothing here is a rounded card with a soft shadow on a centered column, which is the
  // generic look docs/research/05-ui-design.md section 2 names as the tell.
  //
  // It also means the palette is guaranteed rather than hand-picked: --board-cell-bg,
  // --board-category-bg, --board-value-color and --clue-text-color are the four the theme
  // contract already pairs for legibility on the projector, so all four presets - including
  // the light paper one, where the derived chrome tokens converge - render this page correctly.
  //
  // Presentational by design: the route owns polling, fetching, storage and navigation, so this
  // whole screen server-renders in a test like every other surface here.
  import CreateRoomPanel from "#lib/landing/create-room-panel.svelte";
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
    /** Clock for the "updated Xm ago" line; injected so the screen renders deterministically. */
    now?: number;
    /** Rooms this tab has been in, with their liveness verdict. Empty = no offer, no slot. */
    rejoins?: readonly RejoinCandidate[];
    /**
     * Seed for the code box: a `?code=` arrival (a QR scan whose scanner opened the site root
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
    now = Date.now(),
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
  <header class="masthead">
    <div class="masthead-inner">
      <div class="identity">
        <p class="eyebrow">Self-hosted quiz-show night</p>
        <h1 class="wordmark">Jeopardy Machine</h1>
        <!-- The hero is a SHORT lead plus a supporting line, both with a hard measure, because
             the one long sentence that used to be here wrapped into a ragged block on a laptop
             (owner report). Two elements break predictably; one long one cannot. -->
        <p class="lead">Quiz night, on everyone's phone.</p>
        <p class="support">
          You run the board on the big screen. Everyone else scans a code and buzzes in. No app,
          no account, nothing to install.
        </p>
      </div>

      <dl class="facts">
        <div class="fact">
          <dt>Players</dt>
          <dd>2-{limits.room.playerSoftCap}</dd>
        </div>
        <div class="fact">
          <dt>To join</dt>
          <dd>{limits.room.roomCodeLength} characters</dd>
        </div>
        <div class="fact">
          <dt>Accounts</dt>
          <dd>None, ever</dd>
        </div>
      </dl>
    </div>
  </header>

  <div class="deck">
    <div class="slot rejoin-slot">
      <RejoinPanel rooms={rejoins} {onRejoin} />
    </div>

    <section class="slot join-slot" aria-labelledby="join-heading">
      <h2 class="panel-heading" id="join-heading">
        <span class="marker">01</span>
        <span class="heading-text">Join a room</span>
      </h2>

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
           typing the last character of a code does not move anything below it. -->
      <p class="join-note" role="status">
        {#if codeComplete}
          Using the code you typed - the list is on hold. Clear the box to browse again.
        {:else if listingError !== null}
          The public list is unavailable right now ({listingError}). A room code still works.
        {:else}
          A code from the big screen beats anything in the list beside it.
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
        <span class="marker">03</span>
        <span class="heading-text">Public rooms</span>
        <span class="heading-count">
          {#if listingAnswering}
            {roomCount === 0 ? "none listed" : `${String(roomCount)} live`}
          {/if}
        </span>
      </h2>
      <p class="panel-lede">
        Hosts opt in to being listed; most rooms are private and joined by code. Picking one
        here does exactly what typing its code does.
      </p>
      <RoomBrowser
        {listing}
        {listingError}
        loaded={listingLoaded}
        {now}
        dimmed={codeComplete}
        {onJoinRoom}
        onRefresh={onRefreshListing}
      />
    </section>
  </div>

  <div class="closing-band">
    <section class="pillars" aria-label="What this is">
      <article class="pillar">
        <h3>Players never log in</h3>
        <p>
          Scan the QR or type the code. No app, no account, no cookie banner - and nothing kept
          after the night ends.
        </p>
      </article>
      <article class="pillar">
        <h3>Two to a hundred, in teams</h3>
        <p>
          Everyone buzzes from their own phone. Teams pick their own name, colour, and the sound
          the room hears when they buzz in.
        </p>
      </article>
      <article class="pillar">
        <h3>Your questions, your look</h3>
        <p>
          Games, question packs, and themes are portable files you own. Import them, export
          them, run the whole thing on your own Cloudflare account.
        </p>
      </article>
    </section>

    <details class="dev-drawer">
      <summary>
        <span class="drawer-title">Developer surfaces</span>
        <span class="drawer-note">
          {surfaces.length} routes - the suite is still being built milestone by milestone
        </span>
      </summary>
      <ul class="surface-list">
        {#each surfaces as surface (surface.href)}
          <li class="surface-card">
            <a href={surface.href}>{surface.title}</a>
            <p>{surface.note}</p>
          </li>
        {/each}
      </ul>
    </details>
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
    --step-display: clamp(2.9rem, 1.1rem + 7vw, 6.5rem);
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

  /* ---- masthead: a full-bleed ink band, asymmetric rather than centered ------------------ */

  .masthead {
    background: var(--board-category-bg);
    padding: clamp(2rem, 6vh, 4.5rem) var(--page-inset) clamp(1.75rem, 4vh, 3rem);
    border-bottom: var(--rule) solid var(--board-bg);
  }

  .masthead-inner {
    max-width: var(--measure);
    margin: 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .eyebrow {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.28em;
    font-size: 0.72rem;
    color: var(--board-value-color);
  }

  .wordmark {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--step-display);
    line-height: 0.9;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
  }

  /* The hero's two halves, each with a hard measure so the break points are decided here
     rather than by whatever width the window happens to be. */
  .lead {
    margin: var(--space-3) 0 0;
    font-family: var(--font-chrome);
    font-size: var(--step-2);
    line-height: 1.15;
    max-inline-size: 22ch;
    text-wrap: balance;
    color: var(--clue-text-color);
  }

  .support {
    margin: 0;
    font-size: var(--step-0);
    line-height: 1.55;
    max-inline-size: 44ch;
    text-wrap: pretty;
    color: color-mix(in srgb, var(--clue-text-color) 72%, transparent);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-5);
    margin: 0;
    padding: var(--space-3) 0 0;
    border-top: 2px solid color-mix(in srgb, var(--board-value-color) 55%, transparent);
  }

  .fact {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .fact dt {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.68rem;
    color: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
  }

  .fact dd {
    margin: 0;
    font-family: var(--font-values);
    font-size: var(--step-3);
    line-height: 1;
    letter-spacing: 0.04em;
    color: var(--board-value-color);
  }

  /* ---- the deck: panels as cells, gutters as the ground between them --------------------- */

  .deck {
    display: grid;
    gap: var(--rule);
    max-width: var(--measure);
    width: 100%;
    margin: 0 auto;
    padding: var(--rule) var(--page-inset);
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
      max-height: calc(100dvh - 6rem);
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
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  /* The section numbers are CHROME, not values: the value face is an ultra-condensed poster
     face that only works large (it is sized for a projector), and at 1rem it reads as noise.
     The value COLOR is what carries the family resemblance here. */
  .marker {
    font-family: var(--font-chrome);
    font-size: 1.05rem;
    line-height: 1;
    letter-spacing: 0.18em;
    color: var(--board-value-color);
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

  .panel-lede {
    margin: 0;
    max-inline-size: 56ch;
    font-size: 0.85rem;
    line-height: 1.5;
    color: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
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

  /* ---- the quiet half of the page ------------------------------------------------------- */

  /* The quiet half is an ink block too, for one concrete reason as much as a stylistic one:
     the page ground is --board-bg, which is near-black in three presets and PAPER in the
     event-poster one, so text laid straight onto it has no guaranteed partner color. Inside a
     cell-derived block, --clue-text-color is guaranteed to work - the same rule the panels
     above follow. */
  .closing-band {
    background: color-mix(in srgb, var(--board-cell-bg) 34%, #000000);
    border-top: var(--rule) solid var(--board-bg);
    margin-top: var(--rule);
  }

  .pillars {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-5);
    max-width: var(--measure);
    width: 100%;
    margin: 0 auto;
    padding: var(--space-6) var(--page-inset) var(--space-5);
  }

  .pillar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 2px solid color-mix(in srgb, var(--board-value-color) 45%, transparent);
  }

  .pillar h3 {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: var(--step-1);
    color: var(--board-value-color);
  }

  .pillar p {
    margin: 0;
    max-inline-size: 42ch;
    font-size: 0.92rem;
    line-height: 1.55;
    color: color-mix(in srgb, var(--clue-text-color) 72%, transparent);
  }

  .dev-drawer {
    max-width: var(--measure);
    width: 100%;
    margin: 0 auto;
    padding: var(--space-4) var(--page-inset) var(--space-7);
    border-top: 1px solid color-mix(in srgb, var(--clue-text-color) 18%, transparent);
  }

  .dev-drawer summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    cursor: pointer;
    list-style: none;
  }

  .dev-drawer summary::-webkit-details-marker {
    display: none;
  }

  .drawer-title {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.8rem;
    color: color-mix(in srgb, var(--clue-text-color) 78%, transparent);
  }

  .drawer-title::before {
    content: "+ ";
    color: var(--board-value-color);
  }

  .dev-drawer[open] .drawer-title::before {
    content: "- ";
  }

  .drawer-note {
    font-size: 0.75rem;
    color: color-mix(in srgb, var(--clue-text-color) 55%, transparent);
  }

  .surface-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: var(--space-2);
    list-style: none;
    margin: var(--space-4) 0 0;
    padding: 0;
  }

  .surface-card {
    padding: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 16%, transparent);
    background: color-mix(in srgb, var(--board-cell-bg) 22%, transparent);
  }

  .surface-card a {
    font-family: var(--font-chrome);
    font-size: 0.9rem;
    letter-spacing: 0.03em;
    color: var(--board-value-color);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .surface-card p {
    margin: var(--space-1) 0 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: color-mix(in srgb, var(--clue-text-color) 60%, transparent);
  }

  .join-button:focus-visible,
  .password-field input:focus-visible,
  .dev-drawer summary:focus-visible,
  .surface-card a:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

</style>
