<script lang="ts">
  // M0 landing stub. The real landing is the creator Library (docs/design/user-flows.md B1);
  // until M1 exists this page only proves the app builds, serves, and can reach the realtime
  // Worker (via the /dev/echo page).
</script>

<svelte:head>
  <title>Jeopardy Machine</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
  <h1 class="text-3xl font-bold">Jeopardy Machine</h1>
  <p class="text-lg">
    A free, self-hosted quiz-show game suite. Nothing to see yet - this is the M0 foundation
    build: monorepo, protocol package, realtime Worker, and this app shell.
  </p>
  <p>
    <a class="underline" href="/dev/echo">Dev: WebSocket echo check</a>
    - proves the local two-Worker dev loop end to end.
  </p>
  <p>
    <a class="underline" href="/dev/theme">Dev: theme gallery</a>
    - board + presets + avatars on the live token contract (M4 phase 1).
  </p>
  <p>
    <a class="underline" href="/dev/hotseat">Dev: hotseat</a>
    - keyboard-driven full game against the engine, no server (M2 exit criteria).
  </p>
  <p class="mt-2 font-bold">M4 play surfaces (mock rooms until the M3 reconcile - each tab is
    its own simulated room seeded from the fixture dataset; docs/design/surfaces.md):</p>
  <p>
    <a class="underline" href="/room/DUMYX">Player: /room/DUMYX</a>
    - A2 join, A3 lobby, A4 buzzer (open on a phone; ?theme=modern-flat previews presets).
  </p>
  <p>
    <a class="underline" href="/room/DUMYX/display">Display: /room/DUMYX/display</a>
    - projector board: title screen + QR, category reveal, clue card, winner screen.
  </p>
  <p>
    <a class="underline" href="/room/DUMYX/host">Host: /room/DUMYX/host</a>
    - C4 console incl. mirror mode (?mirror) and the dev sim panel driving fake players.
  </p>
</main>
