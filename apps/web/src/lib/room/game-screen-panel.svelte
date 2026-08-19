<script lang="ts">
  // "HOW DOES THE ROOM SEE THIS GAME" - the choice a host makes once on arrival, with the action
  // for each answer attached to it (docs/design/user-flows.md C1/C1b).
  //
  // Before this panel the two setups were unrelated features: mirror mode was a toggle buried in
  // the cog, and the second-screen setup - the common one - was a URL a host had to know. So the
  // console asks the question outright, and whichever answer is chosen, the thing to do next is
  // one button away:
  //
  //   Second screen  ->  [Open game screen], then the live state of the window we opened.
  //   Mirror         ->  nothing to open; this laptop IS the game screen, and the console
  //                      reshapes into the display layout the moment it is chosen.
  //
  // The state readout is not decoration. The 2026-08-16 host-loop walk found starting a game with
  // nothing attached to be a real footgun - the host reads a clue off their own screen while the
  // projector shows a desktop - and a window that was closed mid-game is invisible to a host
  // whose eyes are on the console. Rules and copy: src/lib/room/game-screen.ts.
  import { gameScreenStatus, gameScreenUrl } from "#lib/room/game-screen.ts";
  import type { GameScreenWindow } from "#lib/room/game-screen.svelte.ts";
  import type { DevicePreferencesStore } from "#lib/host-settings/device-preferences.svelte.ts";
  import type { RoomView } from "#lib/room/room-view.ts";

  type Props = {
    view: RoomView;
    gameScreen: GameScreenWindow;
    preferences: DevicePreferencesStore;
    /** Carried onto the display URL so the projector opens wearing the console's theme. */
    themeId?: string | null;
    /** `chip` is the always-on header readout; `panel` is the lobby's full setup card. */
    variant?: "panel" | "chip";
  };
  let { view, gameScreen, preferences, themeId = null, variant = "panel" }: Props = $props();

  const setup = $derived(preferences.current.screenSetup);
  const displays = $derived(view.connections?.display ?? null);
  const status = $derived(gameScreenStatus(gameScreen.state, displays));
  let blocked = $state(false);

  function open(): void {
    if (status.action === "focus") {
      gameScreen.focus();
      return;
    }
    blocked = !gameScreen.open(gameScreenUrl(view.roomCode, themeId), view.roomCode);
  }

  function chooseMirror(): void {
    preferences.update({ screenSetup: "mirror" });
  }

  function chooseSecondScreen(): void {
    preferences.update({ screenSetup: "second-screen" });
  }

  const actionLabel = $derived(
    status.action === "focus"
      ? "Bring it to the front"
      : status.action === "reopen"
        ? "Reopen game screen"
        : "Open game screen",
  );
</script>

{#if variant === "chip"}
  <!-- The header readout: present in every phase, because a projector can be unplugged at any
       point in the night and the console is the only place that would notice. -->
  <span class="screen-chip" data-tone={status.tone} role="status">
    <span class="dot" aria-hidden="true"></span>
    {setup === "mirror" ? "Mirrored on this screen" : status.headline}
  </span>
{:else}
  <section class="game-screen-panel" aria-label="Game screen">
    <header class="panel-head">
      <h2>Game screen</h2>
      <span class="head-note">How the room sees this game</span>
    </header>

    <div class="choice" role="group" aria-label="Screen setup">
      <button
        type="button"
        class="option"
        class:active={setup === "second-screen"}
        aria-pressed={setup === "second-screen"}
        onclick={chooseSecondScreen}
      >
        <span class="option-title">Second screen</span>
        <span class="option-note">Projector or TV as another output. This console stays private.</span>
      </button>
      <button
        type="button"
        class="option"
        class:active={setup === "mirror"}
        aria-pressed={setup === "mirror"}
        onclick={chooseMirror}
      >
        <span class="option-title">Mirror this screen</span>
        <span class="option-note">This laptop IS the projector. Answers stop rendering here.</span>
      </button>
    </div>

    {#if setup === "mirror"}
      <p class="status" data-tone="attached">
        <strong>This screen is the game screen.</strong>
        Nothing to open - the console wears the display layout, and the private layer is gone.
      </p>
    {:else}
      <p class="status" data-tone={status.tone} role="status">
        <strong>{status.headline}</strong>
        {status.detail}
      </p>
      <div class="actions">
        <button type="button" class="chip primary" onclick={open}>{actionLabel}</button>
      </div>
      {#if blocked}
        <p class="blocked" role="alert">
          The browser blocked the window. Allow pop-ups for this site, or open
          <code>{gameScreenUrl(view.roomCode, themeId)}</code> in a second window yourself.
        </p>
      {/if}
      {#if displays !== null}
        <!-- The room's own census, not our window handle: a Chromecast or a co-host's laptop is
             a game screen this console never opened (packages/protocol/src/room/diagnostics.ts). -->
        <p class="census">
          {displays}
          {displays === 1 ? "display" : "displays"} connected to the room · {view.connections?.player ?? 0}
          on a phone
        </p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .game-screen-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.8rem 0.9rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    color: var(--surface-text);
    min-width: 0;
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .panel-head h2 {
    margin: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 1em;
  }

  .head-note,
  .census,
  .option-note {
    font-family: var(--font-chrome);
    font-size: 0.75em;
    color: var(--surface-text-muted);
  }

  /* Two options, side by side and equally weighted: this is a choice between setups, not a
     feature with a toggle. */
  .choice {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.4rem;
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    text-align: left;
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .option.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .option-title {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.85em;
  }

  .status {
    margin: 0;
    font-size: 0.9em;
    line-height: 1.35;
    padding-left: 0.5rem;
    border-left: 3px solid var(--surface-text-muted);
  }

  /* Tone is carried by the word first and the rule second - a washed-out projector-lit laptop
     must never be the only way to tell these apart. */
  .status[data-tone="attached"] {
    border-left-color: var(--score-positive);
  }

  .status[data-tone="lost"] {
    border-left-color: var(--score-negative);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .blocked {
    margin: 0;
    font-size: 0.8em;
    color: var(--score-negative);
  }

  .census {
    margin: 0;
  }

  .chip {
    font-family: var(--font-chrome);
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .chip.primary {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* The header readout, same tone vocabulary, one line. */
  .screen-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-chrome);
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--surface-text-muted);
  }

  .screen-chip .dot {
    width: 0.5em;
    height: 0.5em;
    border-radius: 999px;
    background: var(--surface-text-muted);
  }

  .screen-chip[data-tone="attached"] .dot {
    background: var(--score-positive);
  }

  .screen-chip[data-tone="lost"] .dot {
    background: var(--score-negative);
  }
</style>
