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

`pnpm dev` is the UI-iteration loop, and **it cannot serve rooms at all**. The production topology is SINGLE-ORIGIN (M3, docs/decisions/2026-08-13-single-origin-binding.md): clients hit `wss://<web-origin>/room/<CODE>/ws` and the web Worker forwards upgrades to `GameRoomDO` over the cross-script binding. vite dev emulates neither that binding nor D1, so under `pnpm dev` the room routes answer 503 and the instrument panel says so on the page rather than failing quietly. Anything touching rooms, the lobby, or D1 uses the loop below. (There is no direct-realtime-origin escape hatch any more: `REALTIME_ORIGIN` and its toggle were deleted 2026-08-14 - single origin is the only path.)

### The room dev loop (single origin - the real topology)

```sh
pnpm dev:rooms
```

is the whole thing: it builds the web app and runs BOTH Workers in one process on :8788 with the `GAME_ROOM` binding live (`Durable Object · local [connected]`). It is the equivalent of

```sh
pnpm -F @jeopardy/web build
npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc --port 8788
```

which is still the form to reach for when you want different flags. There is no HMR here - it serves a BUILD, so rerun the command after changing web code.

Smoke checks against it:

- **Automated:** `node apps/web/scripts/prove-single-origin.mjs http://localhost:8788` - creates a room through `POST /api/rooms`, upgrades a WebSocket through the SvelteKit worker, joins as host, and verifies the no-such-room refusal for uncreated codes. This is the canary for the SvelteKit-upgrade-passthrough (rerun it after any kit/adapter pin bump).
- **Browser:** open <http://localhost:8788/dev/rooms> - the room instrument panel, built from **modular panels** (`src/routes/dev/rooms/panels/`) so the layout can be rearranged without touching probe logic. Left: **Rooms** (create - listing, caps, spectators, streamer mode - plus every room this tab created with its lobby-presence, expiry countdown, Connect and Delete), **Room settings** (change a LIVE room through either door: the host-only `update-room-settings` message or `PATCH /api/rooms/<CODE>`, with the resulting broadcast and the split participant census on screen), and **Lobby** (auto-refreshing every 60s with a visible countdown, a manual Refresh, and the registry's health in words). Middle: **Connection** (socket/room state, join controls, action probes, the DO inspector). Right: **Log** (full height, filter by sent/received/errors, compact or verbose bodies). Below them, the **Test area** runs the refusal probes with expected-vs-actual PASS/FAIL chips (uncreated room, wrong password, stale version, malformed JSON, oversized payload, rate-limit burst) and a **Run all** button that runs them sequentially and prints `N passed / M failed / K skipped` - a probe this tab cannot currently perform is SKIPPED with the reason, never failed.
- **Ops by curl:** `curl localhost:8788/api/version` reports the build plus `realtimeBinding` and `registry` health; `curl localhost:8788/api/rooms` carries the same `registry` status beside the list; `curl -H "x-host-token: <token>" localhost:8788/api/rooms/<CODE>` is the DO inspector (now including the settings and the participant census split players/spectators), `curl -X PATCH -H "content-type: application/json" -H "x-host-token: <token>" -d '{"settings":{"hideJoinCode":true}}' localhost:8788/api/rooms/<CODE>` changes a live room's settings, and `curl -X DELETE -H "content-type: application/json" -H "x-host-token: <token>" ...` closes a room (the content type is required - SvelteKit's CSRF guard rejects a bare cross-site DELETE).
- **Bots:** `pnpm -F @jeopardy/bots bots -- --origin http://localhost:8788 --create --count 5 --host` plays a bots-only game to game-over through the single origin (packages/bots/README.md).

**Local D1 (the room registry, 2026-08-14):** the public lobby reads a `rooms` table in D1; both Workers bind the same database and the schema lives in `apps/web/migrations/`. Create it in the local simulated D1 once per state directory:

```sh
npx wrangler d1 migrations apply jeopardy-machine --local -c apps/web/wrangler.jsonc

# 2026-08-14: 0001_create_rooms.sql was REWRITTEN (listing axis -> public/private), so an
# existing local database must run it again - it drops and recreates the table:
npx wrangler d1 execute jeopardy-machine --local -c apps/web/wrangler.jsonc \
  --file apps/web/migrations/0001_create_rooms.sql
```

Run it before the loop above (the two Workers share one `.wrangler` state directory there, so one apply covers both). Skipping it is not fatal - rooms create and join normally, the lobby just cannot list them; that is exactly how an unapplied production migration behaves, on purpose. The realtime test suite applies these same migration files to its own simulated D1 (`apps/realtime/test/apply-migrations.ts`), which is what keeps the DO's registry statements honest against the web app's schema.

**Empty lobby? Check the registry status.** `GET /api/rooms` and `GET /api/version` both carry a `registry` field: `{"status":"ok"}` means the lobby works and is genuinely empty; `{"status":"unavailable","reason":"no-table"}` means this environment never had the migration applied (the command above, `--remote` for a deploy); `no-binding` means there is no D1 at all (you are on vite dev); `error` carries D1's own message. `POST /api/rooms` reports the same verdict for its own row write, so "the room was created but is NOT listed" is a sentence the creating surface can say. The instrument panel renders all of it - a session room shows `NOT in lobby` when it is public, live, and genuinely absent. This exists because it once did not: a public room that never appeared and an empty lobby looked identical (owner report 2026-08-14).

**Theme smoke check:** <http://localhost:5173/dev/theme> renders the board component, type specimens, token swatches, and the avatar picker/chips with a live preset switcher + effects toggle - the fastest way to eyeball the token contract (docs/design/theming.md) after any theme-layer change. The avatar sprites themselves are baked, not live-rendered - changing avatars/accents means re-running `tools/avatar-bake` (its README).

**Engine smoke check (M2 exit criteria):** <http://localhost:5173/dev/hotseat> plays a complete game against `@jeopardy/engine` with no server - one keyboard drives host and players (S start, click cells, A arms, 1-8 buzz, C/W/N judge, E expires whichever timer the phase waits on, U undoes anything). Wager cells, the final round, and sudden-death ties are all reachable; the key legend is on the page.

### Cross-worker DO access (architecture risk 6 - resolved in M3)

The web Worker reaches the same `GameRoomDO` instances via the cross-script binding (`GAME_ROOM`, live in `apps/web/wrangler.jsonc`): room creation (`POST /api/rooms`) and every room WebSocket ride it. The M0 open question - vite-dev-side emulation of a cross-script DO call - resolved AGAINST vite dev: it does not emulate the binding, so the routes answer 503 there and `pnpm dev:rooms` (the multi-config `wrangler dev` loop above) is the way to run the single-origin path locally (it was the known-good fallback all along). `pnpm dev` remains the fast loop for UI work; the WebSocket-upgrade passthrough itself is proven and documented in the single-origin decision doc's 2026-08-14 addendum.

## Testing

```sh
pnpm test          # all packages
pnpm -F @jeopardy/realtime test   # one package (same for web/protocol)
```

- `packages/protocol` - plain vitest, co-located `*.test.ts` next to sources; `limits.gate.test.ts` is an invariant gate (cross-field sanity of the caps).
- `packages/engine` - plain vitest, one test file per rules area (buzzing, judging, wagers, final, ...) with settings-matrix row numbers cited in describe/it names; `fixture.test.ts` replays every scenario JSON under `fixtures/` twice and diffs the runs (determinism gate); `undo-replay.test.ts` holds the undo-returns-exact-prior-state and log-replay invariants.
- `packages/bots` - plain vitest over a loopback socket: join/resume behavior, seeded-decision reproducibility, event reactions. The bots themselves are exercised for real inside the realtime suite.
- `apps/realtime` - vitest **inside workerd** via `@cloudflare/vitest-pool-workers` (the `cloudflareTest` plugin in vitest.config.ts reads wrangler.jsonc, so tests exercise the real DO with real hibernation APIs - including forced instance eviction via `evictDurableObject` and alarm firing via `runDurableObjectAlarm`). Bot players drive the game-flow suites over real WebSockets. `wrangler types` runs automatically first (pretest is part of the script).
- `apps/web` - plain vitest for pure logic plus server-render component tests (`svelte/server` `render()` inside node vitest - see `src/lib/board/board-display.test.ts`); browser-mode interaction tests arrive with the M4 phase 2 surfaces. Invariant gates: `theme-contract.gate.test.ts` (every preset emits the full token contract), `avatar-manifest.gate.test.ts` (baked avatar set: manifest, sprite files on disk, and theme preset accents must agree).

`pnpm check` runs svelte-check (web, plus a separate `tsc -p src/service-worker` for WebWorker libs) and `tsc --noEmit` elsewhere. `pnpm lint` / `pnpm fmt` are repo-wide via Vite+ (`vp`), configured in the root `vite.config.ts`.

### End to end (Playwright, local-only)

```sh
pnpm -F @jeopardy/web test:e2e
```

builds the web app, spawns the single-origin loop on :8790 (`apps/web/e2e/global-setup.ts`), and drives REAL chromium contexts. Two suites, and the split is what each one is for:

- **`e2e/room.e2e.ts` - the protocol.** Pages that open the room socket by hand: roster sync across surfaces, a staggered auto-buzz race proving deterministic arrival-order adjudication with exactly one room-wide `buzz-won`, and the `/dev/rooms` panel flow (uncreated-room PASS probe, two creates that both survive in the session list, host a lobby, streamer mode applied over the socket door and seen coming back as the broadcast, then Run all with its summary line).
- **`e2e/surfaces.e2e.ts` - the product.** No protocol at all: it clicks Create room on the front door, opens the projector window, and fills in the pre-game screen on two more phones, then asks the three tabs whether they agree about the roster, the teams, and who is standing on which station of the staged lobby. It also reloads a phone (the seat token resumes the same seat rather than taking a second one) and opens a host console in a tab that never created the room (which says so, honestly). This is the suite that proves the 2026-08-17 reconcile: before it, every tab was its own simulation and the answer was always no.

Both drive a hydrating app, so the player-join helper types the name until it STICKS and presses until the room answers - a fill or a tap that lands before Svelte takes over is discarded, and pretending otherwise is how a suite gets flaky. Deliberately NOT part of `pnpm test`/CI: it needs a chromium binary (resolution order: `E2E_CHROMIUM` env, playwright's own install, `/opt/pw-browsers/chromium`) and a free port. Playwright is pinned in the catalog and used library-only - its browser-download postinstall stays blocked; point it at an existing chromium instead.

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
