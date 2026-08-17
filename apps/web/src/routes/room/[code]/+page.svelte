<script lang="ts">
  // The player path (/room/CODE): ONE pre-game surface, then the buzzer.
  //
  // It used to be four screens in a chain - character -> team -> lobby -> playing - selected by
  // `playerRouteStageFor`. That is exactly what the standing UI law adopted on 2026-08-16
  // forbids (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md: "state changes
  // in place; it does not swap screens. No wizard chains."), so the three pre-game screens are
  // now three REGIONS of #lib/room/pre-game-screen.svelte and this route chooses between just
  // two things.
  //
  // The remaining swap is the exception the law names: the buzzer replacing the pre-game
  // surface is the GAME changing state, not navigation. `playerSurfaceFor` is still a pure
  // function of room state and nothing here sets a screen variable, which is what keeps the
  // unclicked transitions correct for free - the host starting the game moves every phone at
  // once, wherever it happened to be, and a kick just empties your teamId in a region that
  // never went away.
  //
  // MOCK MODE until the M3 reconcile: the store is a local simulation seeded from the fixture
  // roster - each tab is its own isolated room (docs/design/surfaces.md). Players never see
  // accounts, installs, or prompts here - the room code in the URL is the entire join flow
  // (guiding principle 3).
  import { onDestroy } from "svelte";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import BuzzerScreen from "#lib/room/buzzer-screen.svelte";
  import PreGameScreen from "#lib/room/pre-game-screen.svelte";
  import { createRoomStore } from "#lib/room/create-room-store.ts";
  import { playerSurfaceFor } from "#lib/room/pre-game.ts";
  import { RoomAudio } from "#lib/room/room-audio.ts";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";

  const roomCode = (page.params.code ?? "DUMYX").toUpperCase();
  const store = createRoomStore({
    roomCode,
    role: "player",
    timerAutopilot: browser,
  });
  onDestroy(() => {
    store.destroy();
  });

  // Local-only audio on the phone: previews and personal buzz feedback (never room audio -
  // the display route owns the room channel). Primed lazily from the first user gesture.
  const localAudio = new RoomAudio({ enabled: false });
  function previewSound(soundId: string): void {
    localAudio.prime();
    localAudio.playLocalPreview(soundId);
  }

  // Which staging theme the phone's staged views use is the THEME DOCUMENT's `staging` slot
  // (packages/protocol/src/theme/theme.ts), wired at the 2026-08-16 reconcile. ?theme= and
  // ?staging= remain dev overrides and win over the document, so any preset can be reviewed
  // against any stage; neither ever ships in a link we print.
  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );
  const stagingThemeId = $derived(page.url.searchParams.get("staging") ?? theme.staging ?? null);

  const view = $derived(store.view);
  const surface = $derived(playerSurfaceFor(view));
</script>

<svelte:head>
  <title>Room {roomCode}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="room-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  {#if surface === "pre-game"}
    <PreGameScreen
      {store}
      {roomCode}
      {stagingThemeId}
      onPreviewSound={previewSound}
      onBeforeJoin={() => {
        localAudio.prime();
      }}
    />
  {:else}
    <BuzzerScreen
      {store}
      onLocalBuzzFeedback={() => {
        // The pressing phone's private feedback: in teams mode the room hears the TEAM sound
        // from the display; this local click is what the presser feels regardless.
        localAudio.prime();
        localAudio.playLocalPreview(
          view.roster.players.find((entry) => entry.playerId === view.myPlayerId)?.buzzSoundId ??
            null,
        );
      }}
    />
  {/if}
</div>

<style>
  .room-shell {
    min-height: 100dvh;
    background: var(--page-bg);
    color: var(--surface-text);
  }
</style>
