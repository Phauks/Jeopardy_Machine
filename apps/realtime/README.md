# @jeopardy/realtime

The realtime Worker: WebSocket-only surface owning `GameRoomDO` - one Durable Object per game room, addressed by `idFromName(roomCode)`, speaking the room protocol from `@jeopardy/protocol/room/*`. Since M3, players/displays/hosts connect through the SINGLE ORIGIN (`wss://<web-origin>/room/<CODE>/ws`, forwarded by the web Worker's cross-script binding - docs/decisions/2026-08-13-single-origin-binding.md); this Worker's own `/room/<CODE>/ws` route remains for ops/debug and direct-worker testing.

What the DO does (`src/game-room-do.ts` + the pure modules under `src/room/`):

- **Explicit lifecycle**: rooms exist only after the typed `POST /initialize` RPC (reachable exclusively through the DO binding - the public router forwards nothing but WS upgrades). Uninitialized or expired codes refuse upgrades with `no-such-room`; an idle-expiry alarm (limits.room.idleExpiryMs) wipes the room and frees its code.
- **The engine feed**: relayed actions are authority-checked (`room/authority`), stamped with server arrival time + session identity (`src/room/engine-glue.ts`), run through `@jeopardy/engine`'s `transition`, persisted, and narrated as redacted event batches (`src/room/redact.ts` - phones never receive Daily-Double locations, secret final wagers, or others' typed answers). Arrival order IS buzz order; exactly one room-level `buzz-won` per arming carries the resolved room-audible sound (team's in teams mode).
- **Timer hints -> alarms**: engine `timer-set` events become scheduled expiry actions in a multiplexed alarm book (`src/room/storage.ts`) alongside leader-disconnect succession checks and the expiry deadline; stale timers fire as harmless engine rejections.
- **Sessions**: players get a server-minted seat (`p-<n>`) plus a secret resume token; `resume` restores the exact seat on a fresh socket. Roster + team docs (the two customization tiers) live in DO storage, hibernation-safe; the engine only learns seats at `start-game` (lobby stays team-fluid).

Storage layout is documented at the top of `src/room/storage.ts`. Hard boundary: transport is partyserver, hibernation enabled - transport ONLY; game logic and the `src/room/*` modules never import partyserver types (docs/decisions/2026-08-13-partyserver.md).

Tests run inside workerd (`@cloudflare/vitest-pool-workers`) against the real DO - including forced instance eviction (`evictDurableObject`) mid-game and alarm firing (`runDurableObjectAlarm`); `pnpm test` here regenerates `worker-configuration.d.ts` first. Bot players from `@jeopardy/bots` drive the game-flow suites over real sockets. `pnpm build` is a `wrangler deploy --dry-run`; real deploys are owner-run (docs/cloudflare-setup.md).
