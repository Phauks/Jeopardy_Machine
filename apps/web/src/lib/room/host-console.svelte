<script lang="ts">
  // The C4 instrument panel: board minimap, who-has-control, the one sacred ARM button
  // (spacebar), the judge row (arrow keys), the answer always visible to the host, undo,
  // score-override drawer, roster health, pause - plus the C5 wizards (Double Down, Final)
  // and manual mode (host-award, resolved UX question 1).
  //
  // THE TWO SETUPS, one choice (C1/C1b, per-DEVICE - `screenSetup`, never a room setting):
  //
  //   second-screen  the projector is another output. The console OPENS the game screen as its
  //                  own window (game-screen-panel.svelte), tracks whether it is still there, and
  //                  keeps the private layer: answers, wager cells, the judge row.
  //   mirror         the laptop screen IS the projector, so the console reshapes into the display
  //                  layout with a slim dock the room may see - and the private layer does not
  //                  render AT ALL. Keyboard shortcuts keep working; the dock is for visibility,
  //                  not the only input.
  import { onDestroy } from "svelte";
  import ClueMedia from "#lib/room/clue-media.svelte";
  import DisplayScreen from "#lib/room/display-screen.svelte";
  import GameScreenPanel from "#lib/room/game-screen-panel.svelte";
  import HostRosterPanel from "#lib/room/host-roster-panel.svelte";
  import AppBar from "#lib/chrome/app-bar.svelte";
  import DockSection from "#lib/room/dock-section.svelte";
  import JoinPanel from "#lib/room/join-panel.svelte";
  import RulesPanel from "#lib/host-settings/rules-panel.svelte";
  import ScoresStrip from "#lib/room/scores-strip.svelte";
  import SettingsPanel from "#lib/host-settings/settings-panel.svelte";
  import SimPanel from "#lib/room/sim-panel.svelte";
  import { cellKey } from "@jeopardy/engine/state";
  import { devicePreferences } from "#lib/host-settings/device-preferences.svelte.ts";
  import { typeScaleStyle } from "#lib/host-settings/device-preferences.ts";
  import { GameScreenWindow } from "#lib/room/game-screen.svelte.ts";
  import { startReadiness } from "#lib/room/game-screen.ts";
  import { entityDisplayName, standingsFor } from "#lib/room/room-view.ts";
  import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";
  import type { ShareTarget } from "#lib/room/join-share.ts";

  type Props = {
    store: RoomStore;
    /** Dev flag from the route: renders the sim panel when the store is the local sim. */
    showSimPanel?: boolean;
    /** Force mirror mode for this render (the route's ?mirror) whatever the device prefers. */
    mirror?: boolean;
    /** Start with the settings panel open - the route's ?settings, and what tests render. */
    settingsOpen?: boolean;
    /**
     * Start with the roster rail open. Defaults to "open in the lobby", because before the game
     * starts the roster IS the console's job (user-flows C2: live roster, team assignments,
     * rename and kick - the counts the deleted pre-flight checklist used to restate).
     */
    rosterOpen?: boolean;
    /** Start with the join panel open; null = open in the lobby, where doors-open lives. */
    joinOpen?: boolean | null;
    /** Start with the two endings showing. Closed in a real session; what the tests render. */
    endOpen?: boolean;
    /** Origin for the join link + QR; this window's own at runtime. */
    joinOrigin?: string | null;
    /** Theme id carried onto the game-screen window so the projector matches this console. */
    themeId?: string | null;
    /** Injected in tests: the window this console opens, and the share sheet it reaches for. */
    gameScreen?: GameScreenWindow | null;
    shareTarget?: ShareTarget | null;
  };
  let {
    store,
    showSimPanel = false,
    mirror = false,
    settingsOpen = false,
    rosterOpen,
    joinOpen = null,
    endOpen = false,
    joinOrigin = null,
    themeId = null,
    gameScreen = null,
    shareTarget = null,
  }: Props = $props();

  const view = $derived(store.view);
  const game = $derived(view.game);
  const clue = $derived(game?.clue ?? null);
  const standings = $derived(standingsFor(view));

  // Mirror, manual mode, the two type scales and the rest are DEVICE preferences
  // (src/lib/host-settings/) rather than component state: they belong to this laptop, they
  // survive a reload mid-game, and the display window of the same browser reads the same
  // document. What IS component state is where the host is looking, and since 2026-08-20 that
  // is one object - `dock` below - rather than three panel booleans.
  const device = $derived(devicePreferences.current);
  // MIRROR IS ONE HALF OF `screenSetup`, and the device preference is the truth: `mirror` (the
  // route's ?mirror) only SEEDS it for this render. It used to be OR-ed with the preference,
  // which meant a console entered through ?mirror could never leave - "Exit mirror" set the
  // preference the OR then ignored. The seed is nulled the moment anything toggles, so the
  // header chip, the cog and the dock are all the same switch (owner, 2026-08-17).
  // svelte-ignore state_referenced_locally - the INITIAL value only.
  let mirrorSeed = $state(mirror ? true : null);
  const mirrorMode = $derived(mirrorSeed ?? device.screenSetup === "mirror");
  const manualMode = $derived(device.manualMode);

  function setMirror(next: boolean): void {
    mirrorSeed = null;
    devicePreferences.update({ screenSetup: next ? "mirror" : "second-screen" });
  }
  let scoreDrawerOpen = $state(false);
  let hostWagerEntry = $state<number | null>(null);

  // THE GAME SCREEN this console opened, and whether it is still there (src/lib/room/game-screen
  // .svelte.ts). Owned by the console rather than by the panel that draws it, because the header
  // readout, the lobby panel and the start guard are all asking the same window one question.
  // svelte-ignore state_referenced_locally - the injected window is a construction-time choice.
  const gameScreenWindow = gameScreen ?? new GameScreenWindow();
  // Release the poll when this console goes away - and ONLY the poll: the projector window
  // deliberately outlives its opener (src/lib/room/game-screen.svelte.ts). An injected one
  // belongs to the caller, so it is left alone entirely.
  // svelte-ignore state_referenced_locally - construction-time again, same prop.
  const ownsGameScreenWindow = gameScreen === null;
  if (ownsGameScreenWindow) {
    onDestroy(() => {
      gameScreenWindow.destroy();
    });
  }
  // STARTING. Two different failures, one readout (src/lib/room/game-screen.ts): an empty room is
  // refused by the engine, and a room whose projector shows a desktop starts perfectly well and
  // nobody sees it. The second is warned once and never blocked - a small room run off one laptop
  // is a legitimate setup.
  const readiness = $derived(
    startReadiness({
      seatedPlayers: view.roster.players.length,
      mirrored: mirrorMode,
      gameScreen: gameScreenWindow.state,
      connectedDisplays: view.connections?.display ?? null,
    }),
  );
  let startWarned = $state(false);

  /**
   * WHICH DOCK SECTIONS ARE OPEN. One object rather than five booleans so the console has one
   * place that answers "what is the host looking at", and so the lobby-vs-running defaults are
   * a single readable statement instead of five scattered initialisers.
   *
   * The defaults are the console's job at each moment: in the LOBBY the room is arriving, so
   * the roster and the way in are open and the rules are one caret away. Once a game is
   * running the board is the job, so everything is shut and the dock is a column of headers
   * carrying their own facts - a host can read "26/30" without opening anything.
   *
   * Nothing here closes anything else. Sections scroll independently (dock-section.svelte), so
   * five open at once is five reachable things rather than a column that has to take turns.
   */
  type DockKey = "roster" | "join" | "screen" | "rules" | "settings";
  // svelte-ignore state_referenced_locally - the INITIAL arrangement only.
  let dock = $state<Record<DockKey, boolean>>({
    roster: rosterOpen ?? store.view.phase === "lobby",
    join: joinOpen ?? store.view.phase === "lobby",
    screen: store.view.phase === "lobby",
    rules: false,
    settings: settingsOpen,
  });
  function setDock(key: DockKey, open: boolean): void {
    dock = { ...dock, [key]: open };
  }

  /**
   * ENDING, which is two different things, and the console said neither until 2026-08-20
   * (owner: "there is no end game button for the host").
   *
   *   End the game   - the GAME stops and the scores go up. The room stays open, everybody
   *                    stays connected, and the display shows final standings. This is what a
   *                    host who has run out of time wants, and it did not exist: the only way
   *                    to game-over was to play the board out.
   *   Close the room - the ROOM stops. Polite screen everywhere, lobby row delisted, code
   *                    spent. It existed only as an API call and a button on /dev/rooms.
   *
   * They are deliberately in ONE control that names both, rather than two chips a tired host
   * picks between at speed, because the wrong one is unrecoverable in opposite directions:
   * closing mid-game loses the scores, and ending the game when everyone has gone home just
   * leaves a room running. Each needs a second press, and the second press says what it does.
   */
  // svelte-ignore state_referenced_locally - the prop is the INITIAL value only.
  let endingOpen = $state(endOpen);
  let endingConfirm = $state<"game" | "room" | null>(null);

  function askToEnd(which: "game" | "room"): void {
    endingConfirm = endingConfirm === which ? null : which;
  }

  function confirmEnding(): void {
    if (endingConfirm === "game") store.endGame();
    if (endingConfirm === "room") store.closeRoom();
    endingConfirm = null;
    endingOpen = false;
  }

  function attemptStart(): void {
    if (readiness.kind === "blocked") return;
    if (readiness.kind === "warn" && !startWarned) {
      startWarned = true;
      return;
    }
    store.startGame();
  }

  // The per-surface type scale, and the whole reason it is per-surface: in mirror mode this
  // laptop IS the projector, so it wears the DISPLAY scale; otherwise it is the host's own
  // screen at arm's length and wears the console's (owner, 2026-08-16).
  const surfaceScale = $derived(
    typeScaleStyle(mirrorMode ? device.displayTypeScale : device.consoleTypeScale),
  );

  const clueContent = $derived(
    clue === null || view.content === null
      ? null
      : view.content.clueAt(clue.roundIndex, clue.category, clue.row),
  );
  const controlName = $derived.by(() => {
    const controlEntity = game?.controlEntity ?? null;
    return controlEntity === null ? null : entityDisplayName(view, controlEntity);
  });
  const answeringName = $derived.by(() => {
    const winner = clue?.buzzWinner ?? game?.tiebreaker?.buzzWinner ?? null;
    return winner === null ? null : entityDisplayName(view, winner.entityId);
  });
  const connectedCount = $derived(view.roster.players.filter((entry) => entry.connected).length);
  // Who is out of THIS clue after a wrong answer (#16). The rebound is the moment the host most
  // needs it and the console never showed it before the 2026-08-16 walk.
  const lockedOutNames = $derived(
    (clue?.lockedOutEntities ?? []).map((entityId) => entityDisplayName(view, entityId)),
  );
  const phase = $derived(game?.phase ?? "lobby");
  // The ENGINE's phase, not the room's: a room is "active" from start-game until it closes,
  // which includes the stretch after game-over when the standings are on the screen. Ending
  // the game is only meaningful in between.
  const gameIsRunning = $derived(phase !== "lobby" && phase !== "game-over");
  // The game screen's state in three words, so a closed section still answers the question a
  // host asks it most: is anything on the projector?
  const gameScreenBadge = $derived.by(() => {
    if (mirrorMode) return "mirrored";
    if (gameScreenWindow.state === "open") return "open";
    if ((view.connections?.display ?? 0) > 0) return "connected";
    return "none";
  });
  const canArm = $derived(phase === "reading" || phase === "tiebreaker-reading");
  const canJudge = $derived(
    phase === "answering" || phase === "wager-answering" || phase === "tiebreaker-answering",
  );

  const simStore = $derived(
    showSimPanel && store instanceof LocalSimRoomStore ? store : null,
  );

  // Keyboard-first (C4): spacebar arms, arrows judge, U undoes - active in BOTH layouts.
  function onKeydown(event: KeyboardEvent): void {
    // Never while the host is typing or picking. A SELECT was the gap: the settings panel put
    // dropdowns on this screen for the first time, and space on a focused select opens it in
    // every browser - which would have armed the buzzers instead. Same for a contenteditable
    // and for any modifier chord, which belongs to the browser, not to us.
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case " ":
        event.preventDefault();
        store.armBuzzers();
        break;
      case "ArrowRight":
        if (canJudge) store.judge("correct");
        break;
      case "ArrowLeft":
        if (canJudge) store.judge("wrong");
        break;
      case "n":
      case "N":
        if (canJudge) store.judge("no-penalty");
        break;
      case "u":
      case "U":
        store.undo();
        break;
      case "t":
      case "T":
        store.closeBuzzWindow();
        break;
    }
  }

  // THE COUNTDOWN. Game-anatomy section 8 step 4: the answer window starts automatically the
  // moment a buzz is won, and until now the console said nothing about it - the host was
  // judging against a clock only the engine could see. The kinds are named in the host's own
  // words rather than the engine's, and the whole readout is behind a device preference,
  // because some hosts want the pressure visible and some find it the opposite of helpful.
  let nowMs = $state(Date.now());
  $effect(() => {
    if (view.pendingTimers.length === 0) return;
    const handle = setInterval(() => {
      nowMs = Date.now();
    }, 200);
    return () => {
      clearInterval(handle);
    };
  });
  const activeTimer = $derived(view.pendingTimers.at(-1) ?? null);
  const timerSecondsLeft = $derived(
    activeTimer === null ? null : Math.max(0, (activeTimer.firesAt - nowMs) / 1000),
  );
  const timerLabel = $derived.by(() => {
    switch (activeTimer?.kind) {
      case "auto-arm":
        return "Auto-arm in";
      case "selection-shot-clock":
        return "Pick within";
      case "buzz-window":
        return "Buzz window";
      case "answer-window":
        return "Answering";
      case "everyone-answers-window":
        return "Everyone answering";
      case "wager-entry":
        return "Wager due in";
      case "final-wager":
        return "Final wagers close in";
      case "final-writing":
        return "Final answers close in";
      case "round-time-limit":
        return "Round ends in";
      default:
        return null;
    }
  });

  function commitHostWager(): void {
    if (hostWagerEntry === null || Number.isNaN(hostWagerEntry)) return;
    store.hostCommitWager(view.wagerRange?.entityId ?? "", Math.round(hostWagerEntry));
    hostWagerEntry = null;
  }

  // Final-reveal order (C5, #33): batched first in any order, then strictly by revealIndex.
  const finalJudgeQueue = $derived.by(() => {
    const final = game?.final ?? null;
    if (final === null) return [];
    const batchedOpen = final.batchedEntities.filter(
      (entityId) => final.judged[entityId] === undefined,
    );
    const nextIndividual = final.individualOrder[final.revealIndex];
    return final.eligible.map((entityId) => ({
      entityId,
      name: entityDisplayName(view, entityId),
      wager: final.wagers[entityId] ?? 0,
      answer: final.answers[entityId]?.text ?? null,
      judged: final.judged[entityId] ?? null,
      judgeable:
        final.judged[entityId] === undefined &&
        (batchedOpen.includes(entityId) ||
          (batchedOpen.length === 0 && entityId === nextIndividual)),
    }));
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if mirrorMode}
  <!-- C1b: display-first layout. The room sees this - the private layer is GONE (answers
       live in the host companion view or the print pack), and the slim dock is acceptable
       on a projector. -->
  <div class="mirror-layout" style={surfaceScale}>
    <!-- environment="none": mirror mode is a HOST device driving the projector's layout, and
         a second WebGL context on the machine running the console buys nothing. The real
         display route at /room/CODE/display is where the diorama lives. -->
    <DisplayScreen {store} environment="none" />
    <div class="mirror-dock">
      <button type="button" class="dock-button arm" disabled={!canArm} onclick={() => store.armBuzzers()}>
        Arm
      </button>
      <button type="button" class="dock-button" disabled={!canJudge} onclick={() => store.judge("correct")}>
        Correct
      </button>
      <button type="button" class="dock-button" disabled={!canJudge} onclick={() => store.judge("wrong")}>
        Wrong
      </button>
      <button type="button" class="dock-button" onclick={() => store.closeBuzzWindow()}>
        No takers
      </button>
      <button type="button" class="dock-button" onclick={() => store.undo()}>Undo</button>
      <button
        type="button"
        class="dock-button subtle"
        onclick={() => {
          setMirror(false);
        }}
      >
        Exit mirror
      </button>
    </div>
  </div>
{:else}
  <div class="console-layout" style={surfaceScale} class:compact={device.rosterDensity === "compact"}>
    <!-- THE SAME BAR THE FRONT DOOR AND THE JOIN SCREEN WEAR (owner, 2026-08-20: "the header
         bar should be similar to use in the other pages"). The console had a header of its
         own shape with its own title, so a host moving between the front door, a phone's join
         screen and this one met three different kinds of top-of-page - and the console was
         the only surface with no way home at all.

         Everything this console needs beside the wordmark rides the bar's `trailing` snippet,
         which is how the shell stays free of any one surface's furniture
         (#lib/chrome/app-bar.svelte).

         The DISPLAY deliberately does NOT get this bar. It is projector output rather than a
         page anybody navigates: nobody is going to click "home" on a wall, the room is not
         reading a wordmark, and every pixel it took would come out of the board. -->
    <AppBar>
      {#snippet trailing()}
        <p class="console-line">
          Host console <strong class="room-code">{view.roomCode}</strong>
        </p>
      {/snippet}
    </AppBar>
    <header class="console-header">
      <div class="header-controls">
        {#if store.mode === "local-sim"}
          <!-- SAY WHAT THIS IS. A local simulation renders through the same route as a real
               room, so without this flag a host cannot tell the fixture's imaginary players
               from their own (owner, 2026-08-17: a console reported "26/30" for an empty
               room). Honest labelling is the half of that fix that lives on the surface; the
               other half is the routes no longer seeding a fixture roster into a real code
               (src/lib/room/create-room-store.ts). -->
          <span class="sim-flag" title="Not a live room: nothing here is real">
            Simulation
          </span>
        {/if}
        <span class="roster-health" title="connected / total players">
          {connectedCount}/{view.roster.players.length} connected
        </span>
        <!-- GONE 2026-08-20: the Roster, Join info and Settings chips. They were three toggles
             for three rails that opened one at a time on the right, and the owner's read of
             them was exactly right - "we treat roster, settings, and join info differently
             relating to if they glow or not. Really, these should be carrot menus." They are
             sections of the dock now (.console-dock below), which is always on screen, so a
             header toggle for each would be a second control for a thing that is already
             visible. What stays in this row is what CHANGES the room rather than what shows
             it: mirror, pause, undo, and the two endings.

             The game screen's state, in every phase: a projector can be unplugged at any point
             in the night, and this console is the only thing in the room that would notice.
             It stays because it is a readout, not a toggle. -->
        <GameScreenPanel
          {view}
          gameScreen={gameScreenWindow}
          preferences={devicePreferences}
          {themeId}
          variant="chip"
        />
        <!-- MIRROR MODE, one click, with its state on the button. It was a URL query
             (`?mirror`) and a checkbox two levels into the cog, which is not a control a host
             can reach when the projector turns out to be a mirrored screen (owner,
             2026-08-17). The cog keeps its copy as the other half of `screenSetup`. -->
        <button
          type="button"
          class="chip"
          class:active={mirrorMode}
          aria-pressed={mirrorMode}
          onclick={() => {
            setMirror(!mirrorMode);
          }}
        >
          Mirror {mirrorMode ? "on" : "off"}
        </button>
        {#if manualMode}
          <!-- Modes the host has switched on stay VISIBLE on the console even though they are
               set in the cog: a host must never wonder why the buzzers are dead. -->
          <span class="mode-flag">Manual mode</span>
        {/if}
        <button
          type="button"
          class="chip"
          class:active={view.paused}
          onclick={() => {
            store.setPaused(!view.paused);
          }}
        >
          {view.paused ? "Resume" : "Pause"}
        </button>
        <!-- Undo is ALWAYS available (C4: the escape hatch for every judging argument),
             not only while a clue is open - hence header placement. -->
        <button type="button" class="chip" onclick={() => store.undo()}>
          Undo <span class="key-hint">U</span>
        </button>

        <!-- Last in the row, and the only chip that is not a view toggle: everything to its
             left changes what the host is looking at, this one changes what the room IS. -->
        <button
          type="button"
          class="chip ending"
          class:active={endingOpen}
          aria-expanded={endingOpen}
          onclick={() => {
            endingOpen = !endingOpen;
            endingConfirm = null;
          }}
        >
          End
        </button>
      </div>
    </header>

    {#if endingOpen}
      <!-- A bar under the header rather than a dialog: the roster and the board stay on screen
           while the host decides, which is the persistent-layout law and also the thing that
           makes the decision answerable ("is anybody still connected?" is right there). -->
      <div class="ending-row" role="group" aria-label="End the game or close the room">
        <div class="ending-choice">
          <button
            type="button"
            class="chip"
            class:active={endingConfirm === "game"}
            disabled={!gameIsRunning}
            onclick={() => askToEnd("game")}
          >
            End the game
          </button>
          <p class="ending-note">
            {gameIsRunning
              ? "Scores as they stand go up on the screen. The room stays open and nobody is disconnected."
              : phase === "lobby"
                ? "Nothing to end yet - the game has not started."
                : "This game is already over. Its scores are on the screen."}
          </p>
        </div>
        <div class="ending-choice">
          <button
            type="button"
            class="chip danger"
            class:active={endingConfirm === "room"}
            onclick={() => askToEnd("room")}
          >
            Close the room
          </button>
          <p class="ending-note">
            Everyone gets the polite screen and the code stops working. Nothing is saved.
          </p>
        </div>
        {#if endingConfirm !== null}
          <!-- The second press, and it says what it does rather than "Confirm" - a host reading
               this at speed must not have to remember which button they pressed. -->
          <button type="button" class="primary" class:danger={endingConfirm === "room"} onclick={confirmEnding}>
            {endingConfirm === "game" ? "Yes, end the game now" : "Yes, close the room for everyone"}
          </button>
        {/if}
      </div>
    {/if}

    {#if view.phase === "lobby"}
      <!-- START IS AN ACTION, not the last line of a checklist (owner, 2026-08-19). It lives in
           the console's own chrome with its readiness attached: the refusal when there is nobody
           to seat, and the one-press warning when nothing is on the projector. -->
      <div class="start-row">
        <button
          type="button"
          class="primary"
          disabled={readiness.kind === "blocked"}
          onclick={attemptStart}>Start game</button
        >
        {#if readiness.kind === "blocked"}
          <p class="start-note" role="status">
            <strong>{readiness.headline}</strong>
            {readiness.detail}
          </p>
        {:else if readiness.kind === "warn" && startWarned}
          <p class="start-note warn" role="alert">
            <strong>{readiness.headline}</strong>
            {readiness.detail}
          </p>
          <button type="button" class="chip" onclick={() => store.startGame()}>Start anyway</button>
        {:else}
          <p class="start-note" role="status"></p>
        {/if}
      </div>
    {/if}

    <!-- The console proper and the settings rail, side by side. The rail SHRINKS the console
         rather than covering it, so nothing the host was reading disappears when they open it. -->
    <div class="console-body">
      <!-- THE DOCK (owner, 2026-08-20: "there is a lot of space on the left side of the screen
           we are not using. Consdier two columns?" and "Really, these should be carrot menus"
           and "if we have different sections for hosting, they should be separately
           scrollable").
           
           It replaces three rails that opened on the RIGHT, each with its own border, heading,
           Close button and scrollbar - three objects that looked like three different kinds of
           thing and took turns in one column. Now they are five identical sections in a column
           that is always there, each scrolling inside itself, each able to stay shut with its
           own fact on the header (dock-section.svelte argues both choices).
           
           Always present, never a toggle: a dock that appears and disappears reflows the board
           every time a host looks something up, which is the reflow the persistent-layout law
           exists to prevent. What changes is which sections are OPEN. -->
      <aside class="console-dock" aria-label="Hosting">
        <DockSection
          title="Roster"
          open={dock.roster}
          onToggle={(open) => setDock("roster", open)}
          badge="{connectedCount}/{view.roster.players.length}"
          tone={view.roster.players.length === 0 ? "attention" : "plain"}
        >
          <HostRosterPanel {store} embedded onClose={() => setDock("roster", false)} />
        </DockSection>

        <DockSection
          title="How people join"
          open={dock.join}
          onToggle={(open) => setDock("join", open)}
          badge={view.settings.hideJoinCode ? "hidden on screen" : view.roomCode}
        >
          <JoinPanel {store} {joinOrigin} {shareTarget} embedded />
        </DockSection>

        <DockSection
          title="Game screen"
          open={dock.screen}
          onToggle={(open) => setDock("screen", open)}
          badge={gameScreenBadge}
          tone={gameScreenWindow.state === "open" || mirrorMode ? "plain" : "attention"}
        >
          <GameScreenPanel
            {view}
            gameScreen={gameScreenWindow}
            preferences={devicePreferences}
            {themeId}
            variant="panel"
          />
        </DockSection>

        <DockSection title="Rules" open={dock.rules} onToggle={(open) => setDock("rules", open)}>
          <RulesPanel {store} embedded />
        </DockSection>

        <DockSection
          title="Room and this device"
          open={dock.settings}
          onToggle={(open) => setDock("settings", open)}
        >
          <SettingsPanel
            {store}
            preferences={devicePreferences}
            embedded
            onClose={() => setDock("settings", false)}
          />
        </DockSection>
      </aside>

      <div class="console-main">
        {#if view.phase === "lobby"}
          <!-- The lobby's own column is deliberately EMPTY of panels since 2026-08-20. Both
               questions it used to answer - how the room sees this game, and who is in it - are
               dock sections now, open by default in the lobby, and a second copy of the
               game-screen panel here would be two controls for one window.

               Which also closed the owner's report that you could "not open the second screen
               when you haven't started the game with it": the panel used to render ONLY in this
               branch, so once a game was running the header kept a readout and there was no way
               left to open a display. The dock carries it in every phase. -->
        {:else}
          <div class="console-grid">
            <section class="panel minimap-panel">
              <h2>
                Board
                {#if controlName !== null}
                  <span class="control-line"><strong>{controlName}</strong> picks</span>
                {/if}
              </h2>
              {#if game !== null && view.content !== null}
                {@const board = game.boards[game.roundIndex]}
                {@const titles = view.content.categoryTitles[game.roundIndex] ?? []}
                <div
                  class="minimap"
                  style="--minimap-columns: {titles.length}"
                  role="grid"
                  aria-label="Board minimap"
                >
                  {#each titles as title, categoryIndex (categoryIndex)}
                    <div class="minimap-category" title={title}>{title}</div>
                  {/each}
                  {#each { length: board?.status[0]?.length ?? 0 } as _, rowIndex (rowIndex)}
                    {#each titles as _title, categoryIndex (categoryIndex)}
                      {@const used = board?.status[categoryIndex]?.[rowIndex] === "played"}
                      {@const isWager =
                        board?.wagerCells.includes(cellKey(categoryIndex, rowIndex)) ?? false}
                      {@const value =
                        view.content.cellValues[game.roundIndex]?.[categoryIndex]?.[rowIndex] ?? 0}
                      <!-- A played cell is a REOPEN button while the board is open (C4's
                           always-available list, and section 8 step 8). The store has always
                           had reopenCell; until the 2026-08-16 host-loop walk nothing on any
                           surface called it, so a mis-scored clue could be undone only by
                           unwinding every action after it. -->
                      <button
                        type="button"
                        class="minimap-cell"
                        class:used
                        disabled={phase !== "awaiting-selection"}
                        title={used ? "Reopen this clue" : undefined}
                        onclick={() => {
                          if (used) store.reopenCell(categoryIndex, rowIndex);
                          else store.selectCell(categoryIndex, rowIndex);
                        }}
                      >
                        {used ? "" : value}
                        {#if isWager && !used}
                          <!-- Wager positions are host-only (the store redacts them for other
                               roles); the dot is why the console never renders in mirror mode. -->
                          <span class="wager-dot" title="hidden wager cell"></span>
                        {/if}
                      </button>
                    {/each}
                  {/each}
                </div>
                {#if phase === "awaiting-selection"}
                  <button type="button" class="chip" onclick={() => store.endRound()}>End round</button>
                {/if}
              {/if}
            </section>

            <section class="panel clue-panel">
              {#if clue !== null && clueContent !== null}
                <h2>
                  {clueContent.categoryTitle} ·
                  {clue.isWagerClue ? (clue.wager === null ? "wagering..." : `$${clue.wager}`) : `$${clue.value}`}
                </h2>
                <!-- The host sees the same media the room does, small: they are judging against
                     it, and "what is on the projector right now" must never be a question. No
                     autoplay here - the display owns room audio, and a console playing the clip
                     a second time out of a laptop speaker is the failure mode. -->
                {#if clueContent.media !== null}
                  <ClueMedia media={clueContent.media} />
                {/if}
                <p class="clue-prompt">{clueContent.prompt}</p>
                <p class="host-answer">
                  Answer: <strong>{clueContent.response ?? "(hidden for this role)"}</strong>
                </p>
                <!-- An answer can carry its own media (the reveal photo, the recording). Host
                     only, exactly like the answer text - it never reaches a display or a phone. -->
                {#if clueContent.responseMedia !== null}
                  <ClueMedia media={clueContent.responseMedia} />
                {/if}

                {#if phase === "wagering"}
                  <div class="wizard">
                    <p class="wizard-line">
                      <strong>{entityDisplayName(view, clue.selectedBy ?? "")}</strong> wagers
                      {#if view.wagerRange !== null}
                        ({view.wagerRange.minimum} - {view.wagerRange.maximum})
                      {/if}
                      - waiting on their phone, or type it here:
                    </p>
                    <form
                      class="host-wager-row"
                      onsubmit={(event) => {
                        event.preventDefault();
                        commitHostWager();
                      }}
                    >
                      <input
                        type="number"
                        aria-label="Wager on the player's behalf"
                        bind:value={hostWagerEntry}
                      />
                      <button type="submit" class="chip">Commit wager</button>
                    </form>
                  </div>
                {/if}

                {#if manualMode && (phase === "reading" || phase === "armed")}
                  <div class="manual-award">
                    <p class="wizard-line">Award to...</p>
                    <div class="award-grid">
                      {#each standings as row (row.entityId)}
                        <div class="award-row">
                          <span class="award-name">{row.name}</span>
                          <button
                            type="button"
                            class="chip"
                            onclick={() => store.hostAward(row.entityId, "correct")}>Correct</button
                          >
                          <button
                            type="button"
                            class="chip"
                            onclick={() => store.hostAward(row.entityId, "wrong")}>Wrong</button
                          >
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                <div class="action-row">
                  <button type="button" class="arm-button" disabled={!canArm} onclick={() => store.armBuzzers()}>
                    ARM <span class="key-hint">space</span>
                  </button>
                  {#if answeringName !== null}
                    <p class="answering-line" role="status"><strong>{answeringName}</strong> answers</p>
                  {/if}
                  {#if device.showTimers && timerSecondsLeft !== null && timerLabel !== null}
                    <p class="timer-line" class:urgent={timerSecondsLeft <= 2}>
                      {timerLabel}
                      <strong>{timerSecondsLeft.toFixed(1)}s</strong>
                    </p>
                  {/if}
                </div>
                <div class="judge-row">
                  <button type="button" class="judge wrong" disabled={!canJudge} onclick={() => store.judge("wrong")}>
                    Wrong <span class="key-hint">&larr;</span>
                  </button>
                  <button
                    type="button"
                    class="judge no-penalty"
                    disabled={!canJudge}
                    onclick={() => store.judge("no-penalty")}
                  >
                    No penalty <span class="key-hint">N</span>
                  </button>
                  <button
                    type="button"
                    class="judge correct"
                    disabled={!canJudge}
                    onclick={() => store.judge("correct")}
                  >
                    Correct <span class="key-hint">&rarr;</span>
                  </button>
                </div>
                {#if lockedOutNames.length > 0}
                  <!-- Found missing by the 2026-08-16 host-loop walk: a wrong answer locks that
                       entity out and re-arms for the rest (game-anatomy section 8 step 5), and
                       the console said nothing - so a host judging a rebound could not tell who
                       was still in it, which is the one fact the rebound is about. -->
                  <p class="lockout-line">
                    Locked out of this clue: <strong>{lockedOutNames.join(", ")}</strong>
                  </p>
                {/if}
                {#if phase === "all-answering" || phase === "all-judging"}
                  <!-- EVERYONE-ANSWERS (matrix #22). The store has had closeAnswers() and
                       judgeEntity() since the seam was written and the console had no way to
                       call either, so a room in this mode reached all-judging and stopped
                       dead. It is off by default, which is why nothing had noticed. -->
                  <div class="everyone-answers">
                    <p class="wizard-line">
                      Answers in: {Object.keys(clue.submissions).length} / {standings.length}
                    </p>
                    {#if phase === "all-answering"}
                      <button type="button" class="chip" onclick={() => store.closeAnswers()}>
                        Close answers now
                      </button>
                    {:else}
                      <ul class="reveal-list">
                        {#each standings as row (row.entityId)}
                          {@const submission = clue.submissions[row.entityId]}
                          {@const verdict = clue.entityVerdicts[row.entityId]}
                          <li class="reveal-row" class:judgeable={verdict === undefined}>
                            <span class="award-name">{row.name}</span>
                            <span class="reveal-answer">{submission?.text ?? "(no answer)"}</span>
                            {#if verdict !== undefined}
                              <span class="verdict">{verdict}</span>
                            {:else}
                              <button
                                type="button"
                                class="chip"
                                onclick={() => store.judgeEntity(row.entityId, "correct")}
                                >Correct</button
                              >
                              <button
                                type="button"
                                class="chip"
                                onclick={() => store.judgeEntity(row.entityId, "wrong")}
                                >Wrong</button
                              >
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/if}
                <div class="escape-row">
                  <button type="button" class="chip" onclick={() => store.closeBuzzWindow()}>
                    No takers <span class="key-hint">T</span>
                  </button>
                  <button type="button" class="chip" onclick={() => store.cancelClue()}>Skip clue</button>
                  <button type="button" class="chip" onclick={() => store.undo()}>
                    Undo <span class="key-hint">U</span>
                  </button>
                </div>
              {:else if phase === "round-break"}
                <h2>Round break</h2>
                <p class="wizard-line">
                  Next: <strong>{game?.breakNextStage ?? "?"}</strong>
                </p>
                <button type="button" class="primary" onclick={() => store.proceed()}>Proceed</button>
              {:else if phase === "final-wagers" || phase === "final-writing" || phase === "final-reveal"}
                <!-- The C5 Final wizard: linear, cannot be done wrong. -->
                <h2>Final: {view.content?.final?.categoryTitle ?? ""}</h2>
                {#if view.content?.final}
                  {#if view.content.final.media !== null}
                    <ClueMedia media={view.content.final.media} />
                  {/if}
                  <p class="clue-prompt">{view.content.final.prompt}</p>
                  <p class="host-answer">
                    Answer: <strong>{view.content.final.response ?? "(hidden for this role)"}</strong>
                  </p>
                  {#if view.content.final.responseMedia !== null}
                    <ClueMedia media={view.content.final.responseMedia} />
                  {/if}
                {/if}
                {#if phase === "final-wagers"}
                  <p class="wizard-line">
                    Wagers in: {Object.keys(game?.final?.wagers ?? {}).length} /
                    {game?.final?.eligible.length ?? 0} - missing wagers become 0 at the deadline.
                  </p>
                  <button type="button" class="chip" onclick={() => store.expireTimer("final-wager")}>
                    Close wagers now
                  </button>
                {:else if phase === "final-writing"}
                  <p class="wizard-line">
                    Answers in: {Object.keys(game?.final?.answers ?? {}).length} /
                    {game?.final?.eligible.length ?? 0}
                  </p>
                  <button type="button" class="chip" onclick={() => store.expireTimer("final-writing")}>
                    Close answers now
                  </button>
                {:else}
                  <ul class="reveal-list">
                    {#each finalJudgeQueue as entry (entry.entityId)}
                      <li class="reveal-row" class:judgeable={entry.judgeable}>
                        <span class="award-name">{entry.name}</span>
                        <span class="reveal-answer">{entry.answer ?? "(no answer)"}</span>
                        <span class="reveal-wager">${entry.wager}</span>
                        {#if entry.judged !== null}
                          <span class="verdict">{entry.judged}</span>
                        {:else if entry.judgeable}
                          <button
                            type="button"
                            class="chip"
                            onclick={() => store.judgeEntity(entry.entityId, "correct")}>Correct</button
                          >
                          <button
                            type="button"
                            class="chip"
                            onclick={() => store.judgeEntity(entry.entityId, "wrong")}>Wrong</button
                          >
                        {:else}
                          <span class="verdict pending">waiting</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              {:else if game?.tiebreaker != null}
                <!-- SUDDEN DEATH (matrix #37). Found unrunnable by the 2026-08-16 host-loop
                     walk: a tiebreaker carries no CLUE, and every control on this panel - the
                     ARM button included - lived inside the clue branch, so the console showed
                     "Board up, pick any cell" while the engine sat in tiebreaker-reading.
                     The keyboard still worked, which is the only reason it was survivable. -->
                <h2>Sudden death</h2>
                <p class="wizard-line">
                  Tied for first:
                  <strong>
                    {game.tiebreaker.participants
                      .map((entityId) => entityDisplayName(view, entityId))
                      .join(" · ")}
                  </strong>
                </p>
                <p class="wizard-line">Read the tiebreaker clue aloud, then arm. No score moves.</p>
                {#if game.tiebreaker.eliminated.length > 0}
                  <p class="lockout-line">
                    Out of this clue:
                    <strong>
                      {game.tiebreaker.eliminated
                        .map((entityId) => entityDisplayName(view, entityId))
                        .join(", ")}
                    </strong>
                  </p>
                {/if}
                <div class="action-row">
                  <button
                    type="button"
                    class="arm-button"
                    disabled={!canArm}
                    onclick={() => store.armBuzzers()}
                  >
                    ARM <span class="key-hint">space</span>
                  </button>
                  {#if answeringName !== null}
                    <p class="answering-line" role="status">
                      <strong>{answeringName}</strong> answers
                    </p>
                  {/if}
                </div>
                <div class="judge-row">
                  <button
                    type="button"
                    class="judge wrong"
                    disabled={!canJudge}
                    onclick={() => store.judge("wrong")}
                  >
                    Wrong <span class="key-hint">&larr;</span>
                  </button>
                  <button
                    type="button"
                    class="judge correct"
                    disabled={!canJudge}
                    onclick={() => store.judge("correct")}
                  >
                    Correct <span class="key-hint">&rarr;</span>
                  </button>
                </div>
                <div class="escape-row">
                  <button type="button" class="chip" onclick={() => store.tiebreakerNextClue()}>
                    Next tiebreaker clue
                  </button>
                  <button type="button" class="chip" onclick={() => store.closeBuzzWindow()}>
                    No takers <span class="key-hint">T</span>
                  </button>
                </div>
              {:else if phase === "game-over"}
                <h2>Game over</h2>
                <ScoresStrip rows={standings} />
              {:else}
                <h2>Board up</h2>
                <p class="wizard-line">
                  {controlName === null
                    ? "Pick any cell on the minimap."
                    : `${controlName} calls the next cell - tap it on the minimap.`}
                </p>
              {/if}
            </section>

            <section class="panel side-panel">
              <h2>
                Scores
                <button
                  type="button"
                  class="chip"
                  aria-expanded={scoreDrawerOpen}
                  onclick={() => {
                    scoreDrawerOpen = !scoreDrawerOpen;
                  }}
                >
                  Override
                </button>
              </h2>
              <ScoresStrip rows={standings} highlightEntityId={clue?.buzzWinner?.entityId ?? null} />
              {#if scoreDrawerOpen}
                <div class="score-drawer">
                  {#each standings as row (row.entityId)}
                    <div class="drawer-row">
                      <span class="award-name">{row.name}</span>
                      <button type="button" class="chip" onclick={() => store.scoreAdjust(row.entityId, -100)}>
                        -100
                      </button>
                      <button type="button" class="chip" onclick={() => store.scoreAdjust(row.entityId, 100)}>
                        +100
                      </button>
                      <input
                        type="number"
                        aria-label="Set score for {row.name}"
                        value={row.score}
                        onchange={(event) => {
                          const next = Number.parseInt(event.currentTarget.value, 10);
                          if (!Number.isNaN(next)) store.scoreSet(row.entityId, next);
                        }}
                      />
                    </div>
                  {/each}
                </div>
              {/if}

            </section>
          </div>
        {/if}

        {#if simStore !== null}
          <!-- Rendered in every phase (spawning and disconnect drills matter in the lobby too);
               dev-flag-gated by the route, never reachable by players. -->
          <SimPanel {simStore} />
        {/if}
      </div>

    </div>
  </div>
{/if}

<style>
  /* THE CONSOLE'S OWN TYPE SCALE. Every font-size below this line is in em, so the host's
     "console text size" preference is one multiplier here and the whole surface follows -
     without touching the display's scale, which is a different number for a different
     distance (src/lib/host-settings/device-preferences.ts). */
  .console-layout {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-height: 100dvh;
    /* No inline padding at the top level: the bar is the page's own top edge and has to reach
       both sides of the window, exactly as it does on the front door and the join screen. The
       inset moves onto the children below. */
    padding: 0 0 2rem;
    font-size: calc(1rem * var(--type-scale, 1));
    background: var(--surface-page);
    color: var(--surface-text);
  }

  /* The console and its rail side by side: opening the cog or the join panel narrows the
     console rather than covering it, so a clue being judged stays readable throughout. */
  .console-body {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  /* THE DOCK: a column that is always there, on the LEFT, holding every hosting section
     (owner, 2026-08-20). It replaced three rails on the right that opened one at a time and
     each carried its own frame; what makes this readable instead of a wall is that the
     sections are collapsed by default once a game is running and each carries its own fact
     on its header (dock-section.svelte).

     A fixed column rather than a fraction: the board beside it must not resize every time a
     roster row makes a section wider, and 17rem is the width at which "26/30 connected" and a
     team name fit on one line. */
  .console-dock {
    flex: none;
    /* WIDER, and NOT A BOX (owner, 2026-08-20: "everything is in on box on the left side
       scrunched to the left side. we need to make it bigger, and don't put it into a box").
       At 17rem in a bordered, filled panel the sections were a column of squeezed rows inside
       a frame - the boxes-in-boxes problem moved up a level rather than solved, since the dock
       had become the outer box its own contents were crammed into.

       So the frame is gone entirely. What separates the dock from the board is the RULE down
       its inner edge and the space beside it - the same way the board's own gutter separates
       cells - and the width is a range rather than a number, so a wide window gives the roster
       room to breathe instead of banking the surplus into empty board. */
    width: clamp(20rem, 26vw, 30rem);
    align-self: stretch;
    display: flex;
    flex-direction: column;
    padding-inline-end: 1rem;
    border-inline-end: 1px solid var(--control-border);
    color: var(--control-text);
    font-family: var(--control-font);
  }

  /* Start lives in the console's own chrome with its state beside it. The note slot is reserved
     so an arriving warning changes words rather than positions. */
  .start-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  /* THE TWO ENDINGS, side by side with their consequences written out. They sit in one bar
     because the mistake to prevent is picking the wrong one, and the only thing that prevents
     it is reading them together (the script block above says why). Each choice is a column -
     the button and the sentence that belongs to it - so no sentence can be read against the
     wrong button. */
  .ending-row {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 1rem 1.6rem;
    padding: 0.7rem 0;
    border-block: 1px solid var(--surface-border);
  }

  .ending-choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
    flex: 1 1 18rem;
    min-width: 0;
  }

  .ending-note {
    margin: 0;
    max-inline-size: 44ch;
    font-size: 0.85em;
    line-height: 1.45;
    text-wrap: pretty;
    color: var(--surface-text-muted);
  }

  /* Closing the room is the destructive half, and it is the one that reads as ordinary from a
     distance ("close" is what you do to a panel), so it carries the negative colour in both
     states rather than only while armed. */
  .chip.danger {
    border-color: var(--score-negative);
    color: var(--score-negative);
  }

  .chip.danger.active {
    background: var(--score-negative);
    color: var(--surface-page);
  }

  .primary.danger {
    background: var(--score-negative);
  }

  .chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .start-note {
    margin: 0;
    min-height: 1.2em;
    font-size: 0.85em;
    color: var(--surface-text-muted);
  }

  .start-note.warn {
    color: var(--score-negative);
  }

  /* The board's column takes what the dock leaves. `min-width: 0` because a flex child
     defaults to min-content, and the minimap's own grid would otherwise refuse to shrink and
     push the dock off screen. */
  .console-main {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    flex: 1;
    min-width: 0;
  }

  /* On a narrow window the two columns stack and the dock goes FIRST, because at that width
     the thing being narrowed is the board - and a host on a small screen is usually there to
     look something up rather than to run a board they cannot see. Its sections cap their own
     height, so a stacked dock is a short header list rather than a page of panels above the
     game (dock-section.svelte). */
  @media (max-width: 64rem) {
    .console-body {
      flex-direction: column;
      align-items: stretch;
    }

    .console-dock {
      width: auto;
    }
  }

  /* Roster density: the same rows, packed for a room with twenty teams instead of four. */
  .console-layout.compact .drawer-row,
  .console-layout.compact .award-row,
  .console-layout.compact .reveal-row {
    gap: 0.25rem;
    padding-block: 0.1rem;
    font-size: 0.88em;
  }

  .console-layout.compact .award-grid {
    gap: 0.1rem;
  }

  /* A mode the host switched on in the cog, stated on the console itself - the buzzers being
     deliberately dead must never look like the buzzers being broken. */
  .mode-flag {
    font-family: var(--font-chrome);
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }

  /* Fixed colors: "this is not your room" has to read the same under every theme, and it is
     the kind of warning a theme must never be able to tone down. Its own class rather than a
     mode-flag variant, because it is not a mode the host switched on - it is what this console
     is connected to. */
  .sim-flag {
    font-family: var(--control-font);
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
    color: var(--control-accent-text);
    background: var(--control-accent);
    border: 1px solid var(--control-accent);
  }

  /* What is left of the console's own header once the bar above it carries the identity: the
     actions, and nothing else. */
  .console-header,
  .console-body,
  .start-row,
  .ending-row {
    margin-inline: 1rem;
  }

  .console-header {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  /* The console's identity, in the shared bar rather than in a header of its own shape.
     Pushed to the far end beside the wordmark, exactly as the join screen's room line is. */
  .console-line {
    margin-left: auto;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.8rem;
    color: var(--surface-text-muted);
  }

  /* Read aloud by the host to whoever is holding a phone, so it takes the legibility face the
     display and the join panel take (tokens.css --font-legible). */
  .room-code {
    color: var(--board-value-color);
    font-family: var(--font-legible);
    letter-spacing: 0.12em;
    margin-left: 0.4rem;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .roster-health {
    font-size: 0.8em;
    color: var(--surface-text-muted);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    padding: 0.8rem 0.9rem;
  }

  .panel h2 {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.95em;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .console-grid {
    display: grid;
    grid-template-columns: minmax(16rem, 1.1fr) minmax(20rem, 1.6fr) minmax(15rem, 1fr);
    gap: 0.8rem;
    align-items: start;
  }

  @media (max-width: 64rem) {
    .console-grid {
      grid-template-columns: 1fr;
    }
  }

  .control-line {
    font-size: 0.75em;
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent);
  }

  .minimap {
    display: grid;
    grid-template-columns: repeat(var(--minimap-columns), minmax(0, 1fr));
    gap: 3px;
  }

  .minimap-category {
    font-size: 0.6em;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--surface-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-bottom: 0.15rem;
  }

  .minimap-cell {
    position: relative;
    aspect-ratio: 5 / 3;
    border: none;
    border-radius: 2px;
    background: var(--board-cell-bg);
    color: var(--board-value-color);
    font-family: var(--font-values);
    font-size: 0.8em;
    cursor: pointer;
    min-width: 0;
  }

  .minimap-cell.used {
    background: var(--board-cell-used-bg);
    opacity: var(--board-cell-used-opacity);
    cursor: default;
  }

  .minimap-cell:disabled:not(.used) {
    cursor: default;
    opacity: 0.75;
  }

  .wager-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }

  .clue-prompt {
    font-family: var(--font-clue);
    font-size: 1.05em;
    margin: 0;
  }

  .host-answer {
    margin: 0;
    font-size: 0.95em;
    color: var(--board-value-color);
  }

  .wizard-line {
    margin: 0;
    font-size: 0.9em;
  }

  .host-wager-row {
    display: flex;
    gap: 0.5rem;
  }

  input[type="number"] {
    font: inherit;
    width: 7rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-page);
    color: var(--surface-text);
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .arm-button {
    font-family: var(--font-display);
    font-size: 1.5em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.7rem 2.2rem;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    cursor: pointer;
  }

  .arm-button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .answering-line {
    margin: 0;
    font-size: 1em;
    color: var(--accent);
  }

  .timer-line {
    margin: 0;
    margin-left: auto;
    font-family: var(--font-chrome);
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--surface-text-muted);
  }

  .timer-line strong {
    font-family: var(--font-values);
    color: var(--surface-text);
  }

  /* The last two seconds are the ones a host actually reacts to. */
  .timer-line.urgent strong {
    color: var(--score-negative);
  }

  .judge-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
  }

  .judge {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.65rem 0.5rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
    background: var(--surface-page);
    color: var(--surface-text);
    cursor: pointer;
  }

  .judge.correct:not(:disabled) {
    border-color: var(--score-positive);
    color: var(--score-positive);
  }

  .judge.wrong:not(:disabled) {
    border-color: var(--score-negative);
    color: var(--score-negative);
  }

  .judge:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .escape-row,
  .award-row,
  .drawer-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .award-grid {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-height: 16rem;
    overflow-y: auto;
  }

  .award-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9em;
  }

  .chip {
    font-family: var(--font-chrome);
    font-size: 0.78em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.3rem 0.65rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
    background: var(--surface-page);
    color: var(--surface-text);
    cursor: pointer;
  }

  .chip.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .primary {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 1.05em;
    padding: 0.7rem 1.2rem;
    border: none;
    border-radius: var(--board-radius);
    background: var(--accent);
    color: var(--surface-page);
    cursor: pointer;
    align-self: flex-start;
  }

  .key-hint {
    font-size: 0.65em;
    opacity: 0.65;
    margin-left: 0.25em;
  }

  .score-drawer {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-top: 1px solid var(--surface-border);
    padding-top: 0.5rem;
  }

  .reveal-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .reveal-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.3rem 0.4rem;
    border-radius: var(--board-radius);
  }

  .reveal-row.judgeable {
    outline: 1px solid var(--accent);
  }

  .reveal-answer {
    flex: 2;
    min-width: 0;
    font-style: italic;
  }

  .reveal-wager {
    font-family: var(--font-values);
  }

  .verdict {
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .verdict.pending {
    color: var(--surface-text-muted);
  }

  .lockout-line {
    margin: 0;
    font-size: 0.85em;
    color: var(--score-negative);
  }

  .everyone-answers {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* --- Mirror mode: display-first, slim dock. --- */
  .mirror-layout {
    position: fixed;
    inset: 0;
    display: grid;
  }

  .mirror-dock {
    position: fixed;
    bottom: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 35;
    display: flex;
    gap: 0.4rem;
    padding: 0.35rem;
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface-page) 82%, transparent);
    border: 1px solid var(--surface-border);
    backdrop-filter: blur(6px);
  }

  .dock-button {
    font-family: var(--font-chrome);
    font-size: 0.78em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.4rem 0.8rem;
    border-radius: 7px;
    border: 1px solid var(--surface-border);
    background: transparent;
    color: var(--surface-text);
    cursor: pointer;
  }

  .dock-button.arm {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--surface-page);
  }

  .dock-button:disabled {
    opacity: 0.4;
  }

  .dock-button.subtle {
    opacity: 0.7;
  }

  .arm-button:focus-visible,
  .judge:focus-visible,
  .chip:focus-visible,
  .primary:focus-visible,
  .dock-button:focus-visible,
  .minimap-cell:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
