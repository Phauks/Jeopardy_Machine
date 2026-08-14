<script lang="ts">
  // The landing page. Two halves, in this order:
  //
  // 1. JOIN - the real product surface (docs/decisions/2026-08-14-room-visibility-and-lobby.md):
  //    a room-code box, a password field, and the public rooms list. The CODE BOX ALWAYS WINS:
  //    a complete typed code bypasses the list entirely, because someone holding a code came
  //    here to use it, not to browse. The list polls on an interval - browsing is not playing,
  //    so it gets no socket.
  // 2. The dev-surface index below it - OWNER RULE: every new meaningful surface gets a card
  //    here in the same PR that ships it. (The creator Library, user-flows B1, eventually
  //    replaces the index; the Join half is already the landing it will sit beside.)
  import BuildBadge from "#lib/dev/build-badge.svelte";
  import PublicRoomsList from "#lib/lobby/public-rooms-list.svelte";
  import { joinUrlForRoom, rememberRoomPassword } from "#lib/lobby/join-hand-off.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { LobbyListing, RoomSummary } from "@jeopardy/protocol/room/registry";

  let typedCode = $state("");
  let password = $state("");
  let listing = $state<LobbyListing>({ rooms: [], fetchedAt: Date.now() });
  let listingError = $state<string | null>(null);

  const normalizedCode = $derived(typedCode.trim().toUpperCase());
  const codeComplete = $derived(normalizedCode.length === limits.room.roomCodeLength);

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

  function enterRoom(code: string, roomPassword: string): void {
    let destination: string;
    try {
      destination = joinUrlForRoom(code);
    } catch {
      listingError = "That is not a room code - they are 5 letters and digits.";
      return;
    }
    rememberRoomPassword(code, roomPassword);
    globalThis.location.assign(destination);
  }

  function joinTypedCode(event: SubmitEvent): void {
    event.preventDefault();
    if (!codeComplete) return;
    enterRoom(normalizedCode, password);
  }

  // Picking a listed room reuses whatever is in the password box - a locked room in the list
  // is exactly the case where someone was told the password out loud.
  function joinListedRoom(room: RoomSummary): void {
    enterRoom(room.code, password);
  }

  const surfaces = [
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
      href: "/dev/echo",
      title: "Realtime room harness",
      note: "Create a real room (public/unlisted, with or without a password), list the live public rooms, connect through the single origin, join as host/player/spectator, and probe refusals.",
    },
    {
      href: "/api/rooms",
      title: "/api/rooms",
      note: "The public lobby listing as JSON: live public rooms, newest first, capped and briefly cached.",
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
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
  <div>
    <h1 class="text-3xl font-bold">Jeopardy Machine</h1>
    <p class="mt-2 text-lg">
      A free, self-hosted quiz-show game suite - in the foundation phase. No account, ever:
      a room code is the whole join flow.
    </p>
  </div>

  <section class="flex flex-col gap-3 rounded-sm border p-4">
    <h2 class="text-xl font-bold">Join a room</h2>
    <form class="flex flex-wrap items-end gap-3" onsubmit={joinTypedCode}>
      <label class="flex flex-col gap-1">
        <span class="text-sm">Room code</span>
        <input
          class="w-32 border px-2 py-1 text-lg uppercase"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          maxlength={limits.room.roomCodeLength}
          placeholder="BQKX7"
          bind:value={typedCode}
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm">Password (only if the room has one)</span>
        <input
          class="w-56 border px-2 py-1"
          type="password"
          autocomplete="off"
          maxlength={limits.room.roomPasswordMaxLength}
          bind:value={password}
        />
      </label>
      <button class="border px-4 py-1.5 font-bold" disabled={!codeComplete} type="submit">
        Join
      </button>
    </form>

    <h3 class="mt-2 text-sm font-bold">
      Public rooms
      {#if listing.rooms.length > 0}({listing.rooms.length}){/if}
    </h3>
    {#if listingError !== null}
      <p class="text-sm opacity-70">
        The public list is unavailable right now ({listingError}). A room code still works.
      </p>
    {/if}
    <PublicRoomsList
      rooms={listing.rooms}
      fetchedAt={listing.fetchedAt}
      dimmed={codeComplete}
      onSelect={joinListedRoom}
    />
    {#if codeComplete}
      <p class="text-sm opacity-70">Using the code you typed - clear it to browse the list.</p>
    {/if}
  </section>

  <div>
    <h2 class="text-xl font-bold">What exists so far</h2>
    <p class="mt-1 text-sm opacity-80">
      The editor, play surfaces, and host console arrive milestone by milestone.
    </p>
  </div>

  <ul class="flex flex-col gap-3">
    {#each surfaces as surface (surface.href)}
      <li class="rounded-sm border p-4">
        <a class="text-lg font-bold underline" href={surface.href}>{surface.title}</a>
        <p class="mt-1 text-sm opacity-80">{surface.note}</p>
      </li>
    {/each}
  </ul>

  <p class="text-sm opacity-70">
    Build {__BUILD_META__.sha} · {__BUILD_META__.builtAt.slice(0, 16).replace("T", " ")}Z ·
    <a class="underline" href="https://github.com/Phauks/Jeopardy_Machine">source</a>
  </p>
</main>

<BuildBadge />
