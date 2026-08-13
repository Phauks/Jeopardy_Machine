# 2026-08-13 - partyserver: use it (as transport only)

## Context

The architecture research (docs/research/03-architecture.md §7) flagged Cloudflare's `partyserver` (PartyKit-style DX on native Durable Objects) as an accelerator to evaluate in M0 week 1, alongside the local-dev-loop validation. Evaluated against `partyserver@0.5.10` - installed, source and types read end to end (the whole library is ~950 lines built), and exercised for real: the M0 `GameRoomDO` stub is built on it and passes `@cloudflare/vitest-pool-workers` tests inside workerd with hibernation enabled.

## What it is

`Server` - a ~950-line class extending `DurableObject` from `cloudflare:workers` - plus two routing helpers (`getServerByName`, `routePartykitRequest`). It provides: room addressing by name, connection lifecycle hooks (`onConnect` / `onMessage` / `onClose` / `onError`), a connection manager that works identically hibernated and non-hibernated (opt-in via `static options = { hibernate: true }`), per-connection ids/tags/state persisted in WebSocket attachments across hibernation, `broadcast(msg, except)`, an `onAlarm` passthrough, and a `sql` tagged-template over DO SQLite. Maintained by Cloudflare in the `cloudflare/partykit` monorepo: 55 releases in the 12 months to Aug 2026, latest 10 days before this evaluation. Single runtime dependency (`nanoid`).

## Fit assessment

| Concern                 | Finding                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hibernation             | Supported, opt-in, and it is exactly the fiddly part we would otherwise hand-roll: the hibernating connection manager re-derives connection identity from attachments after eviction. Verified working in workerd tests.                                      |
| Heartbeat auto-response | NOT wired by partyserver - it never calls `setWebSocketAutoResponse`. We set the ping/pong pair ourselves in `onStart` (one line; done in the stub). Billing-relevant, so worth stating loudly.                                                               |
| Room codes              | `getServerByName(env.GAME_ROOM, code)` is `idFromName` underneath - our room-code addressing maps 1:1. We route `/room/<CODE>/ws` by hand and skip `routePartykitRequest`, whose `/parties/<class>/<name>` URL scheme would leak into user-visible join URLs. |
| SvelteKit coexistence   | None needed: partyserver lives only in `apps/realtime` (plain Worker). The two-Worker split already isolates it from the SvelteKit build entirely.                                                                                                            |
| Testing                 | `Server` subclasses are ordinary DO exports; `@cloudflare/vitest-pool-workers` runs them natively (proven by the M0 stub suite).                                                                                                                              |
| Weight                  | ~950 lines + nanoid. Comfortably inside the dependency-weight consciousness bar; it replaces more code than it adds.                                                                                                                                          |
| Churn risk              | 0.x with visible API deprecations mid-flight (`serializeAttachment` -> `setState`, `party` -> `className`). Same posture as our SvelteKit 3 prerelease decision: pin exact, upgrade deliberately, treat breakage as ordinary maintenance.                     |
| Client side             | Sibling `partysocket` (reconnection with backoff) is a natural fit for the phone buzzer in M4 - separate decision then, not bundled into this one.                                                                                                            |

## Decision

**Use partyserver in `apps/realtime`, with a hard boundary: it owns transport only.** Connection lifecycle, hibernation bookkeeping, room routing, broadcast - partyserver. Everything the product is judged on - buzz adjudication, scoring, room state machine, snapshot + patch protocol, session-token reconnection semantics - is our code, implemented in the `onMessage`/`onConnect` handlers and modules behind them, and the locked buzz core (docs/design/expansion-and-boundaries.md, boundary 2.1) never delegates ordering decisions to library behavior.

Enforced convention: **game-logic modules must not import partyserver types.** Only the DO class file (`apps/realtime/src/game-room-do.ts`) touches the library, so the ejection path stays real: if partyserver ever fights the M3 design (buzz windows, alarms, storage layout), we replace the one class with a hand-rolled `DurableObject` using the same runtime primitives it wraps - the architecture doc §3 documents those primitives precisely for this reason.

## Consequences

- M3's DO work builds on `Server` hooks instead of raw `webSocketMessage` handlers; the hibernation-eviction tests planned for M3 must exercise partyserver's connection recovery, not assume it.
- We own `setWebSocketAutoResponse` and must keep verifying (pilot-game measurement, architecture risk 5) that heartbeats do not wake the DO.
- Version pinned exact (0.5.10) in apps/realtime; upgrades are deliberate single-line commits like every other pin.
