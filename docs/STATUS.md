# Status

> Stamp: verified against the M2 engine milestone, 2026-08-13 UTC. Prefer the reproduce-commands over the copied numbers - if they disagree, this file is stale; fix it in the same commit as whatever changed.

## Live state

| Claim                                                                                                   | Reproduce                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace installs clean (pnpm 10.33.0, Node 22)                                                        | `pnpm install --frozen-lockfile`                                                                                                                         |
| All tests green: 4 packages, 300 tests (100 protocol, 170 engine, 27 web, 3 realtime-in-workerd)        | `pnpm test`                                                                                                                                              |
| Typechecks green (svelte-check + tsc, incl. service-worker project)                                     | `pnpm check`                                                                                                                                             |
| Lint + format gates green                                                                               | `pnpm lint && pnpm exec vp fmt --check`                                                                                                                  |
| Web app builds through adapter-cloudflare; realtime bundles via dry-run deploy                          | `pnpm build`                                                                                                                                             |
| M1 document layer live: 4 portable formats parse through one entry point                                | `pnpm -F @jeopardy/protocol test` (`parsePortableDocument`; migration machinery proven by the fixture-gated example migration)                           |
| M2 engine live: pure state machine, matrix rows cited in test names, undo-by-replay, seeded determinism | `pnpm -F @jeopardy/engine test` (fixture catalog under `packages/engine/fixtures/` replays twice per scenario)                                           |
| A full game plays locally with NO server (M2 exit criteria)                                             | `pnpm dev`, open http://localhost:5173/dev/hotseat (headless proof: `apps/web/src/lib/hotseat/sample-game.test.ts` drives 60 cells + final to game-over) |
| Generated settings reference is current (registry-derived, drift-gated)                                 | `pnpm -F @jeopardy/protocol generate:settings-docs && git diff --exit-code docs/reference/settings.md`                                                   |
| Local dev loop: browser -> SvelteKit page -> WebSocket -> GameRoomDO echo                               | `pnpm dev`, then open http://localhost:5173/dev/echo (docs/DEVELOPMENT.md)                                                                               |
| Cross-script DO binding resolves `[connected]` in local multi-config dev                                | uncomment the `durable_objects` block in apps/web/wrangler.jsonc, then `npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc`     |

## Not yet true (so nobody assumes it)

- **Nothing is deployed.** Both Workers have never left local dev; first deploy is a manual owner step (docs/cloudflare-setup.md). CI has no deploy jobs on purpose.
- No D1 database, R2 bucket, or custom domain exists yet - the bindings sit commented in the wrangler.jsonc files.
- The M1 visual editor and IndexedDB repositories do not exist yet - the document schemas are consumable, but nothing authors or persists them (M1 phase 2). The M1 exit-criteria run (author/export/re-import/version-bump through the editor) is blocked on that.
- The engine has no transport: nothing speaks WebSockets to it yet (M3 wires `GameRoomDO` to `transition()`); the hotseat page and tests are its only drivers. Everyone-answers mode (#22) and teams (#34-#36) are engine-complete with tests but exercised by no UI surface.
- No real format has ever version-bumped: all four portable formats sit at 1.0.0 with empty migration chains (the machinery is exercised by the synthetic example migration only).
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

## Avatars in motion (appended 2026-08-14)

| Claim                                                                                                                                                    | Reproduce                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three asset tiers ship together and agree with the files on disk: 216 stills (931 KB), 27 walk sheets (568 KB), 27 models + prop + 2 colormaps (2326 KB) | `pnpm -F @jeopardy/web test` (`avatar-manifest.gate.test.ts` re-measures every budget from disk)                                                                             |
| Re-baking without a change is byte-identical                                                                                                             | `pnpm -F @jeopardy/avatar-bake download && pnpm -F @jeopardy/avatar-bake bake && git diff --exit-code apps/web/static/avatars`                                               |
| One recolor implementation serves the bake and the live diorama                                                                                          | `apps/web/src/lib/avatars/palette-recolor.ts` is served type-stripped to the render page (`bake.mjs`, `/shared/palette-recolor.js`); `palette-recolor.test.ts` pins the math |
| The display's diorama is live 3D; the phone's route downloads no renderer                                                                                | `pnpm dev`, open /dev/diorama (fake players, theme switch, buzz beat) and /room/DUMYX/display; `motion-guardrails.gate.test.ts` holds the import rules                       |
| Reduced motion freezes the sheet on frame 0 and stops the wandering                                                                                      | `pnpm -F @jeopardy/web test` (`wander.test.ts` for the crowd; the CSS freeze is a gate-tested explicit state)                                                                |

Not yet true: the diorama's environment is a local `"none" | "studio"` enum, not a theme-document field (the protocol addition is specified in `diorama-environment.ts`); no Kenney world kit is wired, so "studio" is a themed ground plane; the diorama itself has no automated browser test (CI has no chromium - verified by hand, `/dev/diorama` is the standing check).
