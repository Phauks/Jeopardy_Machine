<script lang="ts">
  // The big-screen display surface: title/lobby screen (QR + room code), category-reveal
  // sequence at round start, the board, the clue card, scores strip, round interstitials,
  // and the winner screen. Pure renderer over a RoomStore view - a display crash never
  // touches the game (C1); reopening the route restores everything from the store.
  // Never shows answers, wagers in progress, or wager-cell positions: its store role is
  // "display", so that data does not even reach this component (C1b's rule, data-level).
  import { fade, scale } from "svelte/transition";
  import { prefersReducedMotion } from "svelte/motion";
  import { renderSVG } from "uqr";
  import BoardDisplay from "#lib/board/board-display.svelte";
  import ScoresStrip from "#lib/room/scores-strip.svelte";
  import { cellKey } from "@jeopardy/engine/state";
  import { entityDisplayName, standingsFor } from "#lib/room/room-view.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";
  import type { BoardData } from "#lib/board/sample-board.ts";

  type Props = {
    store: RoomStore;
    /** Origin for the join URL under the QR; defaults to the current origin at runtime. */
    joinOrigin?: string | null;
  };
  let { store, joinOrigin = null }: Props = $props();

  const view = $derived(store.view);
  const game = $derived(view.game);
  const standings = $derived(standingsFor(view));
  const transitionDuration = $derived(prefersReducedMotion.current ? 0 : 250);

  const joinUrl = $derived(
    `${joinOrigin ?? (typeof location === "undefined" ? "" : location.origin)}/room/${view.roomCode}`,
  );
  const qrSvg = $derived(renderSVG(joinUrl, { border: 2 }));

  // Category-reveal sequence (the show's round-open beat): when the round index changes,
  // stagger the category names in before the grid appears. Display-local presentation state,
  // deliberately not room state - each display runs its own reveal.
  let revealedRound = $state(-1);
  let revealStep = $state(0);
  const categoryTitles = $derived(view.content?.categoryTitles[game?.roundIndex ?? 0] ?? []);
  const inCategoryReveal = $derived(
    game !== null && game.phase === "awaiting-selection" && revealedRound !== game.roundIndex,
  );
  $effect(() => {
    if (!inCategoryReveal || game === null) return;
    if (prefersReducedMotion.current) {
      revealedRound = game.roundIndex;
      return;
    }
    revealStep = 0;
    const roundIndex = game.roundIndex;
    const interval = setInterval(() => {
      revealStep += 1;
      if (revealStep > categoryTitles.length) {
        clearInterval(interval);
        revealedRound = roundIndex;
      }
    }, 700);
    return () => {
      clearInterval(interval);
    };
  });

  const boardData: BoardData | null = $derived.by(() => {
    if (game === null || view.content === null) return null;
    const content = view.content;
    const titles = content.categoryTitles[game.roundIndex] ?? [];
    return {
      currency: "$",
      categories: titles.map((title, categoryIndex) => ({
        title,
        // Values from the content view (engine boards carry only status); clue/response stay
        // empty - the display's own overlay renders prompts, and answers never reach it.
        clues: (content.cellValues[game.roundIndex]?.[categoryIndex] ?? []).map((value) => ({
          value,
          clue: "",
          response: "",
        })),
      })),
    };
  });

  const usedKeys = $derived.by(() => {
    const keys = new Set<string>();
    game?.boards[game.roundIndex]?.status.forEach((column, categoryIndex) => {
      column.forEach((status, rowIndex) => {
        if (status === "played") keys.add(cellKey(categoryIndex, rowIndex));
      });
    });
    return keys;
  });

  const clueContent = $derived(
    game === null || game.clue === null || view.content === null
      ? null
      : view.content.clueAt(game.clue.roundIndex, game.clue.category, game.clue.row),
  );

  const cluePhases = ["reading", "armed", "answering", "wager-answering", "all-answering"];
  const showClueCard = $derived(game !== null && cluePhases.includes(game.phase));
  const buzzWinnerName = $derived.by(() => {
    const winner = game?.clue?.buzzWinner ?? null;
    return winner === null ? null : entityDisplayName(view, winner.entityId);
  });
  const buzzWinnerMemberName = $derived.by(() => {
    // Teams mode double confirmation: team name big, the buzzing MEMBER small underneath
    // (identification without audio clutter - owner directive).
    const winner = game?.clue?.buzzWinner ?? null;
    if (winner === null || !view.teamsMode) return null;
    if (winner.playerId === winner.entityId) return null;
    const member = view.roster.players.find((player) => player.playerId === winner.playerId);
    return member?.nickname ?? null;
  });

  const winners = $derived(
    (game?.winners ?? []).map((entityId) => entityDisplayName(view, entityId)),
  );
</script>

<div class="display-screen">
  {#if view.paused}
    <div class="pause-veil" role="status" transition:fade={{ duration: transitionDuration }}>
      <p>One moment...</p>
    </div>
  {/if}

  {#if game === null || view.phase === "lobby"}
    <!-- Title / lobby screen: themed title card + giant QR + code (C2 doors-open). -->
    <section class="title-screen">
      <h1 class="game-title">Jeopardy Machine</h1>
      <div class="join-block">
        <div class="qr-holder" aria-label="Join QR code">
          <!-- Trusted @html: generated by uqr from our own join URL, never user input. -->
          {@html qrSvg}
        </div>
        <div class="join-text">
          <p class="join-url">{joinUrl.replace(/^https?:\/\//, "")}</p>
          <p class="room-code-line">
            room code <strong class="room-code">{view.roomCode}</strong>
          </p>
          <p class="joined-count">
            {view.roster.players.length}
            {view.roster.players.length === 1 ? "player" : "players"} in
          </p>
        </div>
      </div>
    </section>
  {:else if inCategoryReveal}
    <section class="category-reveal">
      {#each categoryTitles as title, index (title)}
        {#if index < revealStep}
          <div
            class="reveal-card"
            in:scale={{ duration: transitionDuration, start: 0.8 }}
          >
            {title}
          </div>
        {:else}
          <div class="reveal-card pending"></div>
        {/if}
      {/each}
    </section>
  {:else if game.phase === "round-break"}
    <section class="interstitial">
      <h2 class="interstitial-title">
        {game.breakNextStage === "final"
          ? "The Final"
          : game.breakNextStage === "game-over"
            ? "Final scores"
            : "Round " + String(game.roundIndex + 2)}
      </h2>
      <ScoresStrip rows={standings} />
    </section>
  {:else if game.phase === "final-wagers" || game.phase === "final-writing" || game.phase === "final-reveal"}
    <section class="interstitial">
      <p class="final-kicker">Final round</p>
      <h2 class="interstitial-title">{view.content?.final?.categoryTitle ?? ""}</h2>
      {#if game.phase === "final-writing" && view.content?.final}
        <p class="final-clue">{view.content.final.prompt}</p>
      {/if}
      {#if game.phase === "final-wagers"}
        <p class="final-progress">
          Wagers in: {Object.keys(game.final?.wagers ?? {}).length} /
          {game.final?.eligible.length ?? 0}
        </p>
      {/if}
      {#if game.phase === "final-reveal"}
        <ScoresStrip rows={standings} />
      {/if}
    </section>
  {:else if game.phase === "game-over"}
    <section class="winner-screen">
      <p class="final-kicker">
        {winners.length === 0 ? "No winner this time" : winners.length > 1 ? "Winners" : "Winner"}
      </p>
      {#if winners.length > 0}
        <h2 class="winner-names">{winners.join(" · ")}</h2>
      {/if}
      <ScoresStrip rows={standings} />
      <p class="thanks-line">Thanks for playing</p>
    </section>
  {:else if boardData !== null}
    <section class="board-holder">
      <BoardDisplay board={boardData} {usedKeys} onCellSelect={() => undefined} />
      {#if showClueCard && clueContent !== null && game.clue !== null}
        <div class="clue-layer" transition:fade={{ duration: transitionDuration }}>
          <div class="clue-card" transition:scale={{ duration: transitionDuration, start: 0.85 }}>
            <p class="clue-kicker">
              {clueContent.categoryTitle}
              {#if game.clue.isWagerClue}
                · {view.wagerRange?.label ?? "Double Down"}
              {:else}
                · ${game.clue.value}
              {/if}
            </p>
            <p class="clue-text">{clueContent.prompt}</p>
            {#if buzzWinnerName !== null}
              <p class="winner-line" role="status">
                <strong>{buzzWinnerName}</strong>
                {#if buzzWinnerMemberName !== null}
                  <span class="winner-member">{buzzWinnerMemberName}</span>
                {/if}
              </p>
            {/if}
          </div>
        </div>
      {/if}
      {#if game.phase === "wagering"}
        <div class="clue-layer" transition:fade={{ duration: transitionDuration }}>
          <div class="clue-card wager-splash">
            <p class="wager-splash-text">{view.wagerRange?.label ?? "Double Down"}!</p>
            <p class="clue-kicker">
              {game.clue === null ? "" : entityDisplayName(view, game.clue.selectedBy ?? "")} is
              wagering...
            </p>
          </div>
        </div>
      {/if}
      <footer class="display-scores">
        <ScoresStrip rows={standings} highlightEntityId={game.clue?.buzzWinner?.entityId ?? null} />
      </footer>
    </section>
  {/if}
</div>

<style>
  .display-screen {
    position: fixed;
    inset: 0;
    overflow: hidden;
    display: grid;
    background: var(--page-bg);
    color: var(--surface-text);
  }

  .pause-veil {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: var(--surface-scrim);
    font-family: var(--font-display);
    font-size: clamp(2rem, 6vh, 4rem);
    text-transform: uppercase;
  }

  .title-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(1rem, 4vh, 3rem);
    padding: 4vh 4vw;
  }

  .game-title {
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 10vh, 7rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    margin: 0;
    text-align: center;
  }

  .join-block {
    display: flex;
    align-items: center;
    gap: clamp(1rem, 4vw, 3rem);
    flex-wrap: wrap;
    justify-content: center;
  }

  .qr-holder {
    width: clamp(10rem, 30vh, 20rem);
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    background: white;
  }

  .qr-holder :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }

  .join-text {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    font-family: var(--font-chrome);
    text-transform: uppercase;
  }

  .join-url {
    font-size: clamp(1.1rem, 3.2vh, 2.2rem);
    letter-spacing: 0.05em;
    margin: 0;
  }

  .room-code-line {
    font-size: clamp(0.9rem, 2.4vh, 1.6rem);
    color: var(--surface-text-muted);
    margin: 0;
  }

  .room-code {
    font-family: var(--font-values);
    font-size: clamp(2rem, 8vh, 5rem);
    letter-spacing: 0.14em;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    display: block;
  }

  .joined-count {
    font-size: clamp(0.8rem, 2vh, 1.2rem);
    color: var(--surface-text-muted);
    margin: 0;
  }

  .category-reveal {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--board-gutter);
    padding: 6vh 4vw;
    align-content: center;
  }

  .reveal-card {
    display: grid;
    place-items: center;
    min-height: 22vh;
    border-radius: var(--board-radius);
    background: var(--effect-cell-overlay), var(--board-category-bg);
    box-shadow: var(--effect-cell-shadow);
    color: var(--clue-text-color);
    font-family: var(--font-chrome);
    font-size: clamp(1.1rem, 3.4vh, 2.4rem);
    font-weight: 600;
    text-transform: uppercase;
    text-align: center;
    padding: 1rem;
    text-shadow: var(--effect-category-text-shadow);
  }

  .reveal-card.pending {
    background: var(--board-cell-used-bg);
    box-shadow: none;
  }

  .interstitial,
  .winner-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2.5vh;
    padding: 6vh 5vw;
    text-align: center;
  }

  .interstitial-title,
  .winner-names {
    font-family: var(--font-display);
    font-size: clamp(2rem, 8vh, 5.5rem);
    text-transform: uppercase;
    margin: 0;
    color: var(--clue-text-color);
  }

  .final-kicker {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: clamp(1rem, 2.6vh, 1.6rem);
    color: var(--board-value-color);
    margin: 0;
  }

  .final-clue {
    font-family: var(--font-clue);
    font-size: var(--clue-text-size);
    text-transform: uppercase;
    max-width: 26ch;
    color: var(--clue-text-color);
    margin: 0;
  }

  .final-progress,
  .thanks-line {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--surface-text-muted);
    margin: 0;
  }

  .winner-names {
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
  }

  .board-holder {
    position: relative;
    display: grid;
    grid-template-rows: 1fr auto;
    padding: 1.5vh 1.5vw;
    gap: 1vh;
    min-height: 0;
  }

  .clue-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    background: var(--surface-scrim);
    padding: 4%;
  }

  .clue-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3vh;
    text-align: center;
    border-radius: var(--board-radius);
    background: var(--effect-cell-overlay), var(--board-cell-bg);
    box-shadow: var(--effect-clue-card-shadow);
    padding: 4% 6%;
  }

  .clue-kicker {
    color: var(--board-value-color);
    font-family: var(--font-chrome);
    font-size: calc(var(--clue-text-size) * 0.45);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0;
    text-shadow: var(--effect-category-text-shadow);
  }

  .clue-text {
    color: var(--clue-text-color);
    font-family: var(--font-clue);
    font-size: var(--clue-text-size);
    font-weight: 600;
    line-height: 1.35;
    text-transform: uppercase;
    max-width: 24ch;
    margin: 0;
    text-shadow: var(--effect-category-text-shadow);
  }

  .winner-line {
    font-family: var(--font-chrome);
    font-size: calc(var(--clue-text-size) * 0.55);
    text-transform: uppercase;
    color: var(--accent);
    margin: 0;
  }

  .winner-member {
    display: block;
    font-size: 0.5em;
    color: var(--surface-text-muted);
  }

  .wager-splash .wager-splash-text {
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 11vh, 7rem);
    text-transform: uppercase;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    margin: 0;
  }

  .display-scores {
    overflow-x: auto;
  }
</style>
