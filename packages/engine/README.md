# @jeopardy/engine

The M2 rules engine: the whole game as a pure state machine - `transition(state, action, setup) -> { state, events }`. No network, no DOM, no clocks: time arrives as data on actions (`at` timestamps), timers exist only as `timer-set` hint events that the driver answers with expiry actions, and every random draw (wager-cell placement, first selector, tie draws) comes from a seeded generator whose state lives in `GameState`. The same seed and action array always replay to the identical game.

Three consequences fall out of the append-only action log in `GameState.actionLog`:

- **Undo** (guiding principle 4, always on): the `undo` action replays the log minus its tail over a fresh initial state - the result is exactly the prior state, rng and lockouts included.
- **Crash recovery**: a room can rebuild a live game by replaying its log.
- **Simulation fixtures** (owner directive "Development simulation"): `fixtures/*.json` are complete replayable games - compact board + preset-plus-overrides settings + seed + action array - replayed by the test suite and reusable by M3 bots and the M4 sim panel.

The engine is total: an invalid or stale action returns the same state object plus an `action-rejected` event; it never throws mid-game. One adjudication contract worth naming (owner directive "Only the winning buzz is heard"): `buzz-won` fires exactly once per arming - room audio keys off that event alone; losing buzzes get `buzz-rejected`, which is per-phone feedback, never room audio.

Import via the exports map, never deep paths (no barrels):

| Module                        | What                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@jeopardy/engine/setup`      | `GameSetup` (resolved settings + concrete board values + seed), `setupFromGameDefinition`, `plainRoundSetup` |
| `@jeopardy/engine/state`      | `GameState`, `GamePhase`, `createInitialState`, `entityForPlayer`, `cellKey`                                 |
| `@jeopardy/engine/actions`    | The full action catalog as zod schemas (`gameActionSchema`) - the only way anything happens                  |
| `@jeopardy/engine/events`     | `GameEvent` - what a transition tells the drivers (host console, board, room audio, bots)                    |
| `@jeopardy/engine/transition` | `transition(state, action, setup)` - the single entry point                                                  |
| `@jeopardy/engine/simulate`   | `simulate(actions, setup)` - fold a whole action array, get final state + per-step events                    |
| `@jeopardy/engine/fixture`    | The scenario-fixture schema + `setupFromFixture` (the format under `fixtures/`)                              |
| `@jeopardy/engine/rng`        | Seeded PRNG helpers (state-in, state-out; nothing global)                                                    |

The engine never sees prompt or answer text - a clue is `(round, category, row, value)`; content stays in the content layer (guiding principle 6) and the hosting surface joins them. Settings come fully resolved from `@jeopardy/protocol` (`resolveGameRules` / `resolvePreset`); every settings row that changes engine behavior is covered by a test naming its matrix row (`docs/reference/settings.md`).

Deliberate engine-level calls, documented here because the settings table cannot express them: a wager cell hit with no controlling entity (host-picks / auto-sweep games) plays as a plain clue; `match-lowest` late-join scores match the literal lowest (host override is the escape hatch); wrong answers in everyone-answers mode never deduct; the final round's wager is always at risk regardless of row #17 (floor-at-zero still floors); sudden-death tiebreakers are stakes-free and skip the early-buzz penalty.

Tests co-located per area (`buzzing.test.ts`, `final.test.ts`, ...); `fixture.test.ts` replays every scenario in `fixtures/` twice and diffs the runs to prove determinism. Ships raw TypeScript (no build step); consumers bundle it. Works in Workers, browsers, and node (the only node-specific imports live in test files).
