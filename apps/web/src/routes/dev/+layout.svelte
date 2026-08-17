<script lang="ts">
  // Shared chrome for all /dev routes: the way home (lib/chrome/home-button.svelte) and the
  // build badge (lib/dev/build-badge.svelte). The dev surfaces have no headers of their own -
  // they are instrument panels - so the home affordance floats rather than sitting in a row.
  import BuildBadge from "#lib/dev/build-badge.svelte";
  import HomeButton from "#lib/chrome/home-button.svelte";

  let { children } = $props();
</script>

<HomeButton variant="floating" />

{@render children()}

<BuildBadge />
