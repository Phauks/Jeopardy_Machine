<script lang="ts">
  // Dev: the avatar diorama, with fake players, without hosting a game.
  //
  // The diorama's real home is the display route's lobby/interstitial/winner screens, which
  // means seeing it normally costs a room, a game, and a phone. This page is the shortcut -
  // add players, change theme, fire a buzz beat, flip to the winner scene - so the owner can
  // judge the thing that is hardest to judge from a diff: whether it looks good.
  //
  // It is also the honest place to see the degradations: a browser without WebGL renders the
  // page with an empty stage and every control still working, exactly as the display would.
  import { prefersReducedMotion } from "svelte/motion";
  import AvatarDiorama from "#lib/diorama/avatar-diorama.svelte";
  import AvatarChip from "#lib/avatars/avatar-chip.svelte";
  import { accentById, avatarById, avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import { supportsWebGl } from "#lib/diorama/diorama-environment.ts";
  import { maxDioramaAvatars } from "#lib/diorama/wander.ts";
  import { themePresets, retroTvPreset } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import type { DioramaOccupant } from "#lib/diorama/diorama-scene.ts";

  // Fake players drawn round-robin from the real roster and palette, so the preview exercises
  // the same manifest, the same models, and the same runtime recolor the display does.
  const names = [
    "Rowan", "Kit", "Sable", "Juniper", "Ash", "Marlo", "Wren", "Bex",
    "Otto", "Pim", "Sol", "Nix", "Fen", "Isla", "Gus", "Vela",
  ];

  let count = $state(5);
  let themeId = $state(retroTvPreset.id);
  let winnerScene = $state(false);
  let beat = $state<{ entityId: string; at: number } | null>(null);
  let webGlAvailable = $state(true);

  $effect(() => {
    webGlAvailable = supportsWebGl();
  });

  const theme = $derived(themePresets.find((preset) => preset.id === themeId) ?? retroTvPreset);

  const players = $derived(
    Array.from({ length: count }, (_, index) => {
      const avatar = avatarManifest.avatars[index % avatarManifest.avatars.length];
      const accent = avatarManifest.accents[index % avatarManifest.accents.length];
      return {
        entityId: `fake-${String(index)}`,
        nickname: names[index % names.length] ?? `Player ${String(index + 1)}`,
        avatarId: avatar?.id ?? null,
        accentId: accent?.id ?? null,
      };
    }),
  );
  const occupants: DioramaOccupant[] = $derived(
    players.map((player) => ({
      entityId: player.entityId,
      avatarId: player.avatarId,
      accentId: player.accentId,
    })),
  );
  // The winner scene celebrates the top two, the way a real game-over with a tie would.
  const celebratingEntityIds = $derived(
    winnerScene ? players.slice(0, 2).map((player) => player.entityId) : [],
  );

  function fireBeat(entityId: string): void {
    beat = { entityId, at: Date.now() };
  }
</script>

<svelte:head>
  <title>Dev: avatar diorama</title>
</svelte:head>

<div class="diorama-page" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  <div class="stage">
    <AvatarDiorama {occupants} {celebratingEntityIds} {beat} themeKey={theme.id} />
    <div class="overlay">
      <h1>{winnerScene ? "Winner" : "Jeopardy Machine"}</h1>
      <p class="line">
        {#if winnerScene}
          {players
            .slice(0, 2)
            .map((player) => player.nickname)
            .join(" · ")}
        {:else}
          room code <strong>DEVXX</strong> · {players.length}
          {players.length === 1 ? "player" : "players"} in
        {/if}
      </p>
    </div>
  </div>

  <section class="controls">
    <h2>Diorama preview</h2>
    <p class="note">
      The display's lobby, interstitial, and winner screens mount this; the board and clue
      screens never do. Models are the committed GLBs under /avatars/models/, recolored at
      runtime by the same palette-recolor.ts the sprite bake uses.
    </p>

    {#if !webGlAvailable}
      <p class="warn" role="status">
        No WebGL on this browser - the stage above is empty and the display would show its
        plain 2D lobby. That degradation is the point: the diorama is decoration, never a
        dependency of play.
      </p>
    {/if}
    {#if prefersReducedMotion.current}
      <p class="warn" role="status">
        prefers-reduced-motion is on: nobody wanders, everybody stands. Celebrations still
        play, because they are the content of the winner screen rather than ambient motion.
      </p>
    {/if}

    <div class="row">
      <label for="player-count">Players ({count})</label>
      <input id="player-count" type="range" min="1" max={maxDioramaAvatars} bind:value={count} />
    </div>

    <div class="row">
      <span class="row-label">Theme</span>
      <div class="chips">
        {#each themePresets as preset (preset.id)}
          <button
            type="button"
            class="chip"
            class:active={preset.id === themeId}
            onclick={() => {
              themeId = preset.id;
            }}
          >
            {preset.label}
          </button>
        {/each}
      </div>
    </div>
    <p class="note">
      Ground, backdrop fog, and the rim light all come from the active theme's tokens - switch
      presets and the stage restyles with the chrome.
    </p>

    <div class="row">
      <span class="row-label">Scene</span>
      <div class="chips">
        <button
          type="button"
          class="chip"
          class:active={!winnerScene}
          onclick={() => {
            winnerScene = false;
          }}
        >
          Lobby
        </button>
        <button
          type="button"
          class="chip"
          class:active={winnerScene}
          onclick={() => {
            winnerScene = true;
          }}
        >
          Winner
        </button>
      </div>
    </div>

    <div class="row">
      <span class="row-label">Buzz beat</span>
      <div class="chips">
        {#each players as player (player.entityId)}
          {@const avatar = avatarById(player.avatarId)}
          <button
            type="button"
            class="chip beat"
            onclick={() => {
              fireBeat(player.entityId);
            }}
          >
            {#if avatar}
              <AvatarChip {avatar} accent={accentById(player.accentId)} size="20px" />
            {/if}
            {player.nickname}
          </button>
        {/each}
      </div>
    </div>
    <p class="note">
      A beat is what the buzz winner does: turn to the room and celebrate, then rejoin the
      stroll. On the display it fires from the room event stream - and never during a live
      clue, because the diorama is not mounted then.
    </p>
  </section>
</div>

<style>
  .diorama-page {
    min-height: 100vh;
    background: var(--page-bg);
    color: var(--surface-text);
    display: flex;
    flex-direction: column;
  }

  .stage {
    position: relative;
    height: 60vh;
    min-height: 20rem;
    overflow: hidden;
  }

  .overlay {
    position: absolute;
    inset: 0 0 auto;
    padding: 2rem;
    text-align: center;
    pointer-events: none;
  }

  .overlay h1 {
    font-family: var(--font-display);
    font-size: clamp(2rem, 7vh, 4rem);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--board-value-color);
    text-shadow: var(--effect-value-glow);
    margin: 0;
  }

  .line {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--surface-text-muted);
    margin: 0.4rem 0 0;
  }

  .line strong {
    color: var(--board-value-color);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.5rem;
    max-width: 60rem;
    margin: 0 auto;
    width: 100%;
  }

  .controls h2 {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0;
  }

  .note {
    margin: 0;
    font-size: 0.85rem;
    color: var(--surface-text-muted);
    max-width: 60ch;
  }

  .warn {
    margin: 0;
    font-size: 0.85rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--surface-border);
    background: var(--surface-raised);
    max-width: 60ch;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .row label,
  .row-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.8rem;
    color: var(--surface-text-muted);
    min-width: 8rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--surface-border);
    background: var(--surface-raised);
    color: var(--surface-text);
    cursor: pointer;
  }

  .chip.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .chip.beat {
    padding-left: 0.3rem;
  }

  .chip:focus-visible,
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
