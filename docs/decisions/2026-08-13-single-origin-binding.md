# 2026-08-13 - Single origin: WebSockets ride the cross-script binding

## Context
The deployed `/dev/echo` page dialed the realtime Worker by public URL, requiring a `REALTIME_ORIGIN` build variable - misconfiguration shipped a localhost dial that triggered Chrome's Local Network Access popup. Owner asked: can we just connect through the binding instead?

## Decision
Yes - **single-origin is the M3 connection architecture.** Players, displays, and the host console all connect to `wss://<web-origin>/room/<CODE>/ws`; the web Worker forwards the upgrade to `GameRoomDO` through the cross-script Durable Object binding (`GAME_ROOM`, already declared in apps/web/wrangler.jsonc). The realtime Worker keeps its own URL only for ops/debug; nothing player-facing ever needs it.

## Why this is better
- **One origin, period**: one URL on the QR code, one custom domain later, no CORS, no second hostname on phones, and the entire `REALTIME_ORIGIN`-misconfiguration class of bugs (incl. the popup) ceases to exist.
- **No steady-state cost**: when a Worker returns a DO's 101 upgrade response, the intermediary drops out of the socket path - messages flow client<->DO; hibernation billing is unaffected.
- **PWA-friendly**: the service worker's same-origin worldview stays simple.

## What must be proven (M3 week-1 risk, replaces the old "phones hit realtime directly" assumption)
1. A WebSocket upgrade can pass through the SvelteKit-on-Workers request path. If SvelteKit 3's server routes cannot return a 101-with-socket, the known fallback is a thin custom entry: `main` points at a shim that checks `Upgrade: websocket` + `/room/*/ws` and forwards to the binding BEFORE delegating everything else to the Kit-generated handler. Validate against the pinned adapter early.
2. Local dev parity: vite-dev-side emulation of a cross-script DO call was the one untested piece in M0 (DEVELOPMENT.md); this decision makes it mandatory to validate. Fallback remains multi-config `wrangler dev`.

## Room lifecycle: creation is explicit (owner, 2026-08-13)

Connecting must never create a room. With `idFromName`, ANY code names a DO, so a naive design would instantiate rooms for every typo (the owner spotted this on the echo stub, which deliberately answers any code - stub-only behavior). The M3 contract:

1. **Create is an explicit host action**: "Host this game" -> web server route -> DO binding call that initializes room state (game definition, settings, host token) and returns the code. Codes are **server-allocated** (random, from the room-code alphabet), retried on collision with a still-active room - never user-chosen.
2. **Joining an uncreated/expired room is refused**: the WS upgrade for a code whose DO has no initialized state answers with a close/error ("no such room") - the friendly bad-code error in user-flows A1. The DO instance that briefly wakes to say "no" holds no state and costs effectively nothing; it evicts immediately.
3. **Lifecycle**: created -> lobby -> active -> ended -> expired (cleanup alarm, default 2h idle). Expired rooms free their code for reuse; a code in the wild for an expired room gets the same "no such room" answer.
4. Host identity for the room = a creation-time token (the host console presents it; no accounts involved).

## Consequences
- `/dev/echo` and `REALTIME_ORIGIN` are interim scaffolding; M3 replaces them with same-origin room routes (the env var and its dev-only localhost fallback get deleted).
- The realtime Worker no longer needs a public route for players; consider disabling its workers.dev URL after M3.
- The uncommented DO binding goes live in M3 (name already aligned: `jeopardy-machine-realtime`).
