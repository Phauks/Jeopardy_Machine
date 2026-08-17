<script lang="ts">
  // The registry's state, rendered wherever a room list is rendered (the landing page's Join
  // section, the harness's lobby panel). Presentational: the words live in registry-status.ts
  // so every surface says the same thing.
  //
  // `quiet` is for player-facing surfaces: a healthy registry there should be invisible - the
  // Join section is not a status board - while a broken one is always shown, because "no
  // rooms" without a reason is precisely the bug this replaces.
  import { describeRegistryStatus } from "#lib/lobby/registry-status.ts";
  import type { RegistryStatus } from "@jeopardy/protocol/room/registry";

  type Props = { status: RegistryStatus; quiet?: boolean };
  let { status, quiet = false }: Props = $props();

  const notice = $derived(describeRegistryStatus(status));
</script>

{#if !(quiet && notice.tone === "ok")}
  <div class="registry-status" data-tone={notice.tone}>
    <strong>{notice.headline}</strong>
    <span>{notice.hint}</span>
    {#if notice.fix !== null}
      <code>{notice.fix}</code>
    {/if}
    {#if notice.detail !== null}
      <span class="detail">{notice.detail}</span>
    {/if}
  </div>
{/if}

<style>
  /* Token-only styling (docs/design/theming.md): this renders on the front door, which is
     built from the BOARD tokens, as well as inside the unthemed dev panel - where the tokens
     fall back to their retro-tv defaults in tokens.css and it still reads correctly. Derived
     from --board-cell-bg + --clue-text-color rather than the chrome tokens because that pair
     is the one the theme contract guarantees to be legible together under every preset. */
  .registry-status {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.7rem 0.8rem;
    font-size: 0.85rem;
    border-radius: 2px;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    background: color-mix(in srgb, var(--board-cell-bg) 62%, #000000);
    color: var(--clue-text-color);
  }

  .registry-status[data-tone="ok"] {
    border-style: dashed;
    opacity: 0.7;
  }

  /* Warnings are meant to look wrong - a broken registry that renders quietly is the bug
     registry-status.ts was written to end. */
  .registry-status[data-tone="warning"] {
    border-color: var(--score-negative);
  }

  .registry-status code {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    overflow-x: auto;
    padding: 0.4rem 0.5rem;
    border-radius: 2px;
    border: 1px solid color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    background: color-mix(in srgb, var(--board-cell-bg) 40%, #000000);
  }

  .detail {
    font-size: 0.75rem;
    color: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
  }
</style>
