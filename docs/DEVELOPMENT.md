# Development

## Prerequisites

- Node 22.17+ (`.nvmrc` says 22; `nvm use` / `fnm use`)
- pnpm 10 (pinned via `packageManager` in package.json; `corepack enable` gets you the right one)
- `pnpm install` at the repo root (pnpm 10 blocks postinstall scripts by default; the two that need them - esbuild, workerd - are allow-listed in `pnpm-workspace.yaml`)

## The dev loop (two Workers, one command)

```sh
pnpm dev
```

runs both dev servers in parallel:

| Process                         | What                                                                                                | Port |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ---- |
| `apps/web`: `vite dev`          | SvelteKit 3 app (SSR + routes; Cloudflare bindings emulated by the adapter when the app grows some) | 5173 |
| `apps/realtime`: `wrangler dev` | The realtime Worker + `GameRoomDO` in local workerd (miniflare)                                     | 8787 |

`pnpm dev` is the UI-iteration loop. The production topology is SINGLE-ORIGIN (M3, docs/decisions/2026-08-13-single-origin-binding.md): clients hit `wss://<web-origin>/room/<CODE>/ws` and the web Worker forwards upgrades to `GameRoomDO` over the cross-script binding. vite dev cannot emulate that binding, so exercising the real connection path uses the multi-config loop below; in plain `pnpm dev` the `/dev/echo` harness falls back to dialing the realtime Worker directly via `REALTIME_ORIGIN` (deprecated, harness-only - `apps/web/src/env.ts`).

### The single-origin dev loop (M3 - the real topology)

```sh
pnpm -F @jeopardy/web build
npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc --port 8788
```

runs BOTH Workers in one process with the `GAME_ROOM` binding live (`Durable Object · local [connected]`). Smoke checks against it:

- **Automated:** `node apps/web/scripts/prove-single-origin.mjs http://localhost:8788` - creates a room through `POST /api/rooms`, upgrades a WebSocket through the SvelteKit worker, joins as host, and verifies the no-such-room refusal for uncreated codes. This is the canary for the SvelteKit-upgrade-passthrough (rerun it after any kit/adapter pin bump).
- **Browser:** open <http://localhost:8788/dev/echo> - the room harness. "Create room (sample game)" allocates a code via the create route and fills it in; Connect + "Join as host/player/spectator" speak the real room protocol; "Connect to uncreated room" is a one-click PASS/FAIL probe that connects-never-create holds; Ping rides the runtime auto-response (hibernation check).
- **Bots:** `pnpm -F @jeopardy/bots bots -- --origin http://localhost:8788 --create --count 5 --host` plays a bots-only game to game-over through the single origin (packages/bots/README.md).

**Theme smoke check:** <http://localhost:5173/dev/theme> renders the board component, type specimens, token swatches, and emblem set with a live preset switcher + effects toggle - the fastest way to eyeball the token contract (docs/design/theming.md) after any theme-layer change.

**Engine smoke check (M2 exit criteria):** <http://localhost:5173/dev/hotseat> plays a complete game against `@jeopardy/engine` with no server - one keyboard drives host and players (S start, click cells, A arms, 1-8 buzz, C/W/N judge, E expires whichever timer the phase waits on, U undoes anything). Wager cells, the final round, and sudden-death ties are all reachable; the key legend is on the page.

### Cross-worker DO access (architecture risk 6 - resolved in M3)

The web Worker reaches the same `GameRoomDO` instances via the cross-script binding (`GAME_ROOM`, live in `apps/web/wrangler.jsonc`): room creation (`POST /api/rooms`) and every room WebSocket ride it. The M0 open question - vite-dev-side emulation of a cross-script DO call - resolved AGAINST vite dev: it does not emulate the binding, so the routes answer 503 there and the multi-config `wrangler dev` loop above is the way to run the single-origin path locally (it was the known-good fallback all along). `pnpm dev` remains the fast loop for UI work; the WebSocket-upgrade passthrough itself is proven and documented in the single-origin decision doc's 2026-08-14 addendum.

## Testing

```sh
pnpm test          # all packages
pnpm -F @jeopardy/realtime test   # one package (same for web/protocol)
```

- `packages/protocol` - plain vitest, co-located `*.test.ts` next to sources; `limits.gate.test.ts` is an invariant gate (cross-field sanity of the caps).
- `packages/engine` - plain vitest, one test file per rules area (buzzing, judging, wagers, final, ...) with settings-matrix row numbers cited in describe/it names; `fixture.test.ts` replays every scenario JSON under `fixtures/` twice and diffs the runs (determinism gate); `undo-replay.test.ts` holds the undo-returns-exact-prior-state and log-replay invariants.
- `packages/bots` - plain vitest over a loopback socket: join/resume behavior, seeded-decision reproducibility, event reactions. The bots themselves are exercised for real inside the realtime suite.
- `apps/realtime` - vitest **inside workerd** via `@cloudflare/vitest-pool-workers` (the `cloudflareTest` plugin in vitest.config.ts reads wrangler.jsonc, so tests exercise the real DO with real hibernation APIs - including forced instance eviction via `evictDurableObject` and alarm firing via `runDurableObjectAlarm`). Bot players drive the game-flow suites over real WebSockets. `wrangler types` runs automatically first (pretest is part of the script).
- `apps/web` - plain vitest for pure logic plus server-render component tests (`svelte/server` `render()` inside node vitest - see `src/lib/board/board-display.test.ts`); browser-mode interaction tests arrive with the M4 phase 2 surfaces. Invariant gates: `theme-contract.gate.test.ts` (every preset emits the full token contract), `emblem-set.gate.test.ts` (curated-set design rules).

`pnpm check` runs svelte-check (web, plus a separate `tsc -p src/service-worker` for WebWorker libs) and `tsc --noEmit` elsewhere. `pnpm lint` / `pnpm fmt` are repo-wide via Vite+ (`vp`), configured in the root `vite.config.ts`.

### End to end (Playwright, local-only)

```sh
pnpm -F @jeopardy/web test:e2e
```

builds the web app, spawns the single-origin loop on :8790 (`apps/web/e2e/global-setup.ts`), and drives REAL chromium contexts as phones + display + host (`apps/web/e2e/room.e2e.ts`): roster sync across surfaces, a staggered auto-buzz race proving deterministic arrival-order adjudication with exactly one room-wide `buzz-won`, and the `/dev/echo` harness flow (create room, uncreated-room PASS probe, host a lobby). Deliberately NOT part of `pnpm test`/CI: it needs a chromium binary (resolution order: `E2E_CHROMIUM` env, playwright's own install, `/opt/pw-browsers/chromium`) and a free port. Playwright is pinned in the catalog and used library-only - its browser-download postinstall stays blocked; point it at an existing chromium instead.

## PWA bits (service worker + manifest)

Policy and rationale: docs/decisions/2026-08-13-pwa.md. Implementation: `apps/web/src/service-worker/index.ts` (precache hashed immutable assets; network-first for ALL navigations; never `skipWaiting`) and `apps/web/static/manifest.webmanifest` (standalone display; no install prompts anywhere - install affordances appear only in editor chrome, later).

- **Dev bypass:** SvelteKit does not register the service worker during `vite dev` (and `$app/manifest.immutable` is empty there), so normal dev is automatically SW-free.
- **Testing SW behavior locally:** build + preview it - `pnpm -F @jeopardy/web build && pnpm -F @jeopardy/web preview`, then DevTools -> Application -> Service Workers. Use "Update on reload" while iterating, and remember an updated SW activates only after the last old-version tab closes (that is the deliberate version-skew policy, not a bug).
- **Storage direction:** local-first data (library, content packs, pending media) targets **IndexedDB** from M1 - the repository interfaces land in M1 with an IndexedDB implementation first; localStorage is reserved for tiny prefs and session tokens only.

## Adding a package

1. Create `apps/<name>/` or `packages/<name>/` with a `package.json` (name `@jeopardy/<name>`, `"private": true`, scripts for `check`/`test`/`build` as applicable) - the workspace globs in `pnpm-workspace.yaml` pick it up.
2. Dependencies: reference the catalog (`"zod": "catalog:"`); new shared deps get an exact pin added to the catalog in the same commit.
3. tsconfig extends `../../tsconfig.base.json`; cross-package imports only through `package.json` `exports` maps (no barrels).
4. Wire a co-located test so `pnpm -r test` covers it from day one; update CLAUDE.md's layout table and this file if the dev loop changes.

## Deploying (owner only - never from agent sessions)

First-time account/resource setup and the deploy commands live in `docs/cloudflare-setup.md`. Nothing has been deployed as of M0: **the first real deploy of both Workers is a manual owner step**; agent sessions verify locally (`pnpm build` includes web's real adapter build and realtime's `wrangler deploy --dry-run`) and CI has no deploy jobs by design.
