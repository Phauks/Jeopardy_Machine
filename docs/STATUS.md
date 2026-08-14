# Status

> Stamp: verified against the M3.5 room-visibility/lobby work, 2026-08-14 UTC. Prefer the reproduce-commands over the copied numbers - if they disagree, this file is stale; fix it in the same commit as whatever changed.

## Live state

| Claim                                                                                                                            | Reproduce                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace installs clean (pnpm 10.33.0, Node 22)                                                                                 | `pnpm install --frozen-lockfile`                                                                                                                                               |
| All tests green: 5 packages, 473 tests (184 protocol, 170 engine, 6 bots, 52 web, 61 realtime-in-workerd)                        | `pnpm test`                                                                                                                                                                    |
| Typechecks green (svelte-check + tsc, incl. service-worker project)                                                              | `pnpm check`                                                                                                                                                                   |
| Lint + format gates green                                                                                                        | `pnpm lint && pnpm exec vp fmt --check`                                                                                                                                        |
| Web app builds through adapter-cloudflare; realtime bundles via dry-run deploy                                                   | `pnpm build`                                                                                                                                                                   |
| M1 document layer live: 4 portable formats parse through one entry point                                                         | `pnpm -F @jeopardy/protocol test` (`parsePortableDocument`; migration machinery proven by the fixture-gated example migration)                                                 |
| M2 engine live: pure state machine, matrix rows cited in test names, undo-by-replay, seeded determinism                          | `pnpm -F @jeopardy/engine test` (fixture catalog under `packages/engine/fixtures/` replays twice per scenario)                                                                 |
| A full game plays locally with NO server (M2 exit criteria)                                                                      | `pnpm dev`, open http://localhost:5173/dev/hotseat (headless proof: `apps/web/src/lib/hotseat/sample-game.test.ts` drives 60 cells + final to game-over)                       |
| M3 room server live: explicit create, engine feed, sessions, teams, alarms - proven against real eviction                        | `pnpm -F @jeopardy/realtime test` (workerd suite incl. `evictDurableObject` mid-game, expiry via `runDurableObjectAlarm`, bot players on real sockets)                         |
| Single-origin WS passthrough works on the pinned kit/adapter (M3 week-1 risk: resolved, no fallback needed)                      | build + multi-config `wrangler dev`, then `node apps/web/scripts/prove-single-origin.mjs` (decision addendum: docs/decisions/2026-08-13-single-origin-binding.md)              |
| M3 exit criteria: real-browser phones + display + host, deterministic buzz race, roster sync, harness flow                       | `pnpm -F @jeopardy/web test:e2e` (2 Playwright multi-context tests; needs a local chromium - docs/DEVELOPMENT.md "End to end")                                                 |
| Bot players speak the real room protocol (seeded, reproducible); a bots-only game plays to game-over                             | `pnpm -F @jeopardy/bots test`; live: `pnpm -F @jeopardy/bots bots -- --origin http://localhost:8788 --create --count 5 --host` against the single-origin dev loop              |
| Browser-facing room harness: create, join roles, uncreated-room PASS probe, hibernation ping                                     | single-origin dev loop (docs/DEVELOPMENT.md), open http://localhost:8788/dev/echo                                                                                              |
| Room visibility + passwords live: listing and entry are independent axes, PBKDF2-verified in the DO, rate-limited per connection | `pnpm -F @jeopardy/realtime exec vitest run test/passwords.test.ts`                                                                                                            |
| The public lobby lists live public rooms from D1 (registry rows are a cache; the DO refuses dead rooms regardless)               | `pnpm -F @jeopardy/realtime exec vitest run test/registry.test.ts` (real D1 + the web app's migration); browser: the Join section on `/` and the harness's "List public rooms" |
| Clue content, host pause/force-expire, and the polite close/kick reasons are on the wire (M4 reconcile)                          | `pnpm -F @jeopardy/realtime exec vitest run test/host-controls.test.ts`                                                                                                        |
| Generated settings reference is current (registry-derived, drift-gated)                                                          | `pnpm -F @jeopardy/protocol generate:settings-docs && git diff --exit-code docs/reference/settings.md`                                                                         |

## For M4 (the client store contract)

The surfaces build on what the DO already speaks (all shapes in `packages/protocol/src/room/`):

- Connect to `wss://<origin>/room/<CODE>/ws`, send `join` (or `resume` with the sessionStorage token), receive `welcome` + `snapshot`, then apply `event` batches in order; `stateVersion` gaps mean a missed message - send `sync` for a fresh snapshot.
- `snapshot.game` is the engine `GameState` redacted per role (cast to the engine type); roster/team payloads arrive whole on every change - no diffing client-side.
- Room audio keys off the room-level `buzz-won` message ONLY (it carries the resolved team-scoped sound id); `buzz-rejected` is private per-phone feedback.
- Engine timer bars render from `timer-set` events; ordinary expiries are server-driven (the DO's alarm book) - clients never dispatch timeout actions. The host console's "skip the wait" is the `expire-timer` message, and its pause button is `set-pause` (both host-only; pause freezes every running timer at the time it had left).
- Authored clue text arrives on `clue-content` (and on `snapshot.clueContent` while a clue is open), redacted per role: the ANSWER is host-only; the prompt reaches phones only when the room's `clueTextOnPhones` setting is on.
- `room-closed` reasons are `expired` / `host-closed` / `kicked` - show copy per reason (user-flows A5's polite screen), never a generic disconnect.
- In teams mode, a player who never picked a team is seated as a solo team of one at start-game (and on late join) - clients do not need to block the host on it.
- The dev sim panel spawns `@jeopardy/bots` bots; the compact game spec in `room/create` is its room-spinning path.

## Not yet true (so nobody assumes it)

- **Nothing is deployed.** Both Workers have never left local dev; first deploy is a manual owner step (docs/cloudflare-setup.md). CI has no deploy jobs on purpose.
- No R2 media flows exist yet; the R2 binding sits unused by code. D1 is in use for the room registry ONLY, and only once the owner applies `apps/web/migrations` by hand (docs/cloudflare-setup.md §2a) - until then the lobby answers empty and rooms work by code as before.
- The registry can drift from room truth (best-effort writes, coalesced roster counts). That is the designed failure mode: rows are a cache, the listing query filters on liveness, and the DO refuses dead rooms whatever a row says.
- The M1 visual editor and IndexedDB repositories do not exist yet - the document schemas are consumable, but nothing authors or persists them (M1 phase 2). The M1 exit-criteria run is blocked on that.
- No play SURFACES exist: rooms run and phones could connect, but the buzzer/board/console UIs are M4 - the only clients today are the /dev/echo harness, bots, and test scripts.
- The Playwright e2e suite is local-only (needs a chromium binary and a spawned wrangler dev); CI runs the workerd suite but not e2e.
- Mid-game team membership is frozen (create/join/kick reject after start-game); full mid-game team lifecycle ships with team mode in M5. Buzz-latency fairness compensation is M6.
- No real format has ever version-bumped: all portable formats sit at 1.0.0 with empty migration chains (the machinery is exercised by the synthetic example migration only).
- The M0 milestone closes only when the owner's manual hello-world deploy succeeds (ROADMAP exit criteria).

## M4 play surfaces (appended 2026-08-14)

| Claim                                                                                                    | Reproduce                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The three play surfaces are real routes over the room-store seam (mock rooms until the M3 reconcile)     | `pnpm dev`, open /room/DUMYX (phone), /room/DUMYX/display, /room/DUMYX/host (`?mirror`, `?theme=<preset>` toggles) |
| Store contract: a full fixture game (teams, wagers, final, undo, manual mode) through the action surface | `pnpm -F @jeopardy/web test` (`src/lib/room/room-store.contract.test.ts`)                                          |
| Every A4 buzzer state, every C4 console state, and the C1b mirror invariant render-tested                | `pnpm -F @jeopardy/web test` (`buzzer-screen.states`, `host-console.states`, `join-lobby.states`)                  |
| All four theme presets x all three surfaces smoke-render; QR + room code on the display title screen     | `pnpm -F @jeopardy/web test` (`surfaces-presets.smoke.test.ts`)                                                    |
| Room audio: only-winner-heard exclusive slot (drop, never queue) + serialized sound check                | `pnpm -F @jeopardy/web test` (`room-audio.test.ts`; sounds are placeholder tones until the M5 bundling pass)       |

Not yet true for M4: the ws room store is a documented stub (each mock room is one isolated tab); clue text has no wire channel; sound files are not bundled; the FLIP clue zoom and the host companion view are deferred (docs/design/surfaces.md "Known gaps").
