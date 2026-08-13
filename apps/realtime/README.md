# @jeopardy/realtime

The realtime Worker: WebSocket-only surface owning `GameRoomDO` - one Durable Object per game room, addressed by `idFromName(roomCode)`, reached at `/room/<CODE>/ws`. Clients (phones, host console, board display) connect here directly; the SvelteKit Worker is a sibling that will reach the same DOs via a cross-script binding (commented in its wrangler.jsonc until M3).

- Transport is partyserver, hibernation enabled - transport ONLY; game logic never imports partyserver types (docs/decisions/2026-08-13-partyserver.md).
- M0 status: stub - welcome envelope on connect, envelope-validated echo, version-skew refusal. The real room protocol (roles, snapshot + patch, buzz ordering) is M3.
- Tests run inside workerd (`@cloudflare/vitest-pool-workers`); `pnpm test` here regenerates `worker-configuration.d.ts` first.
- `pnpm build` is a `wrangler deploy --dry-run`; real deploys are owner-run (docs/cloudflare-setup.md).
