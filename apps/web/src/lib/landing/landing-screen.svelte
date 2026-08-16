<script lang="ts">
  // The front door. Everything a stranger holding a phone needs, in the order they need it:
  // what this is, the code box, the way to browse. The dev-surface index that used to BE this
  // page is still here in full (owner rule: every meaningful surface gets a card in the PR
  // that ships it) - demoted into a closed drawer, because a person arriving to play a quiz
  // should not have to read past nine engineering links to find the code box.
  //
  // Presentational on purpose: the route owns polling and navigation, this owns the screen, so
  // it server-renders in a test the way the other surfaces do.
  import RegistryStatusLine from "#lib/lobby/registry-status-line.svelte";
  import RoomCodeField from "#lib/lobby/room-code-field.svelte";
  import { limits } from "@jeopardy/protocol/limits";
  import type { LobbyListing } from "@jeopardy/protocol/room/registry";

  export type SurfaceCard = { href: string; title: string; note: string };

  type Props = {
    listing: LobbyListing;
    /** The lobby fetch failed outright (offline, 500). Never fatal - the code box still works. */
    listingError?: string | null;
    surfaces: readonly SurfaceCard[];
    onJoin: (code: string, password: string) => void;
  };
  let { listing, listingError = null, surfaces, onJoin }: Props = $props();

  let typedCode = $state("");
  let password = $state("");
  let passwordShown = $state(false);

  const codeComplete = $derived(typedCode.length === limits.room.roomCodeLength);
  const publicRoomCount = $derived(listing.rooms.length);
  // A registry that cannot answer must not be reported as "0 rooms" - that was the exact bug
  // docs/decisions/2026-08-14-room-visibility-and-lobby.md's status field exists to end.
  const lobbyAnswering = $derived(listing.registry.status === "ok" && listingError === null);
</script>

<main class="landing">
  <header class="hero">
    <p class="eyebrow">Self-hosted quiz-show night</p>
    <h1 class="wordmark">Jeopardy Machine</h1>
    <p class="lede">
      A big screen, a host, and everyone's phone as a buzzer. Nobody makes an account, nobody
      installs anything - a room code is the whole join flow.
    </p>
  </header>

  <section class="join-card" aria-labelledby="join-heading">
    <h2 class="card-heading" id="join-heading">Join a game</h2>
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
      <button class="join-button" type="submit" disabled={!codeComplete}>Join</button>

      {#if passwordShown}
        <label class="password-field">
          <span class="password-label">Room password</span>
          <input
            type="password"
            autocomplete="off"
            maxlength={limits.room.roomPasswordMaxLength}
            placeholder="Shouted across the hall, not emailed"
            bind:value={password}
          />
        </label>
      {:else}
        <button
          type="button"
          class="password-toggle"
          onclick={() => {
            passwordShown = true;
          }}
        >
          This room has a password
        </button>
      {/if}
    </form>

    <div class="browse-row" class:dimmed={codeComplete}>
      <a class="browse-link" href="/lobby">Browse public rooms</a>
      {#if lobbyAnswering}
        <span class="browse-count">
          {publicRoomCount === 0
            ? "none listed right now"
            : `${String(publicRoomCount)} live ${publicRoomCount === 1 ? "room" : "rooms"}`}
        </span>
      {/if}
    </div>
    {#if codeComplete}
      <!-- The code box always wins (the decision doc's rule): someone holding a code came to
           use it, not to browse, so the browse affordance steps back rather than competing. -->
      <p class="code-wins">Using the code you typed. Clear it to browse instead.</p>
    {/if}
    {#if listingError !== null}
      <p class="listing-error">
        The public list is unavailable right now ({listingError}). A room code still works.
      </p>
    {/if}
    <RegistryStatusLine status={listing.registry} quiet />
  </section>

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
        Games, question packs, and themes are portable files you own. Import them, export them,
        run the whole thing on your own Cloudflare account.
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
</main>

<style>
  .landing {
    display: flex;
    flex-direction: column;
    gap: clamp(1.5rem, 5vh, 3rem);
    max-width: 62rem;
    margin: 0 auto;
    padding: clamp(2rem, 8vh, 5rem) clamp(1rem, 5vw, 3rem) 5rem;
    color: var(--surface-text);
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-width: 34ch;
  }

  .eyebrow {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.75rem;
    color: var(--accent);
    margin: 0;
  }

  .wordmark {
    font-family: var(--font-display);
    /* Same clamp shape as the display's title card, one step smaller: the landing is read at
       arm's length, the projector across a hall. */
    font-size: clamp(2.6rem, 9vw, 5rem);
    line-height: 0.95;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    margin: 0;
  }

  .lede {
    font-size: clamp(1rem, 2.4vw, 1.2rem);
    line-height: 1.5;
    color: var(--surface-text-muted);
    margin: 0;
    max-width: 46ch;
  }

  .join-card {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: clamp(1rem, 3vw, 1.75rem);
    border-radius: calc(var(--board-radius) + 6px);
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    /* The accent hairline is the only chrome that names this as THE control on the page. */
    border-top: 3px solid var(--accent);
    max-width: 34rem;
  }

  .card-heading {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.95rem;
    color: var(--surface-text);
    margin: 0;
  }

  .join-form {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.75rem;
  }

  .join-button {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1.05rem;
    /* Matches the code input's own box height so the pair reads as one control. */
    padding: 1.1rem 1.5rem;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    cursor: pointer;
  }

  .join-button:disabled {
    background: var(--surface-border);
    color: var(--surface-text-muted);
    cursor: default;
  }

  .password-toggle {
    grid-column: 1 / -1;
    justify-self: start;
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-chrome);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .password-field {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .password-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.72rem;
    color: var(--surface-text-muted);
  }

  .password-field input {
    font: inherit;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-page);
    color: var(--surface-text);
  }

  .browse-row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
    transition: opacity 150ms ease;
  }

  .browse-row.dimmed {
    opacity: 0.45;
  }

  .browse-link {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.9rem;
    color: var(--surface-text);
    text-decoration: underline;
    text-underline-offset: 4px;
    text-decoration-color: var(--accent);
  }

  .browse-count,
  .code-wins,
  .listing-error {
    font-size: 0.8rem;
    color: var(--surface-text-muted);
    margin: 0;
  }

  .pillars {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: clamp(0.75rem, 2vw, 1.5rem);
  }

  .pillar {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .pillar h3 {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.95rem;
    color: var(--board-value-color);
    margin: 0;
  }

  .pillar p {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--surface-text-muted);
  }

  .dev-drawer {
    border-top: 1px solid var(--surface-border);
    padding-top: 1rem;
  }

  .dev-drawer summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.6rem;
    cursor: pointer;
    list-style: none;
  }

  .dev-drawer summary::-webkit-details-marker {
    display: none;
  }

  .drawer-title {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.85rem;
    color: var(--surface-text);
  }

  .drawer-title::before {
    content: "+ ";
    color: var(--accent);
  }

  .dev-drawer[open] .drawer-title::before {
    content: "- ";
  }

  .drawer-note {
    font-size: 0.78rem;
    color: var(--surface-text-muted);
  }

  .surface-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: 0.6rem;
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
  }

  .surface-card {
    padding: 0.7rem 0.8rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
    background: var(--surface-raised);
  }

  .surface-card a {
    font-family: var(--font-chrome);
    font-size: 0.9rem;
    letter-spacing: 0.03em;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .surface-card p {
    margin: 0.3rem 0 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--surface-text-muted);
  }

  .join-button:focus-visible,
  .password-toggle:focus-visible,
  .browse-link:focus-visible,
  .dev-drawer summary:focus-visible,
  .surface-card a:focus-visible,
  .password-field input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 34rem) {
    /* The Join button drops under the code box rather than squeezing it: the code is the
       control that has to stay readable, and a stacked pair is still one thumb-stroke apart. */
    .join-form {
      grid-template-columns: 1fr;
    }
  }
</style>
