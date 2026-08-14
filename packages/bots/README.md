# @jeopardy/bots

Bot players (owner directive "Development simulation", realtime level): headless clients that speak the real room WebSocket protocol - the same `join`/`resume`, the same `action` relay, the same server catalog phones use - against a real `GameRoomDO`. Highest-fidelity simulation layer: every bot game exercises exactly the code paths phones exercise. Consumers: the `apps/realtime` workerd suite, the Playwright end-to-end test, the CLI below, and later the M4 host-console sim panel.

| Module                    | What                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@jeopardy/bots/bot`      | `Bot` - joins/resumes, tracks its seat, reacts to engine events (seeded buzz latency + probability, wagers, typed/final answers); `sendAction`/`waitFor` for scripted tests |
| `@jeopardy/bots/behavior` | `BotBehavior` config + `SeededStream` (engine-rng-backed, so pinned seeds replay identical bot decisions - the reproducibility directive extends to simulation)             |
| `@jeopardy/bots/socket`   | The minimal `BotSocket` surface (browser WebSocket, node 22 global WebSocket, and workerd's accepted sockets all satisfy it) + `openWebSocket` for node/browser dialing     |

Bots are players only, never hosts: arming, judging, and board selection stay with whoever holds the host connection (a test, the CLI's `--host` driver, or a human console), so the role-authority matrix is honestly exercised rather than bypassed.

## CLI

```sh
# against the single-origin dev server (docs/DEVELOPMENT.md: multi-config wrangler dev)
pnpm -F @jeopardy/bots bots -- --create --count 5 --host   # create a room, bots + host driver play it out
pnpm -F @jeopardy/bots bots -- --room BQKX7 --count 3      # join an existing room (your console hosts)
pnpm -F @jeopardy/bots bots -- --origin http://localhost:8788 --create --host --seed repro-42
```

`--host` opens a host connection with the creation token and drives a minimal loop (start, select first hidden cell, arm, judge the winner correct, proceed) so a bots-only room plays to game-over. Without it, bots idle in the lobby for a human host. `--seed` pins every bot decision for reproducible runs.

No build step; ships raw TypeScript (the CLI runs via `node --experimental-strip-types`).
