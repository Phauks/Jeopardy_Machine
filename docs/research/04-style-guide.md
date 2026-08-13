# Research: Coding Style & Conventions from `magna-carta` and `sagebrush-barrister`

> Research round 1 · Agent: Style Analysis · 2026-08-13
> Purpose: extract the owner's conventions so this project feels native. Both repos are siblings in philosophy: Cloudflare-native, pnpm + Vite+ (`vp`), Svelte 5 runes-only, TypeScript strict, heavy documentation discipline with `CLAUDE.md` as the operating system of the repo. `magna-carta` is the newer, larger, more formalized project; `sagebrush-barrister` is a shipped single-app product. Where they disagree, magna-carta generally represents the _current_ preferences.

---

## 1. Stack & tooling per repo

### magna-carta (`/workspace/magna-carta`)

- **Shape**: pnpm **monorepo** (`pnpm-workspace.yaml`: `apps/*`, `packages/*`, `plugins/*`), ~57 packages, 13 apps (worker + 11 sibling workers + `web`), plus **Rust** `crates/` (Tantivy search, PDF, OCR, email cores → WASM) and `containers/` (Collabora, LibreOffice, OCR, clamd).
- **Frontend**: **SvelteKit** SPA — `apps/web/svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: "index.html"`; the build is served as **Workers Static Assets** by the main worker (`apps/worker/wrangler.jsonc`: `assets.directory: "../web/build"`, `not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`).
- **Backend**: Cloudflare **Workers + Hono**, REST as **OpenAPI 3.1 code-as-contract with zod**; committed OpenAPI snapshot with byte-exact drift gates; generated Hey API + Svelte Query client in `packages/api-client` (never hand-edited, lint/format-exempt).
- **Cloudflare surface**: D1 (control plane), per-firm data in a **FirmDatabase Durable Object**, R2, Queues, KV, Vectorize, Containers. `wrangler.jsonc` (JSONC with dense explanatory comments) declares required secrets so deploys fail loudly. `nodejs_compat` flag for Better Auth.
- **Auth**: Better Auth on control-plane D1.
- **Tooling**: **Vite+ (`vp` CLI)** bundles Vite, Vitest, **Oxlint**, **Oxfmt**; TypeScript 6.0.3 via pnpm **catalog:** (exact pins, "upgrades are deliberate, one line at a time"); `tsc -b` project references. Node pinned via `.node-version` (25), `engines.node >=22`, `packageManager: pnpm@10.33.2`.
- **CI**: `.github/workflows/gate.yml` — fan-out DAG with path-filtering, tiered (PR / push-to-main / nightly / merge_group), per-job timeout caps, every choice justified in comments. **Deployment is NOT GitHub Actions**: Cloudflare **Workers Builds**, production branch is **`release`** — deploy = deliberate `git push origin main:release`; `git log release..main` is the undeployed queue.
- **Custom tooling culture**: `tooling/` full of bespoke lint/fitness scripts (process-reference lint, status lint, license lint, worktrees registry, doc-fragment assemblers). Renovate + `osv-scanner.toml`.

### sagebrush-barrister (`/workspace/sagebrush-barrister`)

- **Shape**: single app under `app/` (repo root holds docs + raw resources). Not a monorepo, but the same layered discipline.
- **Frontend**: **Svelte 5 (runes only, `compilerOptions.runes: true`) + plain Vite — NOT SvelteKit.** Custom small History-API router (`app/src/lib/router.svelte.ts`); SPA fallback via Workers assets. PWA via `vite-plugin-pwa` (prompt-style update toast, curated precache globs).
- **Backend**: Cloudflare **Worker** at `app/worker/index.ts` (no framework; hand-rolled `http.ts` + per-domain modules: `auth/`, `ai/`, `payments/`, `email/`, `friends/`, `admin/`). `wrangler.jsonc` with `run_worker_first: true` (rationale comment: security headers must always run), **D1**, `send_email` binding, cron trigger, custom-domain routes. `@cloudflare/vite-plugin` gives one dev server for SPA + Worker.
- **Data**: **Dexie** (IndexedDB) client-side — "study data lives only in the browser"; D1 for accounts/social. Migrations are **timestamp-named** `YYYYMMDDHHMMSS_<slug>.sql` (hard rule after a sequential-numbering collision forced a baseline squash), recorded in a ledger `app/migrations/README.md`, format enforced by `app/scripts/check-migrations.ts` in CI and `pnpm test`.
- **Tooling**: same **Vite+ `vp`** scripts (`vp dev/build/lint/fmt/test`), `svelte-check` for types, `tsx` for a large fleet of operator scripts. Node pinned `.nvmrc` = 22, `packageManager: pnpm@10.33.2`.
- **CI**: `.github/workflows/ci.yml` — **pull_request only** (deliberate: re-running on push to main "is pure duplication"), concurrency cancel, pnpm/Node versions read from repo pins, steps: svelte-check → oxlint → typography gate → migration gate → docs gate → tests → build. Dependabot + CODEOWNERS.
- **Deploy**: `pnpm deploy` = build + `wrangler deploy` from a local checkout; **deploys are denied to agents** via `.claude/settings.json` permission denies.
- **AI**: no provider SDKs — Worker proxies `/api/ai/*` with plain fetch; provider keys are Worker secrets only, never client-side.

---

## 2. Project structure & naming

### magna-carta

- `apps/web/src/lib/` organized **by feature domain** (`auth/`, `navigation/`, `matters/`, `settings/`, ...), plus `lib/components/` for shared pieces; SvelteKit `routes/` with route groups (`(app)/`, `login/`, `[...missing]` catch-all 404).
- **File naming: kebab-case everything**, including Svelte components — `app-shell.svelte`, `command-palette.svelte`, `drag-reorder.svelte.ts`. Design-system components one-per-directory exposed via curated `package.json` `exports` maps.
- **No barrel files** (ADR-0070, enforced by `oxc/no-barrel-file: error`): within a package import the specific module; across packages only the `exports` map; `"sideEffects": false`.
- Imports include explicit `.ts` extensions in the web app.
- **Naming rule (golden rule 12): fully spelled-out names, no shorthand** — `newIdentifier()` not `newId()`; sole exceptions: specced storage encodings and universal terms (`id`, `URL`, `JSON`).

### sagebrush-barrister

- Strict **layer architecture** documented in `app/CLAUDE.md`: `lib/api/ → lib/data/ → lib/services/ → lib/stores/ → lib/components/ → lib/pages/`, plus `types/`, `util/`, `actions/`. "Never import upward. If a lower layer needs something from above, refactor the contract."
- **File naming: PascalCase Svelte components** (`PageShell.svelte`, `EmptyState.svelte`), **camelCase TS modules** (`accountCode.ts`). Pages named `<Name>Page.svelte`.
- Registry pattern for extensible surfaces: `sections.ts` / `adminSections.ts` / `searchDestinations.ts` SSOTs from which nav, search, and footers derive automatically.
- Worker organized by domain folders mirroring the client.

---

## 3. Svelte specifics

- **Svelte 5, runes only, in both repos.** State files use the `.svelte.ts` suffix (`router.svelte.ts`, `drag-reorder.svelte.ts`) — class/closure-based reactive state modules, not legacy stores.
- **Props pattern**: `type Props = { ... }` then `let { title, description, iconSize = 28 }: Props = $props();` with `Snippet` props for slots and `{@render action()}`.
- **CSS — the biggest divergence:**
  - **sagebrush**: plain scoped `<style>` blocks per component + a **design-token CSS file** `app/src/lib/styles/tokens.css` (`--bg-canvas`, `--text-muted`, `--space-2`, `--accent`...), plus `typography.css`, `print.css`, `colorblind.css`. Root CLAUDE.md: "Plain CSS with tokens.css SSOT. **No Tailwind, no component library.**" One Lucide wrapper `components/Icon.svelte`. Custom typography gate bans mid-word breaking CSS.
  - **magna-carta**: **Tailwind v4 + in-house design system** styled on **headless Bits UI v2**, with DTCG tokens via Terrazzo generating `--mc-*` CSS custom properties per theme×mode. Fitness gates reject arbitrary Tailwind values, raw colors, raw z/duration numerals, `bits-ui` imports outside the package, and emojis. Golden rule: "no raw CSS, no off-token values."
  - Common denominator: **design tokens as SSOT, Lucide icons, no emojis, no off-the-shelf component library** (magna-carta builds its own on headless primitives).
- Component headers open with a substantial block comment explaining purpose, design intent, and non-obvious decisions.

---

## 4. Code style

- **Formatter**: **Oxfmt via `vp fmt`** — no Prettier/ESLint configs anywhere. magna-carta pins it explicitly in root `vite.config.ts`: `printWidth: 100`, `proseWrap: "preserve"`, `endOfLine: "lf"`, generated artifacts in `ignorePatterns`. **Never hand-wrap**: code wraps at 100 by the formatter; prose is authored one-line-per-paragraph.
- **Linter**: **Oxlint**, config living in the `lint` block of the root `vite.config.ts` (explicitly not `.oxlintrc.json`, with a comment explaining why). Plugins `typescript`, `unicorn`, `oxc`; categories `suspicious`/`perf` = warn; `oxc/no-barrel-file` = error; deliberate rule-offs documented with rationale + a "planned strictening" backlog.
- **Observed style**: 2-space indent (`.editorconfig`), semicolons, trailing commas, **double quotes** in all `.ts` and in all magna-carta `.svelte` files. (Quirk: sagebrush `.svelte` files use single quotes — oxfmt evidently didn't reach `.svelte` there; magna-carta is uniformly double-quoted.)
- **TypeScript**: `strict: true` everywhere; magna-carta adds `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`; sagebrush adds `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. `import type` used consistently. **Interfaces for object shapes, type aliases for unions/props.** Branded/literal union types and `as const` arrays common.
- **Validation**: split by project size — magna-carta uses **zod** as schema SSOT feeding the OpenAPI contract; sagebrush deliberately hand-rolls ("Lean runtime JSON validation... without dragging in a 60 KB dependency for a one-screen schema") with a typed `SchemaValidationError` class. Dependency-weight consciousness is a consistent value.
- **Comment style — the signature trait**: very high density, always **why-not-what**, often multi-sentence with history ("was X, changed because Y, decided Z on DATE"), including inside JSONC configs and CI YAML. magna-carta hard rule: comments are **process-agnostic** — never cite `ADR-NNNN`/spec §/phase numbers in code (CI-enforced); state the reasoning inline or point to a real file path.
- **Errors**: fail loudly at boundaries, never swallow; typed error classes; redact-by-default logging, correlation IDs, user-facing Error ID, no third-party error SaaS.
- **Punctuation quirks**: sagebrush hard-bans em/en dashes in user-facing prose (hyphens only); magna-carta bans **emojis** everywhere (UI, docs, commits).

---

## 5. Documentation habits (the strongest signal)

Both repos treat docs as load-bearing infrastructure with CI gates. Key patterns:

- **CLAUDE.md as the entry point + per-area CLAUDE.md files.** Root file = what the product is, golden rules, orientation map; per-area files follow a template: Purpose / Key files / Local conventions / Invariants / Dependencies & contracts / Gotchas.
- **"One home per fact"**: documentation is segmented and non-duplicative; every fact has one authoritative home, everything else links. Root CLAUDE.md opens with a routing table ("You need... → Home").
- **STATUS.md = stamped live state** (both): opens "Stamp: verified against commit `<sha>`... `<date>` UTC" and carries reproduce-commands next to every number ("Prefer the reproduce-commands over the copied numbers").
- **Decision records**: sagebrush uses dated one-pagers `docs/decisions/YYYY-MM-DD-<slug>.md` ("check before building on an assumption, add one when you make a call other sessions could contradict"); magna-carta uses formal ADR-NNNN in a generated register.
- **Fragment workflow for parallel agents** (magna-carta): branches never edit `CHANGELOG.md`/`STATUS.md` directly — they commit `changelog.d/<slug>.md`, `status.d/`, `docs/decisions/pending/` fragments; assemblers render on main. Built so concurrent worktrees never collide.
- **Docs-in-the-same-commit is definition-of-done** (both, verbatim rule): "No feature is done until its docs (developer _and_ user) are updated — same commit." "The code is the source of truth. When a doc disagrees with the code, fix the doc; a stale doc is worse than none."
- **docs/ taxonomy**: sagebrush: `architecture/`, `decisions/`, `proposals/` (design docs per feature, one .md each), `launch/` runbook, `roadmap.md` ("forward-looking only, shipped items get pruned"). magna-carta: `conventions/` (~20 standards files each with "Scope (single home for):" headers), `specs/`, `research/`, `user/`, `maintenance/`.
- **ROADMAP style** (magna-carta): "Now / Next / Recently shipped" living tracker updated in the same PR; explicitly separated from phase strategy and stage tracking (STATUS.md).
- **README**: sagebrush's is a real product README (what it is, Features with bold lead-ins, Quick start, Documentation links, Stack, License); magna-carta's is deliberately minimal, pointing at CLAUDE.md.
- **`.claude/settings.json` habits**: SessionStart hook running `scripts/cloud-install.sh` for Claude-on-web, permission **denies for `wrangler deploy`**, `.mcp.json` declaring a Playwright MCP server for local screenshot verification.

---

## 6. Testing

- **Vitest in both**, co-located tests: sagebrush has 199 `*.test.ts` files next to sources, 4,185 passing at last stamp, zero-red policy ("treat any red as a real regression").
- **"Gate tests" / fitness functions as first-class tests**: `*.gate.test.ts` (e.g. CSS layout regression gates, `Button.gate.test.ts`); deterministic drift gates run as scripts (`check-migrations`, `check-docs`) in both CI and `pnpm test`.
- **magna-carta layers**: unit+component (Vitest, behavior + a11y), integration (**Miniflare** via `@cloudflare/vitest-pool-workers`, registered as Vitest projects in root `vite.config.ts` — a CLOSED list), e2e (**Playwright**), visual regression (Playwright screenshots per theme×mode). Fixtures only via domain write-paths, never raw SQL; injectable seed/clock.
- Distinctive processes: adversarial review with runnable verifiers ("A finding without a runnable verifier is a hypothesis, not a result"); owner manual verification checklist shipped with every UI slice; single-flight test lock.

## 7. Git habits

- **PR-based flow into `main`**, everything lands via PR; branch protection with a required aggregate gate job.
- Commit style: lowercase `area: imperative summary` (≤72 chars, no trailing period) + explanatory why-body (bug fixes: Symptom · Root cause · Fix · Impact); squash-merged with PR number. Written standard is Conventional-Commits-shaped `type(scope): summary`.
- Changelog = Keep a Changelog categories, entries in user-effect language, no file names.
- magna-carta: deploys are `git push origin main:release`; heavy **git worktree** usage for parallel agent streams with a tracked lifecycle.

---

## 8. Synthesis — style guide for the Jeopardy project

### Adopt outright (both repos agree)

1. **Stack**: pnpm (pinned via `packageManager`) + Node 22+ pinned in `.nvmrc`; **Vite+ (`vp`) for dev/build/test/lint/fmt** (Oxlint + Oxfmt, no Prettier/ESLint); TypeScript `strict` with the extra flags; **Svelte 5 runes only**; Vitest with co-located `*.test.ts` + `*.gate.test.ts` fitness tests; `svelte-check` in the gate.
2. **Cloudflare**: `wrangler.jsonc` (JSONC, `$schema` line, richly commented with rationale per binding), Workers Static Assets with `not_found_handling: "single-page-application"` and commented `run_worker_first`, D1 with **timestamp-named migrations** `YYYYMMDDHHMMSS_<slug>.sql` + migrations README ledger + a `check-migrations.ts` gate, secrets only via `wrangler secret put`, `observability.enabled: true`, `upload_source_maps: true`. **Deny `wrangler deploy` in `.claude/settings.json`**; deploys are deliberate and local.
3. **Formatting**: 2-space, LF, `.editorconfig`, double quotes, semicolons, printWidth 100, never hand-wrap, prose unwrapped. Pin the fmt block explicitly in `vite.config.ts`.
4. **Comments**: dense, why-not-what, self-contained (no references to planning docs — cite file paths instead), history recorded inline with dates for reversals. Comment configs and CI YAML too.
5. **Docs skeleton** (the template the owner would recognize as native):
   - `CLAUDE.md` (root) — what the product is, stack, **hard rules**, layout map with one-line-per-directory, quick start, cloud-session notes.
   - `docs/STATUS.md` — stamped live state (commit + date), reproduce-commands beside every claim, updated in the same commit as any state change.
   - `docs/decisions/YYYY-MM-DD-<slug>.md` — one-page dated decision records.
   - `docs/proposals/<feature>.md` — design docs per feature before building ("design before code").
   - `docs/architecture/` — deep-dives once they exist.
   - `docs/roadmap.md` — forward-looking only; shipped items pruned. (NOTE: for this project the owner explicitly wants a living ROADMAP updated as we go — see 00-user-directives.md.)
   - README — product-shaped: what it is, Features, Quick start, Documentation links, Stack, License.
   - Rule to carry over: docs updated **in the same commit** as behavior changes.
6. **CI** (single-app sagebrush pattern): PR-only, concurrency-cancel, versions read from repo pins, steps = check → lint → custom gates → test → build; every non-obvious choice commented.
7. **UI foundations**: design tokens as SSOT (CSS custom properties), Lucide icons through one wrapper, **no emojis anywhere**, no off-the-shelf component kit, layered `lib/` architecture with a never-import-upward rule, registry-pattern SSOTs for nav/sections.
8. **Validation**: match project size — hand-rolled lean validators with a typed error class for a small schema surface, zod only if the contract grows to warrant it. (NOTE: the architecture research recommends zod for the shared protocol package; reconcile at decision time — the protocol surface here is substantial, which leans zod.)
9. **Git**: everything via PR to `main`; commit style `area: imperative summary` (lowercase, no period) with a why-body; changelog in Keep a Changelog categories as user-visible effects.

### Divergences — ask the owner or default to the newer repo (magna-carta)

| Question                                  | sagebrush (older)                                         | magna-carta (newer)                              | Suggested default                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SvelteKit vs plain Vite + hand router** | Plain Vite + tiny custom router                           | SvelteKit (adapter-static SPA on Workers assets) | Brief says SvelteKit — use magna-carta's pattern                                                                                                         |
| **CSS**                                   | Plain scoped CSS + `tokens.css`, explicitly "No Tailwind" | Tailwind v4 + tokens + design system on Bits UI  | **Ask.** Genuine philosophical fork; for a small game app sagebrush's tokens.css + scoped styles is far lighter, but magna-carta is the newer conviction |
| **Component file naming**                 | PascalCase `EmptyState.svelte`                            | kebab-case `empty-state.svelte`                  | kebab-case (newer convention) — or ask                                                                                                                   |
| **Svelte quote style**                    | single quotes in `.svelte`                                | double everywhere                                | Double everywhere (formatter-consistent)                                                                                                                 |
| **Worker framework**                      | none (hand-rolled http.ts)                                | Hono + zod OpenAPI                               | Hand-rolled matches project size; Hono if routes multiply                                                                                                |
| **Decision records**                      | dated one-pagers                                          | numbered ADRs + generated register               | Dated one-pagers (right-sized)                                                                                                                           |
| **Em-dashes in prose**                    | banned repo-wide (hyphens only)                           | used in docs, emojis banned everywhere           | Hyphens-only in user-facing prose; ask about docs                                                                                                        |

### Also worth replicating for agent ergonomics

- `.claude/settings.json` with deploy denies + a SessionStart cloud-install hook; `scripts/cloud-install.sh` no-oping unless `CLAUDE_CODE_REMOTE=true`; a "Cloud sessions" section in CLAUDE.md (headless verification only, never deploy).
- Hard-rules section in CLAUDE.md written as short bolded imperatives with the enforcement mechanism named for each ("enforced by `<script>` in CI"; anything unenforced says so).
- Every custom gate is deterministic and runs in both CI and `pnpm test`; regenerating any generated artifact must leave the tree clean ("if a regeneration dirties the tree, that is drift, not noise").

**Key file citations**: `/workspace/magna-carta/CLAUDE.md`, `/workspace/magna-carta/vite.config.ts`, `/workspace/magna-carta/docs/conventions/{code-style,typescript,testing,documentation,documentation-style,ui-design}.md`, `/workspace/magna-carta/docs/conventions/area-claude-template.md`, `/workspace/magna-carta/apps/worker/wrangler.jsonc`, `/workspace/magna-carta/apps/web/svelte.config.js`, `/workspace/magna-carta/.github/workflows/gate.yml`; `/workspace/sagebrush-barrister/CLAUDE.md`, `/workspace/sagebrush-barrister/app/CLAUDE.md`, `/workspace/sagebrush-barrister/app/wrangler.jsonc`, `/workspace/sagebrush-barrister/app/vite.config.ts`, `/workspace/sagebrush-barrister/app/src/lib/styles/tokens.css`, `/workspace/sagebrush-barrister/.github/workflows/ci.yml`, `/workspace/sagebrush-barrister/docs/STATUS.md`, `/workspace/sagebrush-barrister/.claude/settings.json`.
