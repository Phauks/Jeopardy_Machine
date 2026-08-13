<script lang="ts">
  // Renders one curated emblem (lib/emblems/emblem-set.ts) as an inline SVG that tints via
  // currentColor - set `color` on any ancestor (a team color, --accent, --board-value-color)
  // and the mark follows. Size rides on font-size (1em box) so emblems sit in text lines,
  // roster chips, and buzzer screens without per-context sizing props.
  import type { Emblem } from "#lib/emblems/emblem-set.ts";

  type Props = { emblem: Emblem };
  let { emblem }: Props = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- markup is the in-repo curated set,
     compile-time constants, never user input. -->
<svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={emblem.label}>
  {@html emblem.markup}
</svg>

<style>
  svg {
    width: 1em;
    height: 1em;
    display: inline-block;
    vertical-align: -0.12em;
  }
</style>
