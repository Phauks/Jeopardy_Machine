# 2026-08-13 - M0 version pins (and what the SvelteKit 3 prerelease actually changed)

All versions verified against the npm registry on 2026-08-13 and pinned **exact** in the workspace catalog (`pnpm-workspace.yaml`). Upgrades are deliberate, one line at a time, in their own commit.

## The pins

| Package                             | Pin                              | Why this one                                                                                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sveltejs/kit`                     | `3.0.0-next.23`                  | Owner decision (docs/decisions/2026-08-13-stack-choices.md): build on the SK3 prerelease from day one. Latest `next` at pin time.                                                                                                                                    |
| `@sveltejs/adapter-cloudflare`      | `8.0.0-next.6`                   | The adapter's own prerelease line is the one that peers on kit `^3.0.0-next.0`; stable 7.x peers on kit 2 only. Works: `vite build` + `wrangler deploy --dry-run` verified. Emits one deprecation warning (reads `config.kit` internally) - cosmetic, theirs to fix. |
| `svelte`                            | `5.56.9`                         | Latest stable; kit@next requires `^5.56.4`.                                                                                                                                                                                                                          |
| `@sveltejs/vite-plugin-svelte`      | `7.3.0`                          | kit@next requires `^7.0.0`.                                                                                                                                                                                                                                          |
| `vite`                              | `8.2.1`                          | kit@next requires `^8.0.12`. Vite 8 = rolldown-based.                                                                                                                                                                                                                |
| `vite-plus`                         | `0.2.9`                          | The owner's `vp` toolchain (dev/build/test/lint/fmt). Bundles vitest 4.1.10, oxlint 1.77.0, oxfmt 0.62.0 - exactly compatible with the pins below.                                                                                                                   |
| `vitest`                            | `4.1.10`                         | Matches the version vite-plus bundles AND the `^4.1.0` peer of vitest-pool-workers.                                                                                                                                                                                  |
| `@cloudflare/vitest-pool-workers`   | `0.21.3`                         | Latest; first line compatible with vitest 4.                                                                                                                                                                                                                         |
| `wrangler`                          | `4.123.0`                        | Latest; adapter-cloudflare@next requires `^4.118.0`.                                                                                                                                                                                                                 |
| `typescript`                        | `6.0.3`                          | kit@next peers `^6.0.0` and svelte-check peers 5.x/6.x - so NOT TypeScript 7 (7.0.2 is latest, the Go-native rewrite) until the Svelte toolchain peers allow it. 6.0.3 is the latest 6.x.                                                                            |
| `tailwindcss` + `@tailwindcss/vite` | `4.3.3`                          | Latest v4.                                                                                                                                                                                                                                                           |
| `zod`                               | `4.4.3`                          | Latest stable v4.                                                                                                                                                                                                                                                    |
| `svelte-check`                      | `4.7.6`                          | Latest.                                                                                                                                                                                                                                                              |
| `partyserver`                       | `0.5.10`                         | See docs/decisions/2026-08-13-partyserver.md. Pinned in apps/realtime directly (single consumer, not catalog-worthy yet).                                                                                                                                            |
| Node                                | 22 (`.nvmrc`), engines `>=22.17` | kit@next requires node `>=22.17`.                                                                                                                                                                                                                                    |
| pnpm                                | `10.33.0` (`packageManager`)     | Version in active use at scaffold time.                                                                                                                                                                                                                              |

## SvelteKit 3 breaking changes we actually hit (none of this is in the SK2 docs)

Recorded here because every tutorial and most model training data describe SK2. The M0 scaffold is the in-repo example of all of the following:

1. **`svelte.config.js` is gone.** All kit config is options to the `sveltekit()` plugin in `vite.config.ts` (`sveltekit({ adapter, preprocess, compilerOptions })`).
2. **`$lib` alias is gone.** Node subpath imports replace it: `"imports": { "#lib/*": "./src/lib/*" }` in the app's package.json, imported as `#lib/...`.
3. **`$env/static/*` and `$env/dynamic/*` are gone.** Variables are declared in `src/env.ts` via `defineEnvVars` from `@sveltejs/kit/env` (per-var `public`/`static` flags + optional schema) and imported from `$app/env/public` / `$app/env/private`.
4. **`$service-worker` is gone.** Replacement trio: `$app/manifest` (`immutable`/`assets`/`prerendered` as `{ path }` objects), `$app/service-worker` (correctly-typed `self`), `$app/env` (`version`).
5. **Generated tsconfig moved.** `svelte-kit sync` writes `node_modules/$app/tsconfig.json` (+ a `$app/tsconfig/service-worker` variant with WebWorker libs); the app tsconfig extends `"$app/tsconfig"`, not `./.svelte-kit/tsconfig.json`. The service worker gets its own directory + tsconfig and its own `tsc -p` in the check script.
6. **Tooling interplay**: configs that SvelteKit's plugin hooks run inside must set `root: import.meta.dirname` or workspace-root tools that evaluate them from another cwd (oxlint via `vp lint`) blow up in kit's sync step.

## Toolchain notes

- `@cloudflare/vitest-pool-workers` 0.21.x replaced `defineWorkersConfig` (from the removed `/config` export) with a Vite plugin: `cloudflareTest({ wrangler: { configPath } })` from the package root.
- Workers runtime types come from `wrangler types` (generated `worker-configuration.d.ts`, gitignored), not `@cloudflare/workers-types`.

## Fallback position

None needed - the full pinned combination builds, tests, and dry-run-deploys together. If a future `next` bump breaks the kit/adapter pair, hold both pins (they move as a pair) and record the breakage here.
