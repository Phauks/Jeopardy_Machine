# @jeopardy/bots

Bot players (owner directive "Development simulation", realtime level): headless clients that speak the real room WebSocket protocol - the same `join`/`resume`, the same `action` relay, the same server catalog phones use - against a real `GameRoomDO`. Highest-fidelity simulation layer: every bot game exercises exactly the code paths phones exercise. Consumers: the `apps/realtime` workerd suite, the Playwright end-to-end test, the CLI below, and later the M4 host-console sim panel.

| Module                    | What                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@jeopardy/bots/bot`      | `Bot` - joins/resumes, tracks its seat, reacts to engine events (seeded buzz latency + probability, wagers, typed/final answers); `sendAction`/`waitFor` for scripted tests           |
| `@jeopardy/bots/behavior` | `BotBehavior` config + `SeededStream` (engine-rng-backed, so pinned seeds replay identical bot decisions - the reproducibility directive extends to simulation)                       |
| `@jeopardy/bots/latency`  | Simulated phone networks: seeded per-direction delay + jitter around any `BotSocket` (`wired`/`fast`/`slow`/`jittery`), so a buzz race measures fairness instead of demonstrating it  |
| `@jeopardy/bots/race`     | The fairness harness: `predictRace` / `judgeRace` / `reportRaces` / `formatRaceReport` - who won, who WOULD have won on arrival order, and whether the fastest thumb was crowned (M6) |
| `@jeopardy/bots/socket`   | The minimal `BotSocket` surface (browser WebSocket, node 22 global WebSocket, and workerd's accepted sockets all satisfy it) + `openWebSocket` for node/browser dialing               |

Bots are players only, never hosts: arming, judging, and board selection stay with whoever holds the host connection (a test, the CLI's `--host` driver, or a human console), so the role-authority matrix is honestly exercised rather than bypassed.

## CLI

```sh
# against the single-origin dev server (docs/DEVELOPMENT.md: multi-config wrangler dev)
pnpm -F @jeopardy/bots bots -- --create --count 5 --host   # create a room, bots + host driver play it out
pnpm -F @jeopardy/bots bots -- --room BQKX7 --count 3      # join an existing room (your console hosts)
pnpm -F @jeopardy/bots bots -- --origin http://localhost:8788 --create --host --seed repro-42
```

`--race N` runs the fairness harness instead: each bot gets a simulated network and a fixed reaction time, and the run prints a per-race table plus the aggregate. `--no-compensation` creates the room with `buzzing.latencyCompensation` off, which is the CONTROL arm - same seeds, same networks, arrival-ordered - so the two runs side by side ARE the measurement:

```sh
pnpm -F @jeopardy/bots bots -- --create --race 4 --seed demo2
# 4 races - fastest thumb won 4, network would have decided 4, compensation changed 4, mismatches 0
pnpm -F @jeopardy/bots bots -- --create --race 4 --seed demo2 --no-compensation
# 4 races - fastest thumb won 0, network would have decided 4, compensation changed 0, mismatches 0
```

Bots implement the client half of latency compensation (ack the `arm-window`, stamp the buzz with elapsed-since-arm) and can be told to play the adversary instead - `behavior.elapsedClaim: "zero"` lies about its reaction, `acknowledgeArming: false` refuses to be measured - which is how the workerd suite proves the server's clamp end to end.

`--host` opens a host connection with the creation token and drives a minimal loop (start, select first hidden cell, arm, judge the winner correct, proceed) so a bots-only room plays to game-over. Without it, bots idle in the lobby for a human host. `--seed` pins every bot decision for reproducible runs.

No build step; ships raw TypeScript (the CLI runs via `node --experimental-strip-types`).
