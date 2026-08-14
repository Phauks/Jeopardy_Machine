<script lang="ts">
  // /dev/theme - the theme gallery and the owner's requested proof drill: a WORKING preset
  // switcher that flips all four built-in themes live over one token contract
  // (docs/research/00-user-directives.md "UI gallery feedback round 1"; contract:
  // docs/design/theming.md). Like /dev/echo, dev-routes convention applies: /dev/* pages are
  // developer surfaces, never linked from product UI, and carry no player-facing weight.
  import AvatarChip from "#lib/avatars/avatar-chip.svelte";
  import AvatarPicker from "#lib/avatars/avatar-picker.svelte";
  import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
  import BoardDisplay from "#lib/board/board-display.svelte";
  import { sampleBoard } from "#lib/board/sample-board.ts";
  import { themePresets } from "#lib/theme/theme-presets.ts";
  import type { ThemeEffectsLevel, ThemePresetId } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute, themeToTokens } from "#lib/theme/theme-to-css.ts";

  const effectsLevels: readonly ThemeEffectsLevel[] = ["flat", "dimensional"];

  let selectedPresetId = $state<ThemePresetId>("retro-tv");
  // Effects override starts at the preset's own level on every switch - the toggle then
  // proves flat/dimensional is a token-driven switch on ANY preset, not a preset property.
  let effectsOverride = $state<ThemeEffectsLevel | null>(null);

  const preset = $derived(
    themePresets.find((entry) => entry.id === selectedPresetId) ?? themePresets[0],
  );
  const effectsLevel = $derived(effectsOverride ?? preset?.effectsLevel ?? "flat");
  const themeStyle = $derived(preset ? themeToStyleAttribute(preset) : "");
  const tokenRecord = $derived(preset ? themeToTokens(preset) : null);

  function selectPreset(id: ThemePresetId): void {
    selectedPresetId = id;
    effectsOverride = null;
  }

  const fontSpecimens = [
    { token: "--font-display", slot: "display", sample: "DOUBLE DOWN!" },
    { token: "--font-values", slot: "values", sample: "$200 $600 $1000" },
    { token: "--font-clue", slot: "clue", sample: "THIS RESOURCE POWERS BOTH SOLAR PANELS AND GAME NIGHTS" },
    { token: "--font-chrome", slot: "chrome", sample: "Category · Lobby · Arm buzzer" },
  ] as const;

  // Swatch chips paint the token value as a background - only meaningful for color/fill
  // tokens (font stacks render as specimens above; outline/opacity are shown as text).
  const paintableTokens = $derived(
    tokenRecord === null
      ? []
      : Object.entries(tokenRecord).filter(
          ([name]) =>
            !name.startsWith("--font") &&
            name !== "--board-cell-used-outline" &&
            name !== "--board-cell-used-opacity",
        ),
  );
  const textOnlyTokens = $derived(
    tokenRecord === null
      ? []
      : (["--board-cell-used-outline", "--board-cell-used-opacity"] as const).map(
          (name) => [name, tokenRecord[name]] as const,
        ),
  );

  // Avatar picker state lives here because the picker component is deliberately
  // presentational - the join screen (M4 phase 2) will own this state the same way.
  let selectedAvatarId = $state<string>("dog");
  let selectedAccentId = $state<string>(avatarManifest.accents[0]?.id ?? "gold");
  const selectedAvatar = $derived(
    avatarManifest.avatars.find((avatar) => avatar.id === selectedAvatarId) ??
      avatarManifest.avatars[0],
  );
  const selectedAccent = $derived(
    avatarManifest.accents.find((accent) => accent.id === selectedAccentId) ??
      avatarManifest.accents[0],
  );
</script>

<svelte:head>
  <title>Dev: theme gallery</title>
</svelte:head>

<!-- Gallery chrome is deliberately NOT themed (2026-08-13, second light-theme bug): the
     page runs on the default token values (dark), and ONLY the preview panels below carry
     the selected theme. A previewed theme may be light, dark, or ugly - the gallery around
     it must stay readable regardless. Same rule as the picker chips. -->
<main class="min-h-screen bg-surface-page text-surface-text">
  <div class="mx-auto flex max-w-6xl flex-col gap-8 p-6">
    <header class="flex flex-col gap-4">
      <h1 class="chrome-title text-2xl">Theme gallery</h1>
      <p class="max-w-prose text-sm text-surface-text-muted">
        Four built-in presets, one token contract (docs/design/theming.md). Switching is a
        style-attribute swap - no CSS forks, no reload. The effects toggle re-derives
        bevel/glow/vignette from the active theme's own tokens.
      </p>
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Theme preset">
        {#each themePresets as entry (entry.id)}
          <button
            type="button"
            class="picker-chip"
            class:active={entry.id === selectedPresetId}
            onclick={() => {
              selectPreset(entry.id);
            }}
          >
            {entry.label}
          </button>
        {/each}
      </div>
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Effects level">
        <span class="text-sm text-surface-text-muted">Effects:</span>
        {#each effectsLevels as level (level)}
          <button
            type="button"
            class="picker-chip"
            class:active={effectsLevel === level}
            onclick={() => {
              effectsOverride = level;
            }}
          >
            {level}
          </button>
        {/each}
        {#if preset && effectsOverride !== null && effectsOverride !== preset.effectsLevel}
          <span class="text-sm text-surface-text-muted">
            (preset default: {preset.effectsLevel})
          </span>
        {/if}
      </div>
    </header>

    <section class="flex flex-col gap-3">
      <h2 class="chrome-title text-lg">Board</h2>
      <div
        class="preview-panel bg-surface-page text-surface-text"
        style={themeStyle}
        data-effects={effectsLevel}
      >
        <BoardDisplay board={sampleBoard} />
        <p class="mt-3 text-sm text-surface-text-muted">
          Click a cell for the clue card; Done marks it used ({preset?.tokens.usedCellTreatment}
          treatment).
        </p>
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="chrome-title text-lg">Type specimens</h2>
      <div
        class="preview-panel flex flex-col gap-4 bg-surface-raised text-surface-text"
        style={themeStyle}
        data-effects={effectsLevel}
      >
        {#each fontSpecimens as specimen (specimen.token)}
          <div class="flex flex-col gap-1">
            <span class="text-xs tracking-wide text-surface-text-muted uppercase">
              {specimen.slot} · <code>{specimen.token}</code>
            </span>
            <!-- Specimens render in the slot's REAL board context (value gold on cell blue,
                 clue text on cell bg) - not inherited panel text color, which could sit
                 illegibly on light presets and misrepresents how the font actually appears. -->
            <span
              class="specimen"
              class:specimen-on-cell={specimen.slot !== "chrome"}
              style="font-family: var({specimen.token}); color: {specimen.slot === 'clue'
                ? 'var(--clue-text-color)'
                : specimen.slot === 'chrome'
                  ? 'var(--surface-text)'
                  : 'var(--board-value-color)'}"
            >
              {specimen.sample}
            </span>
          </div>
        {/each}
      </div>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="chrome-title text-lg">Token swatches</h2>
      <div
        class="preview-panel grid grid-cols-1 gap-2 bg-surface-page text-surface-text sm:grid-cols-2 lg:grid-cols-3"
        style={themeStyle}
        data-effects={effectsLevel}
      >
        {#each paintableTokens as [name, value] (name)}
          <div
            class="flex items-center gap-3 rounded-sm border border-surface-border bg-surface-raised p-2"
          >
            <span class="swatch-chip" style="background: {value}" aria-hidden="true"></span>
            <span class="flex min-w-0 flex-col">
              <code class="text-xs">{name}</code>
              <span class="truncate text-xs text-surface-text-muted">{value}</span>
            </span>
          </div>
        {/each}
      </div>
      <ul class="flex flex-col gap-1">
        {#each textOnlyTokens as [name, value] (name)}
          <li class="text-xs text-surface-text-muted">
            <code>{name}</code>: <code>{value}</code>
          </li>
        {/each}
      </ul>
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="chrome-title text-lg">Avatars</h2>
      <p class="max-w-prose text-sm text-surface-text-muted">
        Full-color player avatars: Kenney Cube Pets + Mini Characters, baked to accent-recolored
        sprites by tools/avatar-bake (licensing: static/avatars/LICENSES.md). The picker below is
        the presentational join-screen component; the chip row is the 24px score-chip identity
        story - at that size the accent backing carries identity, from 48px the avatar itself
        reads. Picker chrome is un-themed like all gallery controls; only the chip-row panel
        carries the selected theme.
      </p>
      <div class="preview-panel bg-surface-raised text-surface-text">
        <AvatarPicker
          avatars={avatarManifest.avatars}
          accents={avatarManifest.accents}
          {selectedAvatarId}
          {selectedAccentId}
          onSelectAvatar={(avatarId) => {
            selectedAvatarId = avatarId;
          }}
          onSelectAccent={(accentId) => {
            selectedAccentId = accentId;
          }}
        />
      </div>
      {#if selectedAvatar && selectedAccent}
        <div
          class="preview-panel bg-surface-page text-surface-text"
          style={themeStyle}
          data-effects={effectsLevel}
        >
          <div class="flex flex-wrap items-center gap-6">
            {#each ["24px", "48px", "96px"] as chipSize (chipSize)}
              <div class="flex items-center gap-2">
                <AvatarChip avatar={selectedAvatar} accent={selectedAccent} size={chipSize} />
                <span class="text-xs text-surface-text-muted">{chipSize}</span>
              </div>
            {/each}
            <span
              class="roster-chip"
              style="background: {selectedAccent.hex}"
              data-effects={effectsLevel}
            >
              <AvatarChip avatar={selectedAvatar} accent={selectedAccent} size="24px" />
              <b>{selectedAvatar.displayName}</b>
              <em>$0</em>
            </span>
          </div>
        </div>
      {/if}
    </section>
  </div>
</main>

<style>
  .chrome-title {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* Every preview panel paints its own themed ground, so a light theme's light text sits
     on that theme's own surfaces - never on the gallery's dark chrome (and vice versa). */
  .preview-panel {
    border-radius: 6px;
    border: 1px solid #3a3a48;
    padding: 1.25rem;
  }

  /* The picker controls are deliberately NOT themed: they switch the theme under preview,
     so they must stay visible on every preset (the light event-poster paper washed out
     theme-derived chips - dev-gallery bug, 2026-08-13). Fixed dev-chrome palette. */
  .picker-chip {
    font-family: var(--font-chrome);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.35rem 0.9rem;
    border-radius: 4px;
    border: 1px solid #3a3a48;
    background: #1b1b23;
    color: #ecebf2;
    cursor: pointer;
  }

  .picker-chip.active {
    background: #cfa146;
    color: #131318;
    border-color: #cfa146;
  }

  .picker-chip:focus-visible {
    outline: 3px solid #cfa146;
    outline-offset: 2px;
  }

  .specimen {
    font-size: clamp(1.6rem, 4vw, 3rem);
    line-height: 1.1;
    overflow-wrap: anywhere;
  }

  .specimen-on-cell {
    background: var(--board-cell-bg);
    padding: 0.35rem 0.75rem;
    border-radius: var(--board-radius);
    align-self: flex-start;
  }

  .swatch-chip {
    width: 2.4rem;
    height: 2.4rem;
    flex: none;
    border-radius: var(--board-radius);
    /* Dual ring reads on ANY ground - a paper swatch on a paper panel (event-poster) was
       invisible with a theme-derived border. Never derive a swatch's outline from the
       theme it is displaying. */
    border: 1px solid rgb(0 0 0 / 0.45);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.45);
  }

  /* Mock roster chip: the lobby/score-strip context a 24px avatar chip lives in. */
  .roster-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.3rem 0.85rem 0.3rem 0.4rem;
    border-radius: 999px;
    color: #ffffff;
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.18),
      0 2px 6px rgb(0 0 0 / 0.4);
  }

  .emblem-tile {
    font-size: 3rem;
    line-height: 1;
    /* Emblems sit on a cell-colored backing chip - their real home in the product (player
       chips, roster cards) - so a light tint on a light panel can never vanish. */
    display: grid;
    place-items: center;
    padding: 0.5rem;
    border-radius: 6px;
    background: var(--board-cell-bg);
  }

  .roster-chip b {
    font-family: var(--font-chrome);
    font-weight: 600;
    letter-spacing: 0.06em;
    font-size: 0.85rem;
  }

  .roster-chip em {
    font-style: normal;
    font-size: 0.75rem;
    opacity: 0.75;
    font-variant-numeric: tabular-nums;
  }
</style>
