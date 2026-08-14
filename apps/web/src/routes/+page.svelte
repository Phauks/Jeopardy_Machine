<script lang="ts">
  // Pre-product landing: the real landing is the creator Library (user-flows B1, arrives
  // with the M1 editor). Until then this page is the up-to-date index of what exists -
  // OWNER RULE: every new meaningful surface gets a card here in the same PR that ships it.
  import BuildBadge from "#lib/dev/build-badge.svelte";

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
      href: "/dev/diorama",
      title: "Avatar diorama",
      note: "The live 3D lobby scene with fake players: add avatars, switch themes, fire a buzz beat, flip to the winner scene - without hosting a game.",
    },
    {
      href: "/dev/echo",
      title: "Realtime harness",
      note: "WebSocket lab against the GameRoomDO stub: latency, ordering bursts, hibernation probe, malformed input, reconnect tools.",
    },
    {
      href: "/room/DUMYX",
      title: "Player room",
      note: "A2 join, A3 lobby, A4 buzzer - open on a phone (M4 mock room seeded from the fixture dataset; ?theme=modern-flat previews presets).",
    },
    {
      href: "/room/DUMYX/display",
      title: "Display screen",
      note: "Projector board: title screen + QR, category reveal, clue card, winner screen - with the live 3D avatar diorama on lobby and winner phases.",
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
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
  <div>
    <h1 class="text-3xl font-bold">Jeopardy Machine</h1>
    <p class="mt-2 text-lg">
      A free, self-hosted quiz-show game suite - in the foundation phase. The editor, rooms,
      and play surfaces arrive milestone by milestone; below is everything that exists so far.
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
