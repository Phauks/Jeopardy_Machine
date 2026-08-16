<script lang="ts">
  // /lobby - the public room browser. The SCREEN is #lib/lobby/lobby-screen.svelte; this route
  // owns polling and navigation, the same split the landing page uses.
  //
  // No socket by design: browsing is not playing (the decision doc's rule), so this polls on
  // limits.lobby.listingRefreshMs and the response is briefly edge-cached.
  import BuildBadge from "#lib/dev/build-badge.svelte";
  import LobbyScreen from "#lib/lobby/lobby-screen.svelte";
  import { joinUrlForRoom, rememberRoomPassword } from "#lib/lobby/join-hand-off.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import { page } from "$app/state";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

  let listing = $state<LobbyListing>({
    rooms: [],
    fetchedAt: Date.now(),
    registry: { status: "unavailable", reason: "error", detail: "not fetched yet" },
  });
  let listingError = $state<string | null>(null);
  // Distinguishes "no rooms" from "no answer yet" - the screen renders a different state for
  // each, which is the whole point of this page existing.
  let loaded = $state(false);
  let now = $state(Date.now());

  async function refreshListing(): Promise<void> {
    try {
      const response = await fetch("/api/rooms");
      if (!response.ok) throw new Error(`lobby responded ${String(response.status)}`);
      listing = (await response.json()) as LobbyListing;
      listingError = null;
    } catch (error) {
      listingError = error instanceof Error ? error.message : String(error);
    }
    loaded = true;
    now = Date.now();
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
      listingError = "That is not a room code.";
      return;
    }
    rememberRoomPassword(code, password);
    globalThis.location.assign(destination);
  }

  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );
</script>

<svelte:head>
  <title>Public rooms</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="lobby-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  <LobbyScreen
    {listing}
    {listingError}
    {loaded}
    {now}
    onJoinRoom={(room: RoomSummary, password: string) => {
      enterRoom(room.code, password);
    }}
    onJoinCode={enterRoom}
    onRefresh={() => void refreshListing()}
  />
</div>

<BuildBadge />

<style>
  .lobby-shell {
    min-height: 100dvh;
    background: var(--page-bg);
    color: var(--surface-text);
  }
</style>
