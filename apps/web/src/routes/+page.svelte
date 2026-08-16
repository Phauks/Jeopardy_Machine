<script lang="ts">
  // The site root. The SCREEN lives in #lib/landing/landing-screen.svelte (so it can be
  // server-rendered in a test like every other surface); this route owns the two things a
  // component should not: polling the lobby endpoint, and navigating.
  //
  // OWNER RULE, still in force: every new meaningful surface gets a card in the list below, in
  // the same PR that ships it. The list moved into a closed drawer on 2026-08-15 when the real
  // front door was built - demoted, not deleted. (The creator Library, user-flows B1, is what
  // eventually replaces it.)
  import BuildBadge from "#lib/dev/build-badge.svelte";
  import LandingScreen from "#lib/landing/landing-screen.svelte";
  import { joinUrlForRoom, rememberRoomPassword } from "#lib/lobby/join-hand-off.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import { page } from "$app/state";
  import type { LobbyListing } from "@jeopardy/protocol/room/registry";
  import type { SurfaceCard } from "#lib/landing/landing-screen.svelte";

  // The registry starts "unavailable/error" rather than "ok": until the first fetch answers,
  // an empty list has no verdict behind it, and claiming one would be the old bug in reverse.
  let listing = $state<LobbyListing>({
    rooms: [],
    fetchedAt: Date.now(),
    registry: { status: "unavailable", reason: "error", detail: "not fetched yet" },
  });
  let listingError = $state<string | null>(null);

  async function refreshListing(): Promise<void> {
    try {
      const response = await fetch("/api/rooms");
      if (!response.ok) throw new Error(`lobby responded ${String(response.status)}`);
      listing = (await response.json()) as LobbyListing;
      listingError = null;
    } catch (error) {
      // A lobby that cannot load is a non-event: the code box still works, which is the
      // path that matters (guiding principle 3).
      listingError = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    void refreshListing();
    const timer = setInterval(() => void refreshListing(), limits.lobby.listingRefreshMs);
    return () => clearInterval(timer);
  });

  function enterRoom(code: string, password: string): void {
    let destination: string;
    try {
      destination = joinUrlForRoom(code);
    } catch {
      listingError = `That is not a room code - they are ${String(limits.room.roomCodeLength)} letters and digits.`;
      return;
    }
    rememberRoomPassword(code, password);
    globalThis.location.assign(destination);
  }

  // Same dev affordance the play surfaces carry: ?theme=<preset-id> previews any preset, so
  // the front door is checked against all four the same way the board is.
  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );

  const surfaces: SurfaceCard[] = [
    {
      href: "/lobby",
      title: "Public rooms",
      note: "The room browser: title and host label, players and spectators against caps, lock icon, phase badge, age - with the password prompt inline on a locked room.",
    },
    {
      href: "/dev/hotseat",
      title: "Hotseat game",
      note: "Play a full two-round game + final, keyboard-driven, no server (M2 engine). S starts, A arms, 1-8 buzz, C/W/N judge, U undo.",
    },
    {
      href: "/dev/theme",
      title: "Theme gallery",
      note: "Four presets on the live token contract - board, type, swatches, emblems, effects toggle (M4 phase 1).",
    },
    {
      href: "/dev/rooms",
      title: "Room instrument panel",
      note: "Three-column room console: create/delete rooms and see every one this tab made, connect and join through the single origin with a live DO inspector, watch the auto-refreshing public lobby with the registry's health stated out loud, and run the refusal probes in the test area.",
    },
    {
      href: "/dev/diorama",
      title: "Avatar diorama",
      note: "The live 3D scene with fake players: free-wander mode and the staged lobby (boats and campfires), switch themes, fire a buzz beat, flip to the winner scene - without hosting a game.",
    },
    {
      href: "/api/rooms",
      title: "/api/rooms",
      note: "The public lobby listing as JSON: live public rooms, newest first, capped and briefly cached.",
    },
    {
      href: "/room/DUMYX",
      title: "Player room",
      note: "The pre-game journey on a phone: character selector (A2), team joining, A3 lobby with the staged view, then the A4 buzzer (M4 mock room; ?theme=modern-flat previews presets).",
    },
    {
      href: "/room/DUMYX/display",
      title: "Display screen",
      note: "Projector board: title screen + QR, category reveal, clue card, winner screen - with the staged 3D lobby on lobby and winner phases. Works on a phone too.",
    },
    {
      href: "/room/DUMYX/host",
      title: "Host console",
      note: "C4 console incl. mirror mode (?mirror) and the dev sim panel driving fake players.",
    },
    {
      href: "/api/version",
      title: "/api/version",
      note: "Deployment identity as JSON: commit, build time, wire protocol version.",
    },
  ];
</script>

<svelte:head>
  <title>Jeopardy Machine</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="root-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  <LandingScreen {listing} {listingError} {surfaces} onJoin={enterRoom} />
</div>

<BuildBadge />

<style>
  .root-shell {
    min-height: 100dvh;
    background: var(--page-bg);
    color: var(--surface-text);
  }
</style>
