# Status

> Stamp: verified against the M1 protocol phase, 2026-08-13 UTC (branch `claude/jeopardy-suite-research-rm1kao`). Prefer the reproduce-commands over the copied numbers - if they disagree, this file is stale; fix it in the same commit as whatever changed.

## Live state

| Claim                                                                               | Reproduce                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace installs clean (pnpm 10.33.0, Node 22)                                    | `pnpm install --frozen-lockfile`                                                                                                                     |
| All tests green: 3 packages, 107 tests (100 protocol, 3 realtime-in-workerd, 4 web) | `pnpm test`                                                                                                                                          |
| Typechecks green (svelte-check + tsc, incl. service-worker project)                 | `pnpm check`                                                                                                                                         |
| Lint + format gates green                                                           | `pnpm lint && pnpm exec vp fmt --check`                                                                                                              |
| Web app builds through adapter-cloudflare; realtime bundles via dry-run deploy      | `pnpm build`                                                                                                                                         |
| M1 document layer live: 4 portable formats parse through one entry point            | `pnpm -F @jeopardy/protocol test` (`parsePortableDocument`; migration machinery proven by the fixture-gated example migration)                       |
| Generated settings reference is current (registry-derived, drift-gated)             | `pnpm -F @jeopardy/protocol generate:settings-docs && git diff --exit-code docs/reference/settings.md`                                               |
| Local dev loop: browser -> SvelteKit page -> WebSocket -> GameRoomDO echo           | `pnpm dev`, then open http://localhost:5173/dev/echo (docs/DEVELOPMENT.md)                                                                           |
| Cross-script DO binding resolves `[connected]` in local multi-config dev            | uncomment the `durable_objects` block in apps/web/wrangler.jsonc, then `npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc` |

## Not yet true (so nobody assumes it)

- **Nothing is deployed.** Both Workers have never left local dev; first deploy is a manual owner step (docs/cloudflare-setup.md). CI has no deploy jobs on purpose.
- No D1 database, R2 bucket, or custom domain exists yet - the bindings sit commented in the wrangler.jsonc files.
- The M1 visual editor and IndexedDB repositories do not exist yet - the document schemas are consumable, but nothing authors or persists them (M1 phase 2). The M1 exit-criteria run (author/export/re-import/version-bump through the editor) is blocked on that.
- No real format has ever version-bumped: all four portable formats sit at 1.0.0 with empty migration chains (the machinery is exercised by the synthetic example migration only).
- The M0 milestone closes only when the owner's manual hello-world deploy succeeds (ROADMAP exit criteria).
