<script lang="ts">
  // The site root, and now the ONLY front door: joining, browsing and creating are one screen
  // (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, "Landing and lobby").
  // /lobby was folded back in here and deleted outright - no redirect, per the no-legacy
  // directive (docs/research/00-user-directives.md).
  //
  // The SCREEN lives in #lib/landing/front-door.svelte so it server-renders in a test like
  // every other surface; this route owns the four things a component should not: polling the
  // listing, reading this browser's room memory, creating rooms, and navigating.
  import BuildBadge from "#lib/dev/build-badge.svelte";
  import FrontDoor from "#lib/landing/front-door.svelte";
  import {
    hostUrlForRoom,
    joinUrlForRoom,
    rememberHostToken,
    rememberRoomPassword,
  } from "#lib/lobby/join-hand-off.ts";
  import {
    blankCreateForm,
    createRoomBody,
    describeCreateFailure,
    handOffAfterCreate,
    withPlayerMode,
  } from "#lib/landing/create-room-request.ts";
  import { devSurfaces } from "#lib/landing/surface-cards.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import { probeRoomLiveness } from "#lib/lobby/room-liveness.ts";
  import { readRememberedRooms, forgetRoom, rememberRoom } from "#lib/lobby/room-memory.ts";
  import { retroTvPreset, themePresets } from "#lib/theme/theme-presets.ts";
  import { themeToStyleAttribute } from "#lib/theme/theme-to-css.ts";
  import { page } from "$app/state";
  import type { CreateRoomResponse } from "@jeopardy/protocol/room/create";
  import type { CreateState } from "#lib/landing/create-room-panel.svelte";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";
  import type { RejoinCandidate } from "#lib/lobby/room-liveness.ts";

  // ---- the public listing --------------------------------------------------------------

  // The registry starts "unavailable/error" rather than "ok": until the first fetch answers,
  // an empty list has no verdict behind it, and claiming one would be the old bug in reverse.
  let listing = $state<LobbyListing>({
    rooms: [],
    fetchedAt: Date.now(),
    registry: { status: "unavailable", reason: "error", detail: "not fetched yet" },
  });
  let listingError = $state<string | null>(null);
  let listingLoaded = $state(false);

  async function refreshListing(): Promise<void> {
    try {
      const response = await fetch("/api/rooms");
      if (!response.ok) throw new Error(`listing responded ${String(response.status)}`);
      listing = (await response.json()) as LobbyListing;
      listingError = null;
    } catch (error) {
      // A list that cannot load is a non-event: the code box still works, which is the path
      // that matters (guiding principle 3).
      listingError = error instanceof Error ? error.message : String(error);
    }
    // The list stamps itself with the SERVER's fetchedAt (room-browser.svelte prints it as a
    // wall clock), so nothing here has to keep a ticking clock alive to stay honest.
    listingLoaded = true;
  }

  $effect(() => {
    void refreshListing();
    const timer = setInterval(() => void refreshListing(), limits.lobby.listingRefreshMs);
    return () => clearInterval(timer);
  });

  // ---- rejoin memory ---------------------------------------------------------------------

  let rejoins = $state<RejoinCandidate[]>([]);

  $effect(() => {
    // Read synchronously on mount so the offer is drawn in the first client frame rather than
    // appearing under someone's thumb a moment later; the liveness verdict then changes the
    // card IN PLACE (the standing layout law). sessionStorage only - no account, no server.
    const remembered = readRememberedRooms();
    rejoins = remembered.map((room) => ({ ...room, verdict: "unknown" as const }));
    void Promise.all(
      remembered.map(async (room) => {
        const verdict = await probeRoomLiveness(room.code);
        if (verdict === "gone") {
          // A room that has genuinely ended cleans itself up without a word - an offer to
          // rejoin a finished game is worse than no offer at all.
          forgetRoom(room.code);
          rejoins = rejoins.filter((candidate) => candidate.code !== room.code);
          return;
        }
        // Updated IN PLACE (the layout law, applied to the data too): the card keeps its
        // identity and its position, and only its own state changes.
        const candidate = rejoins.find((entry) => entry.code === room.code);
        if (candidate !== undefined) candidate.verdict = verdict;
      }),
    );
  });

  // ---- creating a room -------------------------------------------------------------------

  const createForm = $state(blankCreateForm());
  let createState = $state<CreateState>({ status: "idle" });

  async function createRoom(): Promise<void> {
    createState = { status: "creating" };
    try {
      // Dynamic: the sample game drags the content schema and the engine's setup path behind
      // it, and the front door must not carry that weight for the visitors who only came to
      // type a code. It is fetched at the moment of the tap and never before.
      const { sampleGameDefinition } = await import("#lib/hotseat/sample-game.ts");
      // The host's individuals-or-teams choice rides on the GAME, not on the room: teams mode
      // is a rule (create-room-request.ts, withPlayerMode), so it travels with the document
      // and a room never holds a second copy of the same fact.
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          createRoomBody(createForm, {
            kind: "definition",
            body: withPlayerMode(sampleGameDefinition.body, createForm.playerMode),
          }),
        ),
      });
      if (!response.ok) {
        const refusal = (await response.json().catch(() => null)) as { error?: string } | null;
        createState = {
          status: "failed",
          message: describeCreateFailure(response.status, refusal?.error ?? null),
        };
        return;
      }
      const created = (await response.json()) as CreateRoomResponse;
      // The creation token rides sessionStorage to the console, never the URL (join-hand-off.ts
      // documents why), and this tab remembers the room so the front door can offer it back.
      rememberHostToken(created.code, created.hostToken);
      rememberRoomPassword(created.code, createForm.password);
      rememberRoom({
        code: created.code,
        title: created.settings.title,
        role: "host",
        at: Date.now(),
      });
      const decision = handOffAfterCreate(created);
      if (decision.handOff) {
        globalThis.location.assign(hostUrlForRoom(created.code));
        return;
      }
      createState = {
        status: "held",
        code: created.code,
        warning: decision.warning ?? "",
        registry: created.registry,
      };
    } catch (error) {
      createState = {
        status: "failed",
        message: `Creating the room failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ---- going somewhere -------------------------------------------------------------------

  function enterRoom(code: string, password: string, title: string): void {
    let destination: string;
    try {
      destination = joinUrlForRoom(code);
    } catch {
      listingError = `That is not a room code - they are ${String(limits.room.roomCodeLength)} letters and digits.`;
      return;
    }
    rememberRoomPassword(code, password);
    rememberRoom({ code, title, role: "player", at: Date.now() });
    globalThis.location.assign(destination);
  }

  /** A typed code may name a room that is on screen: borrow its title for the memory entry. */
  function titleForCode(code: string): string {
    return listing.rooms.find((room) => room.code === code.toUpperCase())?.title ?? "";
  }

  // Same dev affordance the play surfaces carry: ?theme=<preset-id> previews any preset, so
  // the front door is checked against all four the same way the board is.
  const theme = $derived(
    themePresets.find((preset) => preset.id === page.url.searchParams.get("theme")) ??
      retroTvPreset,
  );
</script>

<svelte:head>
  <title>Jeopardy Machine</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="root-shell" style={themeToStyleAttribute(theme)} data-effects={theme.effectsLevel}>
  <FrontDoor
    initialCode={page.url.searchParams.get("code") ?? ""}
    {listing}
    {listingError}
    {listingLoaded}
    {rejoins}
    {createForm}
    {createState}
    surfaces={devSurfaces}
    onJoin={(code, password) => {
      enterRoom(code, password, titleForCode(code));
    }}
    onJoinRoom={(room: RoomSummary, password: string) => {
      enterRoom(room.code, password, room.title);
    }}
    onRejoin={(room) => {
      globalThis.location.assign(
        room.role === "host" ? hostUrlForRoom(room.code) : joinUrlForRoom(room.code),
      );
    }}
    onCreate={() => void createRoom()}
    onContinueCreate={(code) => {
      globalThis.location.assign(hostUrlForRoom(code));
    }}
    onRefreshListing={() => void refreshListing()}
  />
</div>

<BuildBadge />

<style>
  .root-shell {
    min-height: 100dvh;
    background: var(--page-bg);
    color: var(--surface-text);
  }
</style>
