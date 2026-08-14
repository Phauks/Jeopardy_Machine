<script lang="ts">
  // Shared chrome for all /dev routes: the build badge (see lib/dev/build-badge.svelte).
  import BuildBadge from "#lib/dev/build-badge.svelte";

  let { children } = $props();
</script>

{@render children()}

<BuildBadge />
