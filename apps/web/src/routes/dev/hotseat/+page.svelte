<script lang="ts">
  // /dev/hotseat - the M2 exit-criteria proof: a full game against @jeopardy/engine, played
  // locally with NO server. One keyboard drives every role (host arms and judges, number
  // keys buzz as any fake player), the engine is the only game logic, and every action goes
  // through the same transition() the M3 room will call. Dev-routes convention: /dev/* pages
  // are developer surfaces, never linked from product UI.
  import { createInitialState, cellKey } from "@jeopardy/engine/state";
  import { transition } from "@jeopardy/engine/transition";
  import BoardDisplay from "#lib/board/board-display.svelte";
  import ScoresStrip from "#lib/room/scores-strip.svelte";
  import { sampleBoard } from "#lib/board/sample-board.ts";
  import { clueTextAt, sampleFinalClue, sampleGameSetup } from "#lib/hotseat/sample-game.ts";
  import { themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import type { GameAction } from "@jeopardy/engine/actions";
  import type { GameEvent } from "@jeopardy/engine/events";
  import type { BoardData } from "#lib/board/sample-board.ts";
  import type { StandingRow } from "#lib/room/room-view.ts";

  const playerNames = ["Ada", "Ben", "Cleo", "Dot", "Eli", "Fay", "Gus", "Hana"] as const;

  let seed = $state("hotseat");
  let playerCount = $state(3);
  const setup = $derived(sampleGameSetup(seed));
  // $state.raw: the engine returns a fresh immutable state per transition - wholesale
  // reassignment is the reactivity model, never deep mutation.
  let engineState = $state.raw(createInitialState(sampleGameSetup("hotseat")));
  let eventLog = $state.raw<GameEvent[]>([]);
  let wagerInput = $state("");
  let finalWagerInputs = $state<Record<string, string>>({});
  let finalAnswerInputs = $state<Record<string, string>>({});

  function dispatch(action: GameAction): void {
    const result = transition(engineState, action, setup);
    engineState = result.state;
    eventLog = [...eventLog, ...result.events].slice(-14);
  }

  function resetGame(newSeed: string): void {
    seed = newSeed;
    engineState = createInitialState(sampleGameSetup(newSeed));
    eventLog = [];
    wagerInput = "";
    finalWagerInputs = {};
    finalAnswerInputs = {};
  }

  function startGame(): void {
    for (let index = 0; index < playerCount; index += 1) {
      dispatch({
        type: "player-join",
        at: Date.now(),
        playerId: `p${String(index + 1)}`,
        name: playerNames[index] ?? `Player ${String(index + 1)}`,
      });
    }
    dispatch({ type: "start-game", at: Date.now() });
  }

  const phase = $derived(engineState.phase);
  const clue = $derived(engineState.clue);
  const clueText = $derived(clue === null ? null : clueTextAt(clue.category, clue.row));

  const boardData: BoardData = $derived({
    currency: "$",
    categories: sampleBoard.categories.map((category, categoryIndex) => ({
      title: category.title,
      clues: category.clues.map((entry, rowIndex) => ({
        // Values come from the ENGINE setup (round multiplier applied), not the static board.
        value:
          setup.rounds[engineState.roundIndex]?.cells[categoryIndex]?.[rowIndex]?.value ??
          entry.value,
        clue: entry.clue,
        response: entry.response,
      })),
    })),
  });

  const usedKeys = $derived.by(() => {
    const keys = new Set<string>();
    const board = engineState.boards[engineState.roundIndex];
    board?.status.forEach((column, categoryIndex) => {
      column.forEach((status, rowIndex) => {
        if (status === "played") keys.add(cellKey(categoryIndex, rowIndex));
      });
    });
    return keys;
  });

  function nameOf(entityId: string): string {
    return engineState.players[entityId]?.name ?? entityId;
  }

  // The M4 shared score component replaces the page's own scorecards (same rows shape the
  // room surfaces use; no roster here, so accents stay neutral).
  const standingRows: StandingRow[] = $derived(
    engineState.entityOrder.map((entityId) => ({
      entityId,
      name: nameOf(entityId),
      score: engineState.scores[entityId] ?? 0,
      hasControl: engineState.controlEntity === entityId,
      colorId: null,
    })),
  );

  // One expiry key (E) resolves to whichever timer the current phase is waiting on - the
  // hotseat driver plays the role the DO's alarms play in production.
  function expiryAction(): GameAction | null {
    const at = Date.now();
    if (phase === "armed" || phase === "tiebreaker-armed") return { type: "buzz-timeout", at };
    if (phase === "answering" || phase === "wager-answering" || phase === "all-answering") {
      return { type: "answer-timeout", at };
    }
    if (phase === "wagering") return { type: "wager-timeout", at };
    if (phase === "final-wagers") return { type: "final-wager-timeout", at };
    if (phase === "final-writing") return { type: "final-writing-timeout", at };
    if (phase === "awaiting-selection") return { type: "selection-timeout", at };
    return null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) return; // typing a wager/answer
    const key = event.key;
    if (key >= "1" && key <= "8") {
      const playerId = `p${key}`;
      if (engineState.players[playerId] !== undefined) {
        dispatch({ type: "buzz", at: Date.now(), playerId });
      }
      return;
    }
    const at = Date.now();
    switch (key.toLowerCase()) {
      case "s":
        if (phase === "lobby") startGame();
        break;
      case "a":
      case " ":
        event.preventDefault();
        dispatch({ type: "arm-buzzers", at });
        break;
      case "c":
        dispatch({ type: "judge", at, verdict: "correct" });
        break;
      case "w":
        dispatch({ type: "judge", at, verdict: "wrong" });
        break;
      case "n":
        dispatch({ type: "judge", at, verdict: "no-penalty" });
        break;
      case "e": {
        const action = expiryAction();
        if (action !== null) dispatch(action);
        break;
      }
      case "u":
        dispatch({ type: "undo", at });
        break;
      case "p":
        dispatch({ type: "proceed", at });
        break;
      case "r":
        dispatch({ type: "end-round", at });
        break;
      case "x":
        dispatch({ type: "cancel-clue", at });
        break;
      case "t":
        dispatch({ type: "tiebreaker-next-clue", at });
        break;
    }
  }

  function commitWager(): void {
    const amount = Number.parseInt(wagerInput, 10);
    if (Number.isNaN(amount)) return;
    dispatch({ type: "commit-wager", at: Date.now(), amount });
    wagerInput = "";
  }

  function commitFinalWager(entityId: string): void {
    const amount = Number.parseInt(finalWagerInputs[entityId] ?? "", 10);
    if (Number.isNaN(amount)) return;
    dispatch({ type: "commit-final-wager", at: Date.now(), entityId, amount });
  }

  function submitFinalAnswer(entityId: string): void {
    const text = finalAnswerInputs[entityId] ?? "";
    if (text.length === 0) return;
    dispatch({ type: "submit-final-answer", at: Date.now(), entityId, text });
  }

  const retroTheme = themePresets.find((entry) => entry.id === "retro-tv") ?? themePresets[0];
  const themeStyle = retroTheme ? themeToStyleAttribute(retroTheme) : "";

  const revealQueue = $derived.by(() => {
    const final = engineState.final;
    if (final === null) return [];
    const batchedOpen = final.batchedEntities.filter(
      (entityId) => final.judged[entityId] === undefined,
    );
    const nextIndividual = final.individualOrder[final.revealIndex];
    return [...final.eligible].map((entityId) => ({
      entityId,
      judged: final.judged[entityId],
      judgeable:
        final.judged[entityId] === undefined &&
        (batchedOpen.includes(entityId) || (batchedOpen.length === 0 && entityId === nextIndividual)),
      wager: final.wagers[entityId],
      answer: final.answers[entityId]?.text ?? null,
    }));
  });

  const keyHelp =
    "S start · click cell to select · A/space arm · 1-8 buzz as player · C correct · W wrong · N no-penalty · E expire timer · U undo · P proceed · R end round · X cancel clue · T next tiebreak clue";
</script>

<svelte:head>
  <title>Dev: hotseat</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<main class="min-h-screen bg-surface-page text-surface-text" style={themeStyle} data-effects="flat">
  <div class="mx-auto flex max-w-6xl flex-col gap-4 p-4">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <h1 class="chrome-text text-xl">Hotseat</h1>
      <p class="text-xs text-surface-text-muted">
        Full game vs @jeopardy/engine, no server. Seed <code>{seed}</code> · phase
        <strong>{phase}</strong>
      </p>
    </header>

    <p class="text-xs text-surface-text-muted">{keyHelp}</p>

    {#if phase === "lobby"}
      <section class="panel">
        <h2 class="chrome-text">Lobby</h2>
        <p class="text-sm">
          {playerCount} fake players will join. Press S (or the button) to start.
        </p>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="chip"
            onclick={() => {
              playerCount = Math.max(2, playerCount - 1);
            }}>-</button
          >
          <span>{playerCount} players</span>
          <button
            type="button"
            class="chip"
            onclick={() => {
              playerCount = Math.min(8, playerCount + 1);
            }}>+</button
          >
          <button type="button" class="chip primary" onclick={startGame}>Start game (S)</button>
        </div>
      </section>
    {:else}
      <section class="flex flex-wrap items-center gap-2 text-sm">
        <ScoresStrip rows={standingRows} highlightEntityId={clue?.buzzWinner?.entityId ?? null} />
        {#if (clue?.lockedOutEntities.length ?? 0) > 0}
          <span class="text-xs text-surface-text-muted">
            locked out: {(clue?.lockedOutEntities ?? []).map(nameOf).join(", ")}
          </span>
        {/if}
        <button
          type="button"
          class="chip"
          onclick={() => {
            resetGame(`hotseat-${String(Date.now() % 100_000)}`);
          }}>Reset (new seed)</button
        >
      </section>
    {/if}

    {#if phase === "awaiting-selection" || phase === "reading" || phase === "armed" || phase === "answering" || phase === "wagering" || phase === "wager-answering" || phase === "all-answering" || phase === "all-judging"}
      <BoardDisplay
        board={boardData}
        {usedKeys}
        onCellSelect={(categoryIndex, clueIndex) => {
          dispatch({ type: "select-cell", at: Date.now(), category: categoryIndex, row: clueIndex });
        }}
      />
    {/if}

    {#if clue !== null && clueText !== null}
      <section class="panel">
        <h2 class="chrome-text">
          {clueText.categoryTitle} · ${clue.isWagerClue ? (clue.wager ?? "?") : clue.value}
          {#if clue.isWagerClue}<span class="badge">{setup.settings.wagers.label}</span>{/if}
        </h2>
        {#if phase === "wagering"}
          {@const selector = clue.selectedBy}
          <p class="text-sm">
            {selector === null ? "?" : nameOf(selector)} wagers (host types on their behalf):
          </p>
          <form
            class="flex gap-2"
            onsubmit={(event) => {
              event.preventDefault();
              commitWager();
            }}
          >
            <!-- svelte-ignore a11y_autofocus - dev tool: the wager box IS the next action -->
            <input class="field" type="number" bind:value={wagerInput} autofocus />
            <button type="submit" class="chip primary">Commit wager</button>
          </form>
        {:else}
          <p class="text-base">{clueText.clue}</p>
          <p class="text-xs text-surface-text-muted">
            Host card: <em>{clueText.response}</em>
          </p>
          <p class="text-sm">
            {#if phase === "reading"}Reading... arm with A (early buzzes get the lockout).
            {:else if phase === "armed"}ARMED - buzz with 1-{engineState.entityOrder.length}.
            {:else if phase === "answering"}
              {clue.buzzWinner === null ? "?" : nameOf(clue.buzzWinner.entityId)} is answering -
              judge with C / W / N.
            {:else if phase === "wager-answering"}
              {clue.selectedBy === null ? "?" : nameOf(clue.selectedBy)} answers alone - judge C /
              W.
            {:else if phase === "all-answering"}Everyone answers on their phones (not simulated
              here - close with E).
            {:else if phase === "all-judging"}Judge each submission (not wired on this page).
            {/if}
          </p>
        {/if}
      </section>
    {/if}

    {#if phase === "round-break"}
      <section class="panel">
        <h2 class="chrome-text">Round break</h2>
        <p class="text-sm">
          Next: <strong>{engineState.breakNextStage}</strong>. Press P to proceed.
        </p>
      </section>
    {/if}

    {#if phase === "final-wagers" || phase === "final-writing"}
      <section class="panel">
        <h2 class="chrome-text">Final: {sampleFinalClue.categoryTitle}</h2>
        {#if phase === "final-writing"}
          <p class="text-base">{sampleFinalClue.clue}</p>
          <p class="text-xs text-surface-text-muted">Host card: <em>{sampleFinalClue.response}</em></p>
        {/if}
        {#each engineState.final?.eligible ?? [] as entityId (entityId)}
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16">{nameOf(entityId)}</span>
            {#if phase === "final-wagers"}
              {#if engineState.final?.wagers[entityId] !== undefined}
                <span>wager locked</span>
              {:else}
                <input class="field" type="number" bind:value={finalWagerInputs[entityId]} />
                <button
                  type="button"
                  class="chip"
                  onclick={() => {
                    commitFinalWager(entityId);
                  }}>Commit</button
                >
              {/if}
            {:else if engineState.final?.answers[entityId] !== undefined}
              <span>answer in</span>
            {:else}
              <input class="field wide" type="text" bind:value={finalAnswerInputs[entityId]} />
              <button
                type="button"
                class="chip"
                onclick={() => {
                  submitFinalAnswer(entityId);
                }}>Submit</button
              >
            {/if}
          </div>
        {/each}
        <p class="text-xs text-surface-text-muted">E force-expires this phase's timer.</p>
      </section>
    {/if}

    {#if phase === "final-reveal"}
      <section class="panel">
        <h2 class="chrome-text">Final reveal (lowest pre-final score first)</h2>
        {#each revealQueue as entry (entry.entityId)}
          <div class="flex items-center gap-2 text-sm">
            <span class="w-16">{nameOf(entry.entityId)}</span>
            <span class="wide-text">{entry.answer ?? "(no answer)"} · wagered ${entry.wager ?? 0}</span>
            {#if entry.judged !== undefined}
              <span>{entry.judged}</span>
            {:else if entry.judgeable}
              <button
                type="button"
                class="chip"
                onclick={() => {
                  dispatch({
                    type: "judge-entity",
                    at: Date.now(),
                    entityId: entry.entityId,
                    verdict: "correct",
                  });
                }}>Correct</button
              >
              <button
                type="button"
                class="chip"
                onclick={() => {
                  dispatch({
                    type: "judge-entity",
                    at: Date.now(),
                    entityId: entry.entityId,
                    verdict: "wrong",
                  });
                }}>Wrong</button
              >
            {:else}
              <span class="text-surface-text-muted">waiting</span>
            {/if}
          </div>
        {/each}
      </section>
    {/if}

    {#if phase === "tiebreaker-reading" || phase === "tiebreaker-armed" || phase === "tiebreaker-answering"}
      <section class="panel">
        <h2 class="chrome-text">Sudden-death tiebreaker</h2>
        <p class="text-sm">
          Participants: {(engineState.tiebreaker?.participants ?? []).map(nameOf).join(", ")}
          {#if (engineState.tiebreaker?.eliminated.length ?? 0) > 0}
            · out this clue: {(engineState.tiebreaker?.eliminated ?? []).map(nameOf).join(", ")}
          {/if}
        </p>
        <p class="text-sm">
          {#if phase === "tiebreaker-reading"}Host reads a fresh clue aloud - arm with A (T deals
            another).
          {:else if phase === "tiebreaker-armed"}ARMED - first correct buzz wins the game.
          {:else}
            {engineState.tiebreaker?.buzzWinner === null ||
            engineState.tiebreaker?.buzzWinner === undefined
              ? "?"
              : nameOf(engineState.tiebreaker.buzzWinner.entityId)} answers - C wins, W eliminates.
          {/if}
        </p>
      </section>
    {/if}

    {#if phase === "game-over"}
      <section class="panel">
        <h2 class="chrome-text">Game over</h2>
        <p class="text-sm">
          {#if (engineState.winners ?? []).length === 0}
            No winner (all non-positive under the tv rule).
          {:else}
            Winner{(engineState.winners ?? []).length > 1 ? "s" : ""}: {(engineState.winners ?? [])
              .map(nameOf)
              .join(", ")}
          {/if}
        </p>
        <ol class="list-inside list-decimal text-sm">
          {#each [...engineState.entityOrder].toSorted((left, right) => (engineState.scores[right] ?? 0) - (engineState.scores[left] ?? 0)) as entityId (entityId)}
            <li>{nameOf(entityId)} - ${engineState.scores[entityId] ?? 0}</li>
          {/each}
        </ol>
        <button
          type="button"
          class="chip primary"
          onclick={() => {
            resetGame(seed);
          }}>Play again</button
        >
      </section>
    {/if}

    <section class="panel">
      <h2 class="chrome-text">Events</h2>
      <ul class="flex flex-col gap-1 text-xs text-surface-text-muted">
        {#each eventLog as event, index (index)}
          <li><code>{JSON.stringify(event)}</code></li>
        {/each}
      </ul>
    </section>
  </div>
</main>

<style>
  .chrome-text {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-raised);
    padding: 0.75rem 1rem;
  }

  .chip {
    font-family: var(--font-chrome);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.25rem 0.7rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
    background: var(--surface-raised);
    color: var(--surface-text);
    cursor: pointer;
  }

  .chip.primary {
    background: var(--accent);
    color: var(--surface-page);
    border-color: var(--accent);
  }

  .chip:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .badge {
    font-size: 0.7rem;
    border: 1px solid var(--accent);
    border-radius: var(--board-radius);
    padding: 0.1rem 0.4rem;
    margin-left: 0.5rem;
  }

  .field {
    width: 7rem;
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    background: var(--surface-page);
    color: var(--surface-text);
    padding: 0.25rem 0.5rem;
  }

  .field.wide {
    width: 18rem;
  }

  .wide-text {
    flex: 1;
    min-width: 0;
  }
</style>
