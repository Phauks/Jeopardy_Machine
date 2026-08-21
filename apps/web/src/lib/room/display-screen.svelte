<script lang="ts">
  // The big-screen display surface: title/lobby screen (QR + room code), category-reveal
  // sequence at round start, the board, the clue card, scores strip, round interstitials,
  // and the winner screen. Pure renderer over a RoomStore view - a display crash never
  // touches the game (C1); reopening the route restores everything from the store.
  // Never shows answers, wagers in progress, or wager-cell positions: its store role is
  // "display", so that data does not even reach this component (C1b's rule, data-level).
  import ClueMedia from "#lib/room/clue-media.svelte";
  import { teamsAreOffered } from "@jeopardy/protocol/settings/player-mode";
  import { fade, scale } from "svelte/transition";
  import { prefersReducedMotion } from "svelte/motion";
  import { renderSVG } from "uqr";
  import AvatarDiorama from "#lib/diorama/avatar-diorama.svelte";
  import BoardDisplay from "#lib/board/board-display.svelte";
  import ScoresStrip from "#lib/room/scores-strip.svelte";
  import StagedLobby from "#lib/staging/staged-lobby.svelte";
  import { cellKey } from "@jeopardy/engine/state";
  import { entityDisplayName, standingsFor } from "#lib/room/room-view.ts";
  import { stagingFromRoom } from "#lib/staging/room-staging.ts";
  import { stagingThemeById } from "#lib/staging/staging-theme-registry.ts";
  import type { DioramaEnvironment } from "#lib/diorama/diorama-environment.ts";
  import type { DioramaOccupant } from "#lib/diorama/diorama-scene.ts";
  import type { RoomStore } from "#lib/room/room-store.ts";
  import type { BoardData } from "#lib/board/sample-board.ts";

  type Props = {
    store: RoomStore;
    /** Origin for the join URL under the QR; defaults to the current origin at runtime. */
    joinOrigin?: string | null;
    /**
     * The 3D scene the avatars inhabit, ALREADY RESOLVED to what this build can draw - the
     * route reads the theme document's `environment` slot and passes it through
     * `resolveDioramaEnvironment` (src/lib/diorama/diorama-environment.ts). "none" is the
     * clean 2D lobby this surface has always had. Mirror mode passes "none": a host console
     * must not spin up a second renderer.
     */
    environment?: DioramaEnvironment;
    /**
     * Which staging theme the pre-game lobby uses (src/lib/staging/staging-theme-registry.ts).
     * The theme document's `staging` slot, with the route's ?staging= dev override on top.
     */
    stagingThemeId?: string | null;
    /**
     * Hold the stage still without touching the OS accessibility setting - the host's
     * "stage motion: still" device preference (src/lib/host-settings/). A laptop driving a
     * projector and a board at once is allowed to stop paying for a walking crowd mid-game.
     * "off" is the caller's job: it passes environment="none".
     */
    stageStill?: boolean;
  };
  let {
    store,
    joinOrigin = null,
    environment = "studio",
    stagingThemeId = null,
    stageStill = false,
  }: Props = $props();

  const view = $derived(store.view);
  const game = $derived(view.game);
  const standings = $derived(standingsFor(view));
  const transitionDuration = $derived(prefersReducedMotion.current ? 0 : 250);

  // STREAMER MODE (`settings.hideJoinCode`, docs/decisions/2026-08-14-room-controls-and-
  // staging.md). This screen is THE shared surface - it is pointed at a room, and increasingly
  // at a camera - so when the host turns streamer mode on, the code, the QR and the join URL
  // all stop being rendered here. Not hidden with CSS and not blurred: a template branch, so
  // the code is not in the markup at all and cannot be read off a screenshot, a scroll of the
  // DOM, or a stream someone paused. The room is unchanged - the code still exists and still
  // admits anyone who has it; this is about not broadcasting it.
  //
  // The URL goes with the code because it CONTAINS the code (/room/CODE). Reveal is
  // deliberately not offered here: a button on the streamed screen would defeat the setting.
  // It belongs on the host's own device, which is the console's room-settings panel - shipped
  // for real rooms as PATCH /api/rooms/<CODE> and the host-only `update-room-settings`
  // message, with the console UI itself the next step (docs/design/surfaces.md).
  const codeHidden = $derived(view.settings.hideJoinCode);
  const joinUrl = $derived(
    `${joinOrigin ?? (typeof location === "undefined" ? "" : location.origin)}/room/${view.roomCode}`,
  );
  const qrSvg = $derived(codeHidden ? "" : renderSVG(joinUrl, { border: 2 }));

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
    if (winner === null || !teamsAreOffered(view.playerMode)) return null;
    if (winner.playerId === winner.entityId) return null;
    const member = view.roster.players.find((player) => player.playerId === winner.playerId);
    return member?.nickname ?? null;
  });

  const winners = $derived(
    (game?.winners ?? []).map((entityId) => entityDisplayName(view, entityId)),
  );

  // --- The avatar diorama (docs/decisions/2026-08-14-avatars-in-motion.md, tier 3) ----------
  // Mounted on the screens that are ABOUT the people in the room - the lobby, the round and
  // final interstitials, the winner scene - and on no other. Never behind a live clue: the
  // clue screen has one job, and a projector rendering a crowd of skinned meshes behind the
  // text is a frame-budget bill nobody agreed to pay (guardrail 4). Because the mount is a
  // template branch rather than a hidden element, "not shown" also means "not rendering".
  const dioramaPhases = ["round-break", "final-wagers", "final-writing", "final-reveal", "game-over"];

  // THE STAGED LOBBY. Before the game the diorama is not scenery, it is the seating chart:
  // people waiting in the holding area, people aboard their team's station, and a team change
  // visible as a move (docs/decisions/2026-08-14-room-visibility-and-lobby.md's successor work;
  // the mechanism is src/lib/staging/). Once play starts the stage goes back to free wandering
  // behind the interstitials - by then everyone has chosen, and there is nothing to stage.
  //
  // Unlike the diorama, the staged view survives a display with no WebGL: it degrades to the
  // same layout in CSS rather than to nothing, because "which boat am I on" is information.
  const staged = $derived(view.phase === "lobby");

  // ...which is why `environment: "none"` does not remove it. "No 3D stage" - a host turning
  // stage motion off in the cog, or mirror mode declining a second renderer - means no SCENERY,
  // and it used to mean no seating chart either: the layer was gated on the environment before
  // the branch inside it got a say, so the projector lost the one thing the lobby is for. Only
  // the ambient diorama phases obey it now; staged-lobby.svelte renders its clean-2D layout
  // and mounts no canvas, so nothing spins up a renderer that was declined.
  const showDiorama = $derived(
    (game === null || view.phase === "lobby" || dioramaPhases.includes(game.phase)) &&
      (environment !== "none" || staged),
  );
  const stagingTheme = $derived(stagingThemeById(stagingThemeId));
  const roomStaging = $derived(stagingFromRoom(view));

  // One avatar per SCORING entity, so teams mode shows teams rather than a duplicate crowd -
  // the same entity vocabulary buzz and winner events speak. A team borrows its avatar from
  // its leader (the face the room already associates with it) and wears the team's color.
  const dioramaOccupants: DioramaOccupant[] = $derived.by(() => {
    const soloists = view.roster.players
      .filter((player) => player.teamId === null)
      .map((player) => ({
        entityId: player.playerId,
        avatarId: player.avatarId,
        accentId: player.accentId,
      }));
    // Individuals: every player is their own entity, and there are no teams to draw.
    if (!teamsAreOffered(view.playerMode)) return soloists;
    // Teams and MIXED share one rule - one avatar per scoring entity - and mixed is where the
    // two halves are both non-empty at once: the teams below, plus everyone who chose to play
    // for themselves. In teams mode the soloist list is empty by construction (the room seats
    // stragglers as teams of one at start-game), so this is not a branch, it is the general
    // case the old one was a special case of.
    return view.roster.teams
      .map((team) => {
        const leader = view.roster.players.find(
          (player) => player.playerId === team.leaderPlayerId,
        );
        return {
          entityId: team.teamId,
          avatarId: leader?.avatarId ?? null,
          accentId: team.colorId,
        };
      })
      .concat(soloists);
  });

  const celebratingEntityIds = $derived(game?.phase === "game-over" ? (game.winners ?? []) : []);

  // The visible beat. In the lobby it is the arrival itself: the newest player's avatar turns
  // to the room and celebrates as they walk on - the big-screen half of the identity moment.
  // Room events that arrive while the diorama is up (a buzz in a phase that shows it) come in
  // through the `beat` the display route passes down; during a live clue there is nothing
  // mounted to react, which is the guardrail working, not a gap.
  const newestPlayer = $derived.by(() => {
    let newest: { playerId: string; joinedAt: number } | null = null;
    for (const player of view.roster.players) {
      if (newest === null || player.joinedAt > newest.joinedAt) newest = player;
    }
    return newest;
  });
  const dioramaBeat = $derived(
    newestPlayer === null || view.phase !== "lobby"
      ? null
      : { entityId: newestPlayer.playerId, at: newestPlayer.joinedAt },
  );
</script>

<div class="display-screen" class:with-diorama={showDiorama}>
  {#if showDiorama}
    <!-- Behind the screen's own content, never over it: the QR, the scores, and the winner
         names stay the readable foreground. Sits outside the phase branches below so a
         lobby -> interstitial move does not tear the scene down and re-spawn the crowd. -->
    <div class="diorama-layer" class:staged>
      {#if staged}
        <StagedLobby
          theme={stagingTheme}
          stations={roomStaging.stations}
          occupants={roomStaging.occupants}
          waitingEntityIds={roomStaging.waitingEntityIds}
          {environment}
          {stageStill}
          beat={dioramaBeat}
        />
      {:else}
        <AvatarDiorama
          occupants={dioramaOccupants}
          {environment}
          {celebratingEntityIds}
          holdStill={stageStill}
          beat={dioramaBeat}
        />
      {/if}
    </div>
  {/if}

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
        {#if codeHidden}
          <!-- Streamer mode: a deliberate affordance, not a blank space. The room must still
               read as joinable to the people in it, and the sentence tells them where the code
               actually is (the host's screen) instead of leaving them to wonder. -->
          <div class="code-hidden">
            <p class="code-hidden-title">Join code hidden</p>
            <p class="code-hidden-line">Ask the host for the code</p>
          </div>
          <div class="join-text">
            <p class="joined-count">
              {view.roster.players.length}
              {view.roster.players.length === 1 ? "player" : "players"} in
            </p>
          </div>
        {:else}
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
        {/if}
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
        {#if view.content.final.media !== null}
          <ClueMedia media={view.content.final.media} variant="stage" autoplay />
        {/if}
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
            <!-- The picture, sound or video comes BEFORE the words on a projector: a picture
                 round's clue IS the image, and a room reads the prompt as its caption. Audio
                 autoplays here and only here - the display owns room audio, so this is the one
                 surface entitled to make noise (clue-media.svelte explains the rule). -->
            {#if clueContent.media !== null}
              <ClueMedia media={clueContent.media} variant="stage" autoplay />
            {/if}
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

  /* The diorama is the lower band of the screen - a stage the room's avatars walk along,
     under whatever the screen is saying. Pointer events off: it is scenery, and a projector
     display has nothing to click here anyway. */
  .diorama-layer {
    position: absolute;
    inset: auto 0 0 0;
    height: 46%;
    z-index: 0;
    pointer-events: none;
  }

  /* The staged lobby's 2D degradation is a block of cards, not a canvas, so the band lets it
     sit on the floor of the screen and scroll if a room has more teams than fit. With WebGL
     up, the scene fills the band exactly as before and none of this applies. */
  .diorama-layer.staged {
    display: flex;
    align-items: flex-end;
    padding: 0 2vw 1.5vh;
    overflow-y: auto;
  }

  /* Everything the screen actually says sits above the scenery. */
  .title-screen,
  .category-reveal,
  .interstitial,
  .winner-screen,
  .board-holder {
    position: relative;
    z-index: 1;
  }

  /* ...and lifts clear of it, so a wandering avatar never walks across the join QR or the
     winner's name. The screens are vertically centred, so bottom padding is what raises the
     content block above the stage band. */
  .display-screen.with-diorama .title-screen,
  .display-screen.with-diorama .interstitial,
  .display-screen.with-diorama .winner-screen {
    padding-bottom: 34vh;
  }

  .pause-veil {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    background: var(--surface-scrim);
    font-family: var(--font-display);
    font-size: calc(clamp(2rem, 6vh, 4rem) * var(--type-scale));
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
    font-size: calc(clamp(2.5rem, 10vh, 7rem) * var(--type-scale));
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

  /* The hidden state occupies the QR's footprint so the title screen keeps its composition -
     a room in streamer mode must not look like a room with a broken display. */
  .code-hidden {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    width: clamp(10rem, 30vh, 20rem);
    aspect-ratio: 1;
    border-radius: 8px;
    border: 2px dashed var(--surface-border);
    background: var(--surface-raised);
    padding: 1rem;
    text-align: center;
  }

  .code-hidden-title {
    font-family: var(--font-display);
    font-size: calc(clamp(1.1rem, 3.4vh, 2rem) * var(--type-scale));
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--board-value-color);
    margin: 0;
  }

  .code-hidden-line {
    font-family: var(--font-chrome);
    font-size: calc(clamp(0.8rem, 2vh, 1.1rem) * var(--type-scale));
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--surface-text-muted);
    margin: 0;
  }

  .join-text {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    font-family: var(--font-chrome);
    text-transform: uppercase;
  }

  .join-url {
    font-size: calc(clamp(1.1rem, 3.2vh, 2.2rem) * var(--type-scale));
    letter-spacing: 0.05em;
    margin: 0;
  }

  .room-code-line {
    font-size: calc(clamp(0.9rem, 2.4vh, 1.6rem) * var(--type-scale));
    color: var(--surface-text-muted);
    margin: 0;
  }

  /* The projector's copy of the code, and the one people are actually reading from across a
     room: the legibility face, never the theme's value face (tokens.css --font-legible). */
  .room-code {
    font-family: var(--font-legible);
    font-size: calc(clamp(2rem, 8vh, 5rem) * var(--type-scale));
    letter-spacing: 0.14em;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    display: block;
  }

  .joined-count {
    font-size: calc(clamp(0.8rem, 2vh, 1.2rem) * var(--type-scale));
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
    font-size: calc(clamp(1.1rem, 3.4vh, 2.4rem) * var(--type-scale));
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
    font-size: calc(clamp(2rem, 8vh, 5.5rem) * var(--type-scale));
    text-transform: uppercase;
    margin: 0;
    color: var(--clue-text-color);
  }

  .final-kicker {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: calc(clamp(1rem, 2.6vh, 1.6rem) * var(--type-scale));
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
    font-size: calc(clamp(2.5rem, 11vh, 7rem) * var(--type-scale));
    text-transform: uppercase;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    margin: 0;
  }

  .display-scores {
    overflow-x: auto;
  }

  /* ==========================================================================================
   * COMPACT - the display on a phone.
   *
   * This surface was written for one situation: a laptop driving a projector, one fixed pane,
   * nothing scrolls. That is still what it is FOR. But a host checking their own room from
   * their hand is an ordinary thing to do, and a projector layout on a phone is not merely
   * ugly - a fixed, inset-0, overflow-hidden pane simply hides everything past the first
   * viewport height, so the scores and the staged lobby become unreachable rather than small.
   *
   * The breakpoint catches both phone orientations (portrait by width, landscape by height)
   * and neither a laptop nor a projector. Three things change and nothing else:
   *   1. the pane becomes a scrolling page,
   *   2. the type scale gains a WIDTH term - the projector scale is clamped against viewport
   *      height alone, which is correct across a 720p projector and a 4K TV and wildly wrong
   *      on a tall narrow screen, where 8vh of numeral does not fit a 60px column,
   *   3. the stage joins the flow instead of floating over the lower half of it.
   * ======================================================================================== */
  @media (max-width: 48rem), (max-height: 26rem) {
    .display-screen {
      position: static;
      min-height: 100dvh;
      overflow: visible;
      align-content: start;
      grid-auto-rows: min-content;

      /* Layout constants from tokens.css, re-clamped for a narrow viewport. Overriding them
         on this subtree is the sanctioned move - they are app layout constants rather than
         theme document fields (docs/design/theming.md), and every consumer reads the token. */
      --board-category-size: calc(clamp(0.6rem, 2.6vw, 1.1rem) * var(--type-scale));
      --board-value-size: calc(clamp(1.1rem, 6vw, 2.4rem) * var(--type-scale));
      --clue-text-size: calc(clamp(1.05rem, 4.6vw, 2rem) * var(--type-scale));
    }

    /* The stage stops being an overlay band and becomes a block after the content, with a
       definite height (the canvas needs one) and its own scroll (the 2D staged view can be
       taller than the band when a room has many teams). */
    .diorama-layer {
      position: static;
      order: 2;
      height: 45vh;
      min-height: 15rem;
      pointer-events: auto;
      overflow-y: auto;
    }

    .title-screen,
    .category-reveal,
    .interstitial,
    .winner-screen,
    .board-holder {
      order: 1;
    }

    /* ...so nothing needs lifting clear of it any more. */
    .display-screen.with-diorama .title-screen,
    .display-screen.with-diorama .interstitial,
    .display-screen.with-diorama .winner-screen {
      padding-bottom: 6vh;
    }

    /* The veil has to stay over the viewport rather than over a scrolled-away box. */
    .pause-veil {
      position: fixed;
    }

    .title-screen {
      gap: 1.25rem;
      padding: 2rem 1rem;
    }

    .qr-holder,
    .code-hidden {
      /* Against the SHORTER axis: a QR sized off 30vh is taller than a phone's width. */
      width: min(62vw, 16rem);
    }

    .game-title {
      font-size: calc(clamp(2rem, 9vw, 3rem) * var(--type-scale));
    }

    .room-code {
      font-size: calc(clamp(2.2rem, 14vw, 4rem) * var(--type-scale));
    }

    .join-url {
      font-size: calc(clamp(0.9rem, 4vw, 1.3rem) * var(--type-scale));
      overflow-wrap: anywhere;
    }

    .interstitial-title,
    .winner-names {
      font-size: calc(clamp(1.6rem, 8vw, 3rem) * var(--type-scale));
    }

    /* A 6-column board does not become readable by shrinking; it becomes readable by
       scrolling. The minimum keeps a category header legible and lets the phone pan. */
    .board-holder {
      overflow-x: auto;
      padding: 1rem 0.75rem;
    }

    .board-holder :global(.board) {
      min-width: 34rem;
    }

    /* Scores wrap to many rows on a phone; cap and scroll them rather than pushing the board
       off the screen. */
    .display-scores {
      max-height: 28vh;
      overflow-y: auto;
    }

    .category-reveal {
      grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
      padding: 2rem 1rem;
    }

    .reveal-card {
      min-height: 6rem;
    }
  }
</style>
