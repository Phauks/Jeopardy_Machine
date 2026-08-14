<script lang="ts">
  // The host console route (/room/CODE/host): the C4 instrument panel with mirror mode
  // (?mirror starts in it) and the dev-only sim panel. MOCK MODE until the M3 reconcile: an
  // isolated local simulation with the full fixture roster - the sim panel drives fake
  // players so a whole game is playable from this one tab (docs/design/surfaces.md).
  import { onDestroy } from "svelte";
  import { browser, dev } from "$app/env";
  import { page } from "$app/state";
  import HostConsole from "#lib/room/host-console.svelte";
  import { createRoomStore } from "#lib/room/create-room-store.ts";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";

  const roomCode = (page.params.code ?? "DUMYX").toUpperCase();
  const store = createRoomStore({
    roomCode,
    role: "host",
    timerAutopilot: browser,
  });
  onDestroy(() => {
    store.destroy();
  });

  const startInMirror = page.url.searchParams.has("mirror");
  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );
</script>

<svelte:head>
  <title>Host - Room {roomCode}</title>
</svelte:head>

<div class="host-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  <HostConsole {store} showSimPanel={dev} mirror={startInMirror} />
</div>

<style>
  .host-shell {
    min-height: 100dvh;
    background: var(--surface-page);
  }
</style>
