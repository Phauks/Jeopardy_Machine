# CLAUDE.md

## What this is

A free, self-hosted **quiz-show game suite** (Jeopardy-inspired; product name pending, will not ship as "Jeopardy"): visual board editor, big-screen game board, host console, and phone-as-buzzer play for 2-100 players who join with a QR/room code. No accounts for players, ever. SvelteKit 3 + Svelte 5 on Cloudflare Workers; one Durable Object per game room. It is also a PWA by design (installable editor/host; players always stay in the browser tab).

**ROADMAP.md is the living index of intent.** Read it first; it links everything else via the document map.

## Hard rules

- **No deploys from agent sessions.** Denied in `.claude/settings.json`; deploys are deliberate, local, owner-run (`docs/cloudflare-setup.md`). Verify with tests, builds, and `wrangler deploy --dry-run` only.
- **Docs update in the same commit as the behavior they describe.** A stale doc is worse than none; if a doc disagrees with code, fix the doc. ROADMAP checkboxes move in the same PR as the work (unenforced - discipline).
- **Customization lives in documents, never in code paths** (docs/design/expansion-and-boundaries.md - the design law). Content pack / rule set / theme / game definition are the portable documents (the settings object travels embedded in the latter two - M1 resolution R4); unknown fields only in the reverse-domain `ext` bag.
- **Players never log in.** Room code is the entire join flow (guiding principle 3). Nothing may add player-side accounts, prompts, or install nags.
- **Operational limits live only in `@jeopardy/protocol/limits`** and hosts cannot lift them. Enforced by convention + the limits gate test.
- **Runes only** (`compilerOptions.runes: true` - enforced by the compiler). **kebab-case filenames everywhere**, including Svelte components. **Fully spelled-out identifiers**, no abbreviations. **No emojis** in UI, docs, or commits. **No barrel files** (enforced: `oxc/no-barrel-file` = error); across packages, import only through `package.json` exports maps. One sanctioned exception (M1 owner resolution R1): `packages/protocol/src/index.ts`, the explicit named-export public API behind that package's root export.
- **Formatter and linter are law**: `pnpm fmt` / `pnpm lint` (Oxfmt/Oxlint via Vite+, config pinned in root `vite.config.ts`, gated in CI). Never hand-wrap; prose one-line-per-paragraph.
- **Game logic never imports partyserver types** - transport only, in the DO class (docs/decisions/2026-08-13-partyserver.md).
- **Version pins are exact and move deliberately**, one line per commit (`pnpm-workspace.yaml` catalog; docs/decisions/2026-08-13-m0-version-pins.md). SvelteKit 3 prerelease breakage is ordinary maintenance, not an excuse to drift.

## Layout

| Path                       | What lives there                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/`                | SvelteKit 3 app Worker: all UI routes, later REST + D1/R2. PWA manifest + service worker.                                                                                                                                                                                    |
| `apps/realtime/`           | Plain TS Worker: `GameRoomDO` (one per room), WebSocket-only.                                                                                                                                                                                                                |
| `packages/protocol/`       | Shared contracts: wire envelope, `ext` bag, limits, and the M1 document layer (ids, document envelope + migrations, content packs, settings registry, rule sets, themes, game definitions). The modularity keystone.                                                         |
| `packages/engine/`         | The M2 rules engine: pure `(state, action, setup) -> {state, events}` state machine, seeded rng, action-log undo/replay, `simulate()` + replayable JSON scenario fixtures. No network, no DOM, no clocks.                                                                    |
| `docs/`                    | `DEVELOPMENT.md` (dev loop) · `STATUS.md` (stamped live state) · `decisions/` (dated one-pagers) · `proposals/` (design-before-code) · `design/` (design law, user flows) · `research/` (round 1) · `content/` (event question pool) · `cloudflare-setup.md` (owner runbook) |
| `.github/workflows/ci.yml` | PR-only gate: fmt, lint, typecheck, test, build. No deploy jobs.                                                                                                                                                                                                             |

## Commands

All from the repo root:

- `pnpm dev` - both dev servers: SvelteKit on :5173 + realtime Worker on :8787 (see docs/DEVELOPMENT.md, including the /dev/echo smoke page)
- `pnpm test` / `pnpm check` / `pnpm build` - recursive across packages; build includes a real adapter build (web) and a dry-run deploy (realtime)
- `pnpm lint` / `pnpm fmt` - Oxlint / Oxfmt repo-wide (`vp fmt --check` is the CI form)

## Conventions quick reference

- TypeScript strict + `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules` (tsconfig.base.json; apps/web restates them over the generated `$app/tsconfig`).
- Double quotes, semicolons, 2-space indent, LF, printWidth 100 - all formatter-enforced.
- Comments: dense, why-not-what, self-contained (cite real file paths, never planning-doc numbers), reversals recorded inline with dates.
- Commits: `area: imperative summary` (lowercase, <=72 chars, no trailing period) + a why-body.
- Tests co-located `*.test.ts`; invariant gates as `*.gate.test.ts`. DO tests run inside workerd via vitest-pool-workers.
- Workspace deps: exact pins in the `pnpm-workspace.yaml` catalog; packages reference `catalog:`.
- SvelteKit 3 differs sharply from SK2 (no svelte.config.js, `#lib` not `$lib`, `src/env.ts` not `$env/*`, `$app/manifest` not `$service-worker`) - the full list lives in docs/decisions/2026-08-13-m0-version-pins.md. Trust the in-repo code over SK2 habits.

## Cloud/agent sessions

Headless verification only: `pnpm test`, `pnpm build`, `wrangler dev` for local smoke checks. Never deploy, never touch secrets (`wrangler secret`, `.dev.vars`). The owner runs docs/cloudflare-setup.md by hand.
