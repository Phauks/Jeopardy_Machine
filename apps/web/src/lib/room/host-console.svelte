<script lang="ts">
  // The C4 instrument panel: board minimap, who-has-control, the one sacred ARM button
  // (spacebar), the judge row (arrow keys), the answer always visible to the host, undo,
  // score-override drawer, roster health, pause - plus the C5 wizards (Double Down, Final)
  // and manual mode (host-award, resolved UX question 1).
  //
  // Mirror mode (C1b, per-DEVICE toggle): the laptop screen IS the projector, so the console
  // reshapes into the display layout with a slim dock the room may see - and the private
  // layer (answers, wager ranges) does not render AT ALL in mirror mode. Keyboard shortcuts
  // keep working; the dock is for visibility, not the only input.
  import DisplayScreen from "#lib/room/display-screen.svelte";
  import ScoresStrip from "#lib/room/scores-strip.svelte";
  import SettingsPanel from "#lib/host-settings/settings-panel.svelte";
  import SimPanel from "#lib/room/sim-panel.svelte";
  import { cellKey } from "@jeopardy/engine/state";
  import { devicePreferences } from "#lib/host-settings/device-preferences.svelte.ts";
  import { typeScaleStyle } from "#lib/host-settings/device-preferences.ts";
  import { entityDisplayName, standingsFor } from "#lib/room/room-view.ts";
  import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    /** Dev flag from the route: renders the sim panel when the store is the local sim. */
    showSimPanel?: boolean;
    /** Initial mirror state (a per-device toggle, never a room setting). */
    mirror?: boolean;
    /** Start with the settings panel open - the route's ?settings, and what tests render. */
    settingsOpen?: boolean;
  };
  let { store, showSimPanel = false, mirror = false, settingsOpen = false }: Props = $props();

  const view = $derived(store.view);
  const game = $derived(view.game);
  const clue = $derived(game?.clue ?? null);
  const standings = $derived(standingsFor(view));

  // THE COG'S STATE. Mirror, manual mode, the two type scales and the rest are DEVICE
  // preferences now (src/lib/host-settings/) rather than component state: they belong to this
  // laptop, they survive a reload mid-game, and the display window of the same browser reads
  // the same document. Whether the panel is open is the only thing that is genuinely
  // component state, because it is not a preference - it is where you are looking.
  // svelte-ignore state_referenced_locally - deliberately the INITIAL value only.
  let panelOpen = $state(settingsOpen);
  const device = $derived(devicePreferences.current);
  const mirrorMode = $derived(device.mirror || mirror);
  const manualMode = $derived(device.manualMode);
  let scoreDrawerOpen = $state(false);
  let hostWagerEntry = $state<number | null>(null);

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
  const phase = $derived(game?.phase ?? "lobby");
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
          devicePreferences.update({ mirror: false });
        }}
      >
        Exit mirror
      </button>
    </div>
  </div>
{:else}
  <div class="console-layout" style={surfaceScale} class:compact={device.rosterDensity === "compact"}>
    <header class="console-header">
      <h1>Host console <span class="room-code">{view.roomCode}</span></h1>
      <div class="header-controls">
        <span class="roster-health" title="connected / total players">
          {connectedCount}/{view.roster.players.length} connected
        </span>
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
        <!-- THE COG. Opens a rail beside the console, never a screen: the board, the clue and
             the judge row stay live while it is open (the persistent-layout law). -->
        <button
          type="button"
          class="chip cog"
          aria-expanded={panelOpen}
          aria-label="Settings"
          onclick={() => {
            panelOpen = !panelOpen;
          }}
        >
          Settings
        </button>
      </div>
    </header>

    <!-- The console proper and the settings rail, side by side. The rail SHRINKS the console
         rather than covering it, so nothing the host was reading disappears when they open it. -->
    <div class="console-body">
      <div class="console-main">
        {#if view.phase === "lobby"}
          <section class="panel preflight">
            <h2>Pre-flight</h2>
            <ul class="checklist">
              <li>{view.roster.players.length} players in ({connectedCount} connected)</li>
              <li>{view.roster.teams.length} teams</li>
              <li>Display: open <code>/room/{view.roomCode}/display</code> on the projector</li>
            </ul>
            <button type="button" class="primary" onclick={() => store.startGame()}>Start game</button>
          </section>
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
                      <button
                        type="button"
                        class="minimap-cell"
                        class:used
                        disabled={used || phase !== "awaiting-selection"}
                        onclick={() => {
                          store.selectCell(categoryIndex, rowIndex);
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
                <p class="clue-prompt">{clueContent.prompt}</p>
                <p class="host-answer">
                  Answer: <strong>{clueContent.response ?? "(hidden for this role)"}</strong>
                </p>

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
                  <p class="clue-prompt">{view.content.final.prompt}</p>
                  <p class="host-answer">
                    Answer: <strong>{view.content.final.response ?? "(hidden for this role)"}</strong>
                  </p>
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

      {#if panelOpen}
        <SettingsPanel
          {store}
          preferences={devicePreferences}
          onClose={() => {
            panelOpen = false;
          }}
        />
      {/if}
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
    padding: 0.8rem 1rem 2rem;
    font-size: calc(1rem * var(--type-scale, 1));
    background: var(--surface-page);
    color: var(--surface-text);
  }

  /* The console and the settings rail side by side: opening the cog narrows the console
     rather than covering it, so a clue being judged stays readable throughout. */
  .console-body {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .console-main {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 64rem) {
    .console-body {
      flex-direction: column;
      align-items: stretch;
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

  .console-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .console-header h1 {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 1.2em;
    margin: 0;
  }

  .room-code {
    color: var(--board-value-color);
    font-family: var(--font-values);
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

  .checklist {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.92em;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
