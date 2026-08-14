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
  import { RoomAudio } from "#lib/room/room-audio.ts";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import type { GameEvent } from "@jeopardy/engine/events";

  const roomCode = (page.params.code ?? "DUMYX").toUpperCase();

  const roomAudio = new RoomAudio({ enabled: true });
  let audioReady = $state(false);

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
</script>

<svelte:head>
  <title>Display - Room {roomCode}</title>
</svelte:head>

<svelte:window onpointerdown={primeAudio} />

<div class="display-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  <DisplayScreen {store} />
  {#if !audioReady}
    <p class="audio-hint">Click anywhere to enable room audio on this device</p>
  {/if}
</div>

<style>
  .display-shell {
    position: fixed;
    inset: 0;
    background: var(--page-bg);
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
