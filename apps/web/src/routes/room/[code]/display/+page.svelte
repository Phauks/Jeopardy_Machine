<script lang="ts">
  // The board display (/room/CODE/display): the projector window (C1). An independent client
  // of the room - crashing or reopening it never touches the game. This device is the
  // default room-audio owner (resolved UX question 3: per-device toggle, display on by
  // default); the buzz sound is resolved TEAM-first (owner directive: double confirmation).
  // MOCK MODE until the M3 reconcile: an isolated local simulation (docs/design/surfaces.md);
  // use the host route's sim panel in another tab for a driven demo, or this page's own sim
  // hotkeys below.
  import { onDestroy } from "svelte";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import DisplayScreen from "#lib/room/display-screen.svelte";
  import { createRoomStore } from "#lib/room/create-room-store.ts";
  import { devicePreferences } from "#lib/host-settings/device-preferences.svelte.ts";
  import { typeScaleStyle } from "#lib/host-settings/device-preferences.ts";
  import { resolveDioramaEnvironment } from "#lib/diorama/diorama-environment.ts";
  import { RoomAudio } from "#lib/room/room-audio.ts";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import type { GameEvent } from "@jeopardy/engine/events";

  const roomCode = (page.params.code ?? "DUMYX").toUpperCase();

  const roomAudio = new RoomAudio({ enabled: true });
  let audioReady = $state(false);

  // THIS DEVICE'S PREFERENCES (src/lib/host-settings/). The display window reads the same
  // localStorage document the host console writes, and a `storage` event lands here the moment
  // the cog changes it - so "display text size" on the host's screen re-lays the projector
  // window on the other output of the same laptop, live, with nothing going near the room.
  // A projector driven by a different machine reads that machine's own preferences instead.
  if (browser) devicePreferences.attach();
  onDestroy(() => {
    devicePreferences.detach();
  });
  const device = $derived(devicePreferences.current);

  $effect(() => {
    roomAudio.enabled = device.displayAudio;
    roomAudio.setVolume(device.audioVolume);
  });

  function resolveRoomBuzzSound(playerId: string, entityId: string): string | null {
    // Team-scoped in teams mode (the leader-picked team sound), personal otherwise. The M3
    // server resolves this itself and ships it on the buzz-won message; the mock resolves
    // client-side with the same rule.
    const view = store.view;
    const team = view.roster.teams.find((entry) => entry.teamId === entityId);
    if (team !== undefined) return team.buzzSoundId;
    return view.roster.players.find((entry) => entry.playerId === playerId)?.buzzSoundId ?? null;
  }

  function onRoomEvent(event: GameEvent): void {
    // Room audio keys off buzz-won ALONE (exactly once per arming - the engine contract), so
    // overlap is structurally impossible; the exclusive slot in RoomAudio is the second belt.
    if (event.type === "buzz-won") {
      roomAudio.playBuzz(resolveRoomBuzzSound(event.playerId, event.entityId));
    }
  }

  const store = createRoomStore({
    roomCode,
    role: "display",
    timerAutopilot: browser,
    onEvent: onRoomEvent,
  });
  onDestroy(() => {
    store.destroy();
  });

  // Autoplay policy: the AudioContext needs a user gesture; a projector setup gets one
  // click while the host fullscreens the window.
  function primeAudio(): void {
    roomAudio.prime();
    audioReady = roomAudio.primed;
  }

  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );
  // The two presentation slots come from the THEME DOCUMENT (`theme.staging`,
  // `theme.environment` - packages/protocol/src/theme/theme.ts, wired at the 2026-08-16
  // reconcile). The query strings stay as DEV OVERRIDES and deliberately win, so a preset can
  // be reviewed against any stage without editing a document; neither ever ships in a link we
  // print. `environment` resolves through the display's own capability map: a theme naming
  // scenery whose kit has not shipped still renders on the studio stage.
  const stagingThemeId = $derived(page.url.searchParams.get("staging") ?? theme.staging ?? null);
  const environment = $derived(
    // "No 3D stage" is this device saying it cannot afford one - a laptop driving a projector
    // and a board at once - and it outranks the document, which is a wish, not a capability.
    device.stageMotion === "off"
      ? "none"
      : resolveDioramaEnvironment(page.url.searchParams.get("environment") ?? theme.environment),
  );
</script>

<svelte:head>
  <title>Display - Room {roomCode}</title>
  <!-- The display is not only a projector. A host checking the room from their hand must not
       get a broken page, so this route is responsive down to a phone (display-screen.svelte's
       compact block) and carries the same viewport meta the player route does. -->
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<svelte:window onpointerdown={primeAudio} />

<div
  class="display-shell"
  style="{themeToStyleAttribute(theme)}; {typeScaleStyle(device.displayTypeScale)}"
  data-effects={theme.effectsLevel}
>
  <DisplayScreen
    {store}
    {stagingThemeId}
    {environment}
    stageStill={device.stageMotion === "still"}
  />
  {#if !audioReady}
    <p class="audio-hint">Click anywhere to enable room audio on this device</p>
  {/if}
</div>

<style>
  /* A projector window is a fixed pane that never scrolls. A phone is not, so the shell drops
     out of fixed positioning at the same breakpoint the screen inside it goes compact - a
     fixed, inset-0 shell would trap the page at exactly one viewport height and hide
     everything below the fold. */
  .display-shell {
    position: fixed;
    inset: 0;
    background: var(--page-bg);
  }

  @media (max-width: 48rem), (max-height: 26rem) {
    .display-shell {
      position: static;
      min-height: 100dvh;
    }
  }

  .audio-hint {
    position: fixed;
    bottom: 0.6rem;
    right: 0.8rem;
    z-index: 50;
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--surface-text-muted);
    background: var(--surface-raised);
    border: 1px solid var(--surface-border);
    border-radius: var(--board-radius);
    padding: 0.25rem 0.6rem;
  }
</style>
