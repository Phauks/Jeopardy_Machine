# Status

> Stamp: verified against the M0 scaffold, 2026-08-13 UTC (branch `claude/jeopardy-suite-research-rm1kao`). Prefer the reproduce-commands over the copied numbers - if they disagree, this file is stale; fix it in the same commit as whatever changed.

## Live state

| Claim                                                                             | Reproduce                                                                                                                                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace installs clean (pnpm 10.33.0, Node 22)                                  | `pnpm install --frozen-lockfile`                                                                                                                     |
| All tests green: 3 packages, 17 tests (10 protocol, 3 realtime-in-workerd, 4 web) | `pnpm test`                                                                                                                                          |
| Typechecks green (svelte-check + tsc, incl. service-worker project)               | `pnpm check`                                                                                                                                         |
| Lint + format gates green                                                         | `pnpm lint && pnpm exec vp fmt --check`                                                                                                              |
| Web app builds through adapter-cloudflare; realtime bundles via dry-run deploy    | `pnpm build`                                                                                                                                         |
| Local dev loop: browser -> SvelteKit page -> WebSocket -> GameRoomDO echo         | `pnpm dev`, then open http://localhost:5173/dev/echo (docs/DEVELOPMENT.md)                                                                           |
| Cross-script DO binding resolves `[connected]` in local multi-config dev          | uncomment the `durable_objects` block in apps/web/wrangler.jsonc, then `npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc` |

## Not yet true (so nobody assumes it)

- **Nothing is deployed.** Both Workers have never left local dev; first deploy is a manual owner step (docs/cloudflare-setup.md). CI has no deploy jobs on purpose.
- No D1 database, R2 bucket, or custom domain exists yet - the bindings sit commented in the wrangler.jsonc files.
- `packages/protocol` contains only the M0 surface (envelope, ext bag, limits); the four document schemas are M1 (proposal under review: docs/proposals/m1-protocol.md).
- The M0 milestone closes only when the owner's manual hello-world deploy succeeds (ROADMAP exit criteria).
