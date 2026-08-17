<script lang="ts">
  // The host console route (/room/CODE/host): the C4 instrument panel with mirror mode
  // (?mirror starts in it) and the dev-only sim panel. MOCK MODE until the M3 reconcile: an
  // isolated local simulation with the full fixture roster - the sim panel drives fake
  // players so a whole game is playable from this one tab (docs/design/surfaces.md).
  import { onDestroy } from "svelte";
  import { browser, dev } from "$app/env";
  import { page } from "$app/state";
  import HostConsole from "#lib/room/host-console.svelte";
  import { createRoomStore, seedRosterFor } from "#lib/room/create-room-store.ts";
  import { devicePreferences } from "#lib/host-settings/device-preferences.svelte.ts";
  import { RoomAudio } from "#lib/room/room-audio.ts";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import type { GameEvent } from "@jeopardy/engine/events";

  const roomCode = (page.params.code ?? "DUMYX").toUpperCase();

  // This device's preferences: type scales, audio, mirror, manual mode (src/lib/host-settings/).
  // Attached on the route rather than in the console so the display window of the same browser
  // and this console are reading one document - which is how the cog's "display text size"
  // reaches a projector window on the other screen without any room state at all.
  if (browser) devicePreferences.attach();
  onDestroy(() => {
    devicePreferences.detach();
  });

  // The console's own room audio, off by default (resolved UX question 3: every client owns a
  // local toggle, the display defaults on and everything else off). The host turns it on in the
  // cog when the console sits nearer the speakers than the projector laptop does.
  const consoleAudio = new RoomAudio({ enabled: false });
  function onRoomEvent(event: GameEvent): void {
    if (event.type === "buzz-won") {
      const view = store.view;
      const team = view.roster.teams.find((entry) => entry.teamId === event.entityId);
      const sound =
        team?.buzzSoundId ??
        view.roster.players.find((entry) => entry.playerId === event.playerId)?.buzzSoundId ??
        null;
      consoleAudio.playBuzz(sound);
    }
  }

  const store = createRoomStore({
    roomCode,
    // The dummy roster belongs to the fixture room and to ?demo, never to a code somebody just
    // created (create-room-store.ts): a real room starts empty and says so.
    seedRoster: seedRosterFor(roomCode, page.url),
    role: "host",
    timerAutopilot: browser,
    onEvent: onRoomEvent,
  });
  onDestroy(() => {
    store.destroy();
  });

  $effect(() => {
    const preferences = devicePreferences.current;
    consoleAudio.enabled = preferences.consoleAudio;
    consoleAudio.setVolume(preferences.audioVolume);
    // Priming needs a user gesture (autoplay policy); turning the toggle on IS one.
    if (preferences.consoleAudio) consoleAudio.prime();
  });

  const startInMirror = page.url.searchParams.has("mirror");
  const startWithSettings = page.url.searchParams.has("settings");
  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );
</script>

<svelte:head>
  <title>Host - Room {roomCode}</title>
</svelte:head>

<div class="host-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  <HostConsole
    {store}
    showSimPanel={dev}
    mirror={startInMirror}
    settingsOpen={startWithSettings}
  />
</div>

<style>
  .host-shell {
    min-height: 100dvh;
    background: var(--surface-page);
  }
</style>
