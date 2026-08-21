<script lang="ts">
  // The host console route (/room/CODE/host): the C4 instrument panel with mirror mode
  // (?mirror starts in it) and the dev-only sim panel.
  //
  // A REAL room since the 2026-08-17 reconcile: the console joins the code's GameRoomDO as
  // role=host, holding the creation token the front door stashed at create
  // (#lib/lobby/join-hand-off.ts). That token is the room's strongest secret and it lives in
  // THIS TAB's sessionStorage - so a console opened in a tab that did not create the room has
  // no way to prove itself, and this route says so plainly instead of rendering a panel whose
  // every button would be refused. The demo code still gets the local simulation, sim panel
  // and all, which is what makes the screens reviewable without a server.
  import { onDestroy } from "svelte";
  import { browser, dev } from "$app/env";
  import { page } from "$app/state";
  import HomeButton from "#lib/chrome/home-button.svelte";
  import HostConsole from "#lib/room/host-console.svelte";
  import { createRoomStore, roomStoreModeFor, seedRosterFor } from "#lib/room/create-room-store.ts";
  import { devicePreferences } from "#lib/host-settings/device-preferences.svelte.ts";
  import { recallHostToken } from "#lib/lobby/join-hand-off.ts";
  import { RoomAudio } from "#lib/room/room-audio.ts";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";

  const roomCode = (page.params.code ?? "DUMYX").toUpperCase();
  const simOverride = page.url.searchParams.has("sim");
  const mode = roomStoreModeFor(roomCode, simOverride);
  // Read once, at construction, because that is when the socket needs it. Empty during SSR
  // (there is no sessionStorage there), which is why the missing-token screen below is gated
  // on `browser` too - a server-rendered frame must not accuse anyone of anything.
  const hostToken = browser && mode === "ws" ? recallHostToken(roomCode) : "";
  const tokenMissing = $derived(browser && mode === "ws" && hostToken === "");

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

  const store = createRoomStore({
    roomCode,
    // The dummy roster belongs to the fixture room and to ?demo, never to a code somebody just
    // created (create-room-store.ts): a real room starts empty and says so.
    seedRoster: seedRosterFor(roomCode, page.url),
    role: "host",
    ...(simOverride && { mode: "local-sim" as const }),
    timerAutopilot: browser,
    // A console with no token still opens its socket in a demo room; in a real one it would
    // only be refused, so the dial waits until there is something to prove.
    autoConnect: browser && (mode === "local-sim" || hostToken !== ""),
    hostToken,
    onBuzzWon: (buzz) => {
      consoleAudio.playBuzz(buzz.buzzSoundId);
    },
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

  // ?mirror forces the mirrored layout for THIS render whatever the device prefers - a link a
  // host can hand to a second machine. The lasting choice is the device's `screenSetup`
  // preference, which the console's game-screen panel sets (src/lib/room/game-screen.ts).
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
  {#if tokenMissing}
    <!-- Not an error screen: nothing went wrong, this BROWSER simply is not the one that made
         the room. Rewritten 2026-08-19 with the storage change behind it: a crashed tab used to
         land here and be told to start over, which for a room mid-game is the worst advice this
         app could give. The key now survives the tab, so reopening this console after a crash
         is the ordinary path and this screen is the genuinely-wrong-device one. -->
    <section class="no-token" aria-label="Host console unavailable">
      <h1>This browser cannot host room {roomCode}</h1>
      <p>
        A room is hosted by the browser that created it. The key is kept there and nowhere else
        - not in a link, not in your account, because there is no account - so a console opened
        on another device has nothing to prove it is the host with.
      </p>
      <ul>
        <li>Made the room on another laptop or phone? Open this page there - the console comes
          back, game and all, even if the browser has been closed and reopened since.</li>
        <li>Hosted it here days ago? The key expires with the room, and the room is gone.</li>
        <li>You can watch this room without hosting it: open <code>/room/{roomCode}</code>
          and join as a player.</li>
      </ul>
      <HomeButton variant="inline" />
    </section>
  {:else}
    <HostConsole
      {store}
      showSimPanel={dev}
      joinOrigin={page.url.origin}
      mirror={startInMirror}
      settingsOpen={startWithSettings}
      themeId={theme.id}
    />
  {/if}
</div>

<style>
  .host-shell {
    min-height: 100dvh;
    background: var(--surface-page);
  }

  .no-token {
    max-width: 46rem;
    margin: 0 auto;
    padding: clamp(2rem, 8vh, 5rem) 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    color: var(--surface-text);
  }

  .no-token h1 {
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin: 0;
  }

  .no-token p,
  .no-token li {
    margin: 0;
    line-height: 1.6;
    color: var(--surface-text-muted);
  }

  .no-token ul {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding-left: 1.2rem;
  }

  .no-token code {
    font-family: var(--font-chrome);
    color: var(--surface-text);
  }
</style>
