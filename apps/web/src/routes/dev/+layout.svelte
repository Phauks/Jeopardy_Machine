<script lang="ts">
  // Shared chrome for all /dev routes: the build badge, so any deployment states exactly
  // which commit it is (owner request - deploy status verification at a glance). The badge
  // uses fixed dev-chrome colors on purpose: dev tooling is never themed by previewed
  // themes (same rule as the theme gallery pickers).
  let { children } = $props();
</script>

{@render children()}

<a
  class="build-badge"
  href="/api/version"
  title="Build metadata (click for JSON)"
  data-sveltekit-reload
>
  {__BUILD_META__.sha} · {__BUILD_META__.builtAt.slice(0, 16).replace("T", " ")}Z
</a>

<style>
  .build-badge {
    position: fixed;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 50;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    padding: 0.2rem 0.55rem;
    border-radius: 4px;
    border: 1px solid #3a3a48;
    background: #1b1b23;
    color: #a3a2b2;
    text-decoration: none;
    opacity: 0.85;
  }

  .build-badge:hover {
    color: #ecebf2;
    opacity: 1;
  }
</style>
