<script lang="ts">
  // The player path (/room/CODE): A2 join -> A3 lobby -> A4 buzzer, one route whose stage
  // derives from room-store state. MOCK MODE until the M3 reconcile: the store is a local
  // simulation seeded from the fixture roster - each tab is its own isolated room (see
  // docs/design/surfaces.md). Players never see accounts, installs, or prompts here - the
  // room code in the URL is the entire join flow (guiding principle 3).
  import { onDestroy } from "svelte";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import BuzzerScreen from "#lib/room/buzzer-screen.svelte";
  import JoinScreen from "#lib/room/join-screen.svelte";
  import LobbyScreen from "#lib/room/lobby-screen.svelte";
  import { createRoomStore } from "#lib/room/create-room-store.ts";
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

  // Dev affordance shared by the play surfaces: ?theme=modern-flat previews any preset
  // (theme documents attach per game at M5; the query never ships in links we print).
  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );

  const view = $derived(store.view);
  const joined = $derived(view.myPlayerId !== null);
</script>

<svelte:head>
  <title>Room {roomCode}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div
  class="room-shell"
  style={themeToStyleAttribute(theme)}
  data-effects={theme.effectsLevel}
>
  {#if !joined}
    <JoinScreen
      {roomCode}
      roster={view.roster}
      teamsMode={view.teamsMode}
      onJoin={(request) => {
        localAudio.prime();
        store.join(request);
      }}
      onPreviewSound={previewSound}
    />
  {:else if view.phase === "lobby"}
    <LobbyScreen {store} onPreviewSound={previewSound} />
  {:else}
    <BuzzerScreen
      {store}
      onLocalBuzzFeedback={() => {
        // The pressing phone's private feedback: in teams mode the room hears the TEAM sound
        // from the display; this local click is what the presser feels regardless.
        localAudio.prime();
        localAudio.playLocalPreview(view.roster.players.find((entry) => entry.playerId === view.myPlayerId)?.buzzSoundId ?? null);
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
