<script lang="ts">
  // The board display: category headers + value grid + used-cell state + clue-card overlay.
  // Styled ENTIRELY by the semantic token contract (lib/theme/tokens.css, docs/design/theming.md)
  // - no raw colors, no preset knowledge, no effects-level branches. The M5 display surface
  // will drive selection/used state from room state; until then the component runs its static
  // demo behavior (click to open a clue, done marks it used), which is exactly what the
  // /dev/theme gallery needs to prove the contract.
  import { fade, scale } from "svelte/transition";
  import { prefersReducedMotion } from "svelte/motion";
  import { SvelteSet } from "svelte/reactivity";
  import type { BoardData } from "#lib/board/sample-board.ts";

  type Props = {
    board: BoardData;
    /**
     * Controlled mode (the /dev/hotseat driver, later the M4 display surface): the caller
     * owns used-cell state as "categoryIndex:clueIndex" keys and receives selections instead
     * of the internal demo overlay. Both omitted = the original self-contained demo behavior
     * the /dev/theme gallery runs on.
     */
    usedKeys?: ReadonlySet<string> | null;
    onCellSelect?: ((categoryIndex: number, clueIndex: number) => void) | null;
  };
  let { board, usedKeys = null, onCellSelect = null }: Props = $props();

  type OpenClue = { categoryIndex: number; clueIndex: number };
  let openClue = $state<OpenClue | null>(null);
  const usedCells = new SvelteSet<string>();

  function isUsed(categoryIndex: number, clueIndex: number): boolean {
    const key = cellKey(categoryIndex, clueIndex);
    return usedKeys === null ? usedCells.has(key) : usedKeys.has(key);
  }

  const rowCount = $derived(Math.max(...board.categories.map((entry) => entry.clues.length)));
  // Reduced motion: the clue reveal becomes an instant cut (research 05-ui-design.md section 7).
  // The full FLIP zoom-from-cell arrives with the M5 display surface; this scale-in is the
  // overlay's baseline behavior.
  const transitionDuration = $derived(prefersReducedMotion.current ? 0 : 200);

  function cellKey(categoryIndex: number, clueIndex: number): string {
    return `${String(categoryIndex)}:${String(clueIndex)}`;
  }

  function openCell(categoryIndex: number, clueIndex: number): void {
    if (isUsed(categoryIndex, clueIndex)) return;
    if (onCellSelect !== null) {
      onCellSelect(categoryIndex, clueIndex);
      return;
    }
    openClue = { categoryIndex, clueIndex };
  }

  function dismissClue(markUsed: boolean): void {
    if (openClue === null) return;
    if (markUsed) usedCells.add(cellKey(openClue.categoryIndex, openClue.clueIndex));
    openClue = null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && openClue !== null) dismissClue(false);
  }

  const openClueData = $derived(
    openClue === null
      ? null
      : {
          category: board.categories[openClue.categoryIndex],
          clue: board.categories[openClue.categoryIndex]?.clues[openClue.clueIndex],
        },
  );
</script>

<svelte:window onkeydown={onKeydown} />

<div class="board" style="--board-columns: {board.categories.length}">
  {#each board.categories as category (category.title)}
    <div class="category-cell">{category.title}</div>
  {/each}
  {#each { length: rowCount } as _, rowIndex (rowIndex)}
    {#each board.categories as category, categoryIndex (category.title)}
      {@const clue = category.clues[rowIndex]}
      {#if clue}
        {@const used = isUsed(categoryIndex, rowIndex)}
        <button
          type="button"
          class="value-cell"
          class:used
          disabled={used}
          onclick={() => {
            openCell(categoryIndex, rowIndex);
          }}
          aria-label="{category.title}, {board.currency}{clue.value}{used ? ', already played' : ''}"
        >
          {#if !used}
            <!-- Used cells render EMPTY by contract: the used-cell tokens style the empty
                 cell; which treatment (blank/dim/outline) is the theme's business. -->
            <span class="value-label">{board.currency}{clue.value}</span>
          {/if}
        </button>
      {:else}
        <div class="value-cell" aria-hidden="true"></div>
      {/if}
    {/each}
  {/each}

  {#if openClueData?.clue && openClueData.category}
    <div
      class="clue-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Clue: {openClueData.category.title}, {board.currency}{openClueData.clue.value}"
      transition:fade={{ duration: transitionDuration }}
    >
      <div class="clue-card" transition:scale={{ duration: transitionDuration, start: 0.85 }}>
        <p class="clue-kicker">
          {openClueData.category.title} · {board.currency}{openClueData.clue.value}
        </p>
        <p class="clue-text">{openClueData.clue.clue}</p>
        <div class="clue-actions">
          <button
            type="button"
            class="clue-action primary"
            onclick={() => {
              dismissClue(true);
            }}
          >
            Done
          </button>
          <button
            type="button"
            class="clue-action"
            onclick={() => {
              dismissClue(false);
            }}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Gutters ARE the board background showing through grid gaps (tokens.css SYNC BLOCK):
   * one fill token gives both the frame and the grid lines, and thick gutters stay trade
   * dress via the layout constant. */
  .board {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--board-columns), minmax(0, 1fr));
    grid-template-rows: minmax(0, 1.1fr);
    grid-auto-rows: minmax(0, 1fr);
    gap: var(--board-gutter);
    padding: var(--board-gutter);
    background: var(--board-bg);
    width: 100%;
    aspect-ratio: 16 / 9;
  }

  .category-cell,
  .value-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-radius: var(--board-radius);
    /* Layering rule from the contract: effects overlay first (a possibly-`none` image
     * layer), theme fill last (color or gradient - both valid final layers). */
    background: var(--effect-cell-overlay), var(--board-category-bg);
    box-shadow: var(--effect-cell-shadow);
    min-width: 0;
    overflow: hidden;
  }

  .category-cell {
    color: var(--clue-text-color);
    font-family: var(--font-chrome);
    font-size: var(--board-category-size);
    font-weight: 600;
    line-height: 1.15;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-shadow: var(--effect-category-text-shadow);
    padding: 0.4em 0.3em;
    overflow-wrap: anywhere;
  }

  .value-cell {
    background: var(--effect-cell-overlay), var(--board-cell-bg);
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--board-value-color);
    font-family: var(--font-values);
    font-size: var(--board-value-size);
    line-height: 1;
    text-shadow: var(--effect-value-glow);
  }

  .value-cell:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }

  .value-cell.used {
    background: var(--board-cell-used-bg);
    box-shadow: var(--board-cell-used-outline);
    opacity: var(--board-cell-used-opacity);
    cursor: default;
  }

  .value-label {
    /* Six-Caps-style ultra-condensed faces sit high on the line; nudge optically center. */
    transform: translateY(0.02em);
  }

  .clue-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    background: var(--surface-scrim);
    padding: 3%;
  }

  .clue-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.2em;
    text-align: center;
    padding: 4% 6%;
    border-radius: var(--board-radius);
    background: var(--effect-cell-overlay), var(--board-cell-bg);
    box-shadow: var(--effect-clue-card-shadow);
  }

  .clue-kicker {
    color: var(--board-value-color);
    font-family: var(--font-chrome);
    font-size: calc(var(--clue-text-size) * 0.45);
    text-transform: uppercase;
    letter-spacing: 0.08em;
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
    text-shadow: var(--effect-category-text-shadow);
  }

  .clue-actions {
    display: flex;
    gap: 0.75rem;
  }

  .clue-action {
    font-family: var(--font-chrome);
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.5rem 1.4rem;
    border-radius: var(--board-radius);
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--clue-text-color);
    cursor: pointer;
  }

  .clue-action.primary {
    background: var(--accent);
    /* Filled accent chips take the page base for text: always a plain color (contract
     * guarantee) and always dark-on-light-accent / light-on-dark-accent across presets. */
    color: var(--surface-page);
  }

  .clue-action:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
