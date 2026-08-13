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

**Smoke check (this is M0's dev-loop proof):** open <http://localhost:5173/dev/echo>, hit Connect, then "Send hello". You should see a `welcome` envelope on connect and an `echo` back. The page connects the browser straight to `ws://localhost:8787/room/<CODE>/ws` - which is exactly the production topology: phones talk to the realtime Worker directly, not through the SvelteKit Worker.

The realtime origin the web app uses comes from `REALTIME_ORIGIN` (declared in `apps/web/src/env.ts`, value in `apps/web/.env`, default `http://localhost:8787`).

**Theme smoke check:** <http://localhost:5173/dev/theme> renders the board component, type specimens, token swatches, and emblem set with a live preset switcher + effects toggle - the fastest way to eyeball the token contract (docs/design/theming.md) after any theme-layer change.

**Engine smoke check (M2 exit criteria):** <http://localhost:5173/dev/hotseat> plays a complete game against `@jeopardy/engine` with no server - one keyboard drives host and players (S start, click cells, A arms, 1-8 buzz, C/W/N judge, E expires whichever timer the phase waits on, U undoes anything). Wager cells, the final round, and sudden-death ties are all reachable; the key legend is on the page.

### Cross-worker DO access (architecture risk 6 - validated)

The web Worker will reach the same `GameRoomDO` instances via a cross-script binding (`script_name: "jeopardy-realtime"` - present but commented in `apps/web/wrangler.jsonc` until M3 uses it). The local story was proven during M0:

```sh
npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc
```

runs both Workers in one dev process, and wrangler reports the binding as `Durable Object · local [connected]`. Separate `wrangler dev` / vite processes also discover each other through wrangler's local dev registry. What M0 could NOT prove (no server code uses the binding yet): the vite-dev-side emulation of a cross-script DO call. Validate that in M3 when the first "create room" endpoint lands; the multi-config invocation above is the known-good fallback and would simply replace the two-process `pnpm dev` if needed.

## Testing

```sh
pnpm test          # all packages
pnpm -F @jeopardy/realtime test   # one package (same for web/protocol)
```

- `packages/protocol` - plain vitest, co-located `*.test.ts` next to sources; `limits.gate.test.ts` is an invariant gate (cross-field sanity of the caps).
- `packages/engine` - plain vitest, one test file per rules area (buzzing, judging, wagers, final, ...) with settings-matrix row numbers cited in describe/it names; `fixture.test.ts` replays every scenario JSON under `fixtures/` twice and diffs the runs (determinism gate); `undo-replay.test.ts` holds the undo-returns-exact-prior-state and log-replay invariants.
- `apps/realtime` - vitest **inside workerd** via `@cloudflare/vitest-pool-workers` (the `cloudflareTest` plugin in vitest.config.ts reads wrangler.jsonc, so tests exercise the real DO with real hibernation APIs). `wrangler types` runs automatically first (pretest is part of the script).
- `apps/web` - plain vitest for pure logic plus server-render component tests (`svelte/server` `render()` inside node vitest - see `src/lib/board/board-display.test.ts`); browser-mode interaction tests arrive with the M4 phase 2 surfaces. Invariant gates: `theme-contract.gate.test.ts` (every preset emits the full token contract), `emblem-set.gate.test.ts` (curated-set design rules).

`pnpm check` runs svelte-check (web, plus a separate `tsc -p src/service-worker` for WebWorker libs) and `tsc --noEmit` elsewhere. `pnpm lint` / `pnpm fmt` are repo-wide via Vite+ (`vp`), configured in the root `vite.config.ts`.

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
