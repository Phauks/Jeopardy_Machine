<script lang="ts">
  // The player path (/room/CODE): the whole pre-game journey, then the buzzer.
  //
  //   character -> team -> lobby -> playing
  //
  // Which one is showing is `playerRouteStageFor` and nothing else (#lib/room/pre-game-stage.ts)
  // - a pure function of room state plus one local choice. Nothing here sets a screen variable,
  // which is what makes the unclicked transitions correct for free: a kick puts you back on the
  // team screen because your teamId went null, and the host starting the game puts every phone
  // on the buzzer wherever it happened to be.
  //
  // MOCK MODE until the M3 reconcile: the store is a local simulation seeded from the fixture
  // roster - each tab is its own isolated room (docs/design/surfaces.md). Players never see
  // accounts, installs, or prompts here - the room code in the URL is the entire join flow
  // (guiding principle 3).
  import { onDestroy } from "svelte";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import BuzzerScreen from "#lib/room/buzzer-screen.svelte";
  import CharacterScreen from "#lib/room/character-screen.svelte";
  import LobbyScreen from "#lib/room/lobby-screen.svelte";
  import TeamScreen from "#lib/room/team-screen.svelte";
  import { createRoomStore } from "#lib/room/create-room-store.ts";
  import { playerRouteStageFor } from "#lib/room/pre-game-stage.ts";
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

  // The only piece of screen state on this route, and it is a CHOICE rather than a position:
  // "I do not want a team". Everything else is derived (see pre-game-stage.ts for why).
  let soloAccepted = $state(false);

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
  const stage = $derived(playerRouteStageFor(view, { soloAccepted }));
</script>

<svelte:head>
  <title>Room {roomCode}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="room-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  {#if stage === "character"}
    <CharacterScreen
      {roomCode}
      roster={view.roster}
      teamsMode={view.teamsMode}
      lateJoin={view.phase !== "lobby"}
      onConfirm={(choice) => {
        localAudio.prime();
        // Deliberately joined WITHOUT a team: the next screen is where the team is picked, and
        // it needs you already standing in the holding area for the choice to be a visible
        // move rather than an appearance out of nowhere.
        store.join(choice);
      }}
      onPreviewSound={previewSound}
    />
  {:else if stage === "team"}
    <TeamScreen
      {store}
      {stagingThemeId}
      onPlaySolo={() => {
        soloAccepted = true;
      }}
    />
  {:else if stage === "lobby"}
    <LobbyScreen {store} {stagingThemeId} onPreviewSound={previewSound} />
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
