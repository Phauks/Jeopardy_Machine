# Buzz latency compensation

> Decision record · 2026-08-17 · M6 · Status: **landed**, both halves (protocol + engine + realtime + bots, then the web surfaces - see "What clients owe")

## The problem, stated honestly

Since M3 the buzz race has been decided by **server arrival order**: the first `buzz` frame the Durable Object reads wins, everything else is `too-late`. That is deterministic, replayable and trivially explainable - and it quietly measures the venue's Wi-Fi as much as anybody's thumb.

A phone with a 300ms round trip that presses 100ms EARLIER than a phone with a 30ms round trip still loses by ~170ms of network. At a real event that is not a rare edge: phones near the access point and phones behind a pillar differ by hundreds of milliseconds, while human reaction spread between two people who both "went for it" is tens. The research doc said so from day one (docs/research/01-game-anatomy.md §4: "with phones over a network, latency fairness matters: register client-side timestamps relative to the arm broadcast (or measure per-device latency offsets) rather than server arrival order"), and M3 deliberately deferred it here.

The design law is what shapes the fix: buzz adjudication is **locked to one state machine** (docs/design/expansion-and-boundaries.md boundary 2.1), and fairness compensation is named in that boundary as a **setting** on it, never an alternative algorithm. So the reordering happens strictly **upstream**: the engine keeps receiving one ordered list of actions and keeps crowning its first valid entry. Nothing in `packages/engine` learned about networks, clocks, or this document.

## What we measure instead

The TV analogue is the target: the enable lights come on for every contestant simultaneously, so the only quantity being measured is the thumb. We rank by **reaction time** - milliseconds between a phone RENDERING the arm and its human pressing.

Three numbers exist per buzz, and they are not equally trustworthy:

| Number             | Produced by                           | Can a client bend it?                                  |
| ------------------ | ------------------------------------- | ------------------------------------------------------ |
| `observedMs`       | the server: arrival - arm broadcast   | no (both ends are the server's own clock)              |
| `roundTripMs`      | the server: arm broadcast - `arm-ack` | it can INFLATE it by acking late; it cannot deflate it |
| `claimedElapsedMs` | the client                            | yes, completely                                        |

The credited reaction is:

```
credited = min( max( claimedElapsedMs , observedMs - allowance ) , observedMs )
allowance = min( roundTripMs , limits.buzz.maxCompensationMs )   // 0 when unmeasured
```

Implementation: `packages/protocol/src/room/buzz-fairness.ts` (pure, and the same module the race harness ranks with, so the server and its test harness cannot drift apart).

Why each clamp is there:

- **`max(claim, observed - allowance)`** - the claim can never make a press faster than physics allows. An honest phone's two terms agree and it is credited its true reaction; a lying phone is floored at what the server would have credited it anyway.
- **`allowance = min(roundTrip, cap)`** - the credit is bounded whatever the measurement says, which is what makes ack-stalling pointless past the cap.
- **unmeasured ⇒ allowance 0** - refusing to ack must never be profitable. A client that will not be measured is ranked by raw arrival, exactly as in M3.
- **`min(..., observedMs)`** - a press is never recorded as later than the moment the server heard about it.

## Threat model

**What an adversary controls:** the `elapsedMs` on its own buzz, whether and when it sends `arm-ack`, and when it presses. It runs on its own phone, in a browser we do not control, on a network we do not control. There is no attestation and there will not be one (players never log in - guiding principle 3).

**What an adversary can do, exactly:** be credited a reaction up to `limits.buzz.maxCompensationMs` (250ms) faster than its true one, by claiming a zero elapsed and stalling its ack until the measurement saturates the cap. It can therefore beat an honest rival who genuinely pressed up to a quarter second earlier, if it also gets its buzz in before the window closes.

**What it cannot do:**

- exceed that bound - the gain is `min(measured round trip, 250ms)`, and nothing a client sends raises the ceiling;
- gain more than an honest client on the same connection is already given - the compensation a liar steals is exactly the handicap an honest phone on that connection is owed, which is the deepest statement available here;
- affect anybody else's buzz - the arithmetic is per-buzz and the ordering is a total order over credited reactions;
- win by arriving after the window closed - a late frame reaches the engine as `too-late` like any other;
- forge an arming - `armId` comes from the server; a claim stamped with a stale id is dropped (not punished);
- learn anything new - the arm broadcast carries no secrets, and the ack carries nothing at all.

**The residual risk is deliberate and priced.** Compensating an unverifiable handicap always means crediting a claim you cannot check; the only question is how much. Setting the cap lower shrinks the cheat and the honest compensation by the same amount - at 0ms this is M3's arrival order, at 250ms it cancels roughly a p95 venue round trip. 250ms is the point where the worst cheat is comparable to one human reaction time rather than a free win, and it is a maintainer-tuned operational limit (`@jeopardy/protocol/limits`), not a host setting, precisely because it is a safety property.

Two smaller notes, recorded so they are not rediscovered as bugs:

- A phone with a **genuinely** worse connection than the cap is only partly compensated. That is the same clamp doing its job, and it is honest: we compensate what we can bound.
- The window itself bounds the damage further. A cheat can only overturn presses that landed inside the same holding window.

## The window: why waiting is unavoidable, and how little we wait

Reordering requires holding. A slower phone's earlier press physically arrives after a faster phone's later one, so a room that adjudicates on the first frame has already discarded the information.

The DO therefore holds one arming's buzzes (`apps/realtime/src/room/arm-window.ts`) and closes the window at the earliest of:

- **the fairness deadline** - with the leader credited at R, no arrival after `armedAt + R + cap` could be credited faster, so the race is already decided;
- **the host's window** - `settings.buzzing.compensationWindowMs` past the first press, so the room never feels stuck.

The window is **storage, not memory**, and its deadline is an entry in the existing multiplexed alarm book. Hibernation can evict the instance between the arm and the press; a lost press would be a clue nobody won. Round-trip samples ride the same record but are only flushed with the first buzz - a 100-phone room must not pay 100 storage writes for numbers that expire with the arming.

Held presses are flushed **before any other action reaches the engine** (a host's "no takers", a judge verdict, an expiring buzz-window timer). Without that rule the 5-second buzz timeout could kill a clue somebody had legitimately rung in on.

## Measuring the round trip: `arm-window` / `arm-ack`

The DO broadcasts `arm-window { armId, at, compensationMs, rebound }` the instant buzzers arm. Every joined client replies `arm-ack { armId }` immediately; arrival minus broadcast is that connection's round trip, measured **with the server's own clock, over exactly the path the buzz will travel, at the only moment it matters**.

Why not something else:

- **The existing `ping`/`pong` auto-response** answers inside the runtime without waking the DO (which is exactly why it exists - hibernation), so the DO learns nothing from it. Keeping it and adding a separate measurement is strictly better than trading hibernation for telemetry.
- **A client-reported RTT** would be a second unverifiable number, inflatable at will - the thing the clamp exists to avoid.
- **A periodic probe** would keep the room awake between clues, which the architecture forbids for cost reasons. Measuring at the arm costs one frame per player per arming, only while a room is actively playing, and never wakes a sleeping room.

Samples are per arming and per connection: a new socket (a phone that reconnected) is a new measurement, and a sample older than the current arming is never reused. A client that reconnects INTO an open arming is sent the `arm-window` at once so it can still be measured and still race.

## The setting, and its default

Two rows on the buzzing group (`packages/protocol/src/settings/groups/buzzing.ts`), both `matrixRow: null` - the 43-row matrix inventories the SHOW's rules, and the show has no network:

| Setting                        | Values   | Default |
| ------------------------------ | -------- | ------- |
| `buzzing.latencyCompensation`  | on / off | **on**  |
| `buzzing.compensationWindowMs` | 0-500 ms | 250     |

**Default ON.** The argument for OFF is real and was weighed: it costs nothing, it adds no delay to the most visible moment of the game, and in a room where every phone is on the same good access point it changes no outcomes. The argument for ON wins anyway:

1. **The unfairness is the common case, not the exotic one.** Round trips across a hall spread by hundreds of milliseconds; human reaction differences between two people racing the same clue are tens. Off by default means the median room's buzz races are decided mostly by Wi-Fi, and nobody in the room can see that happening.
2. **Nobody will find the toggle.** A setting that must be discovered to make the product's headline feature honest is not really a setting, it is a disclaimer.
3. **The failure mode is graceful in both directions.** A client that sends nothing is ranked by arrival - i.e. exactly M3 - so turning it on cannot break an un-wired surface. And a room that turns it off gets the old behavior with no residue.
4. **The cost is bounded and small**: at most 250ms between the press and the room's ding, usually less because the window closes as soon as the race is decided. The presser's own phone gives optimistic feedback immediately (user-flows A4), so the person who buzzed feels nothing.

`compensationWindowMs` defaults to 250 - equal to the credit ceiling, which is what makes the algorithm **complete**: it can never exclude a buzz that could have won. Lowering it trades fairness for immediacy, and 0 makes compensation inert without touching the on/off row.

## What clients owe (the web surfaces' half)

Wiring a surface is three lines, and none of them require clock synchronization:

1. On `arm-window`, record the **local** time the message was rendered - that is this phone's t0.
2. Send `arm-ack { armId }` **immediately**, before painting anything (work done first is measured as latency that is not there).
3. Attach `timing: { armId, elapsedMs }` to the buzz action, elapsed measured from step 1.

`packages/bots/src/bot.ts` is the reference implementation. Until a surface does this it is ranked by arrival: never penalized below M3 behavior, never compensated either.

**Landed on the web surfaces 2026-08-17**, and the two places it lives are the two ends of the room-store seam:

- `apps/web/src/lib/room/ws-room-store.svelte.ts` owns the wire. `arm-ack` is the FIRST statement of the `arm-window` branch, ahead of the state write, because the reply time is the measurement and anything done before it is charged to that phone as latency it does not have. The arming lands on `RoomView.arming` with a null paint time, and `buzz()` attaches `timing` only when there is a paint behind it - an unstamped buzz is the honest output for a surface that never showed the button, and the room ranks it by arrival.
- `apps/web/src/lib/room/buzzer-screen.svelte` owns the paint. An `$effect` runs after the DOM is updated, which is the closest a component gets to "the player could see it", and it calls `store.markArmedPainted(armId)` there. The store keeps the FIRST paint: a re-render, or the screen's coarse clock ticking five times a second, must not move t0 forward under a player who has been staring at a hot button for half a second.

Two things fell out of wiring it, both worth naming:

**The paint is the only defensible t0, and only the surface knows it.** Measuring from message receipt would credit this phone for its own render work - tens of milliseconds of framework, layout and paint that are not reaction time by any definition. So the store cannot compute it and does not try; the seam grew one method (`RoomStore.markArmedPainted`) rather than a guess. The local simulation implements it as a no-op and reports `arming: null`, because a store that adjudicates a press in the same tick as the press has no race to rank and no network to compensate.

**The window holds the announcement; it must never look like it holds your button.** The presser's own confirmation is already instant (optimistic `myBuzz: pending` set before the send, plus flash and haptic before any store work), but the button then sat there hot for the length of the window - which reads as "that did not register" and invites a second press at a room that has already heard the first. It now says BUZZED and drops its pulse for exactly as long as the room is deciding. Nothing about that beat waits on the network; it is the local optimistic state given a face.

A third fix rode along, from the same message: `snapshot.timers` seeds the timer hints every surface already renders (`pendingTimersFromRoom` in `room-fold.ts`), so a phone that slept through the arm and a console reopened mid-answer come back to a running countdown rather than a frozen one. `durationMs` is set to the REMAINING time on purpose - the room reports what is left, never what was originally set, so a bar seeded this way starts full and empties exactly when the window closes. It states how long you have, and does not pretend to know how much has gone.

## Consequences

- `packages/engine` is untouched by the mechanism (one narration fix aside, below). The buzz transition still takes an ordered list and still fires exactly one `buzz-won` per arming.
- `snapshot` grew `timers` (the room's running countdowns, as remaining ms), which is a C6 fix in its own right: a console reopening mid-clue had no way to know how long the answer window had left.
- The alarm book is pruned by phase after each transition. Stale entries were harmless when they only fired as rejections; once snapshots reported timers, a phantom countdown was worse than a wasted wake.
- Two defects found while wiring this and fixed in the same commit: `buzz-rejected` was riding the PUBLIC event stream (the wire contract has always called it per-phone feedback), and a mashed early-buzz re-triggered its penalty without telling the presser the new deadline.

## Measurement (this is the point)

`packages/bots` grew a fairness harness: `latency.ts` (seeded per-direction delay simulation - fast / slow / jittery phones) and `race.ts` (predict, judge, aggregate, format). Predictions are computed with the SERVER's ordering module, so agreement proves the server and disagreement is a defect rather than two arithmetics drifting; what the harness adds is the ground truth a server can never have - each racer's real reaction and real network.

Against a live single-origin dev room (`pnpm dev:rooms`), five racers on mixed simulated networks, same seed both arms:

```
pnpm -F @jeopardy/bots bots -- --create --race 4 --seed demo2
4 races - fastest thumb won 4, network would have decided 4, compensation changed 4, mismatches 0

pnpm -F @jeopardy/bots bots -- --create --race 4 --seed demo2 --no-compensation
4 races - fastest thumb won 0, network would have decided 4, compensation changed 0, mismatches 0
```

Same field, same seeds, same simulated networks: with compensation the earliest thumb won every race; without it the best connection won every race. That A/B is the whole claim, and it is repeatable.

## Alternatives rejected

- **Trust the client's timestamp outright.** One line simpler, and the first person who reads the protocol wins every buzz for the rest of the night.
- **Wall-clock synchronization (NTP-style offset per phone).** More machinery, more state, and the offset is still a client-influenced number - it moves the problem without changing the threat model.
- **Compensate by a rolling average round trip.** Cheaper than per-arming acks, but an average measured between clues describes a network that has since changed, and it invites the "poison your own average" attack the per-arming measurement forecloses.
- **A second adjudication algorithm behind a setting.** Forbidden by boundary 2.1, and rightly: two referees is how a live event turns into a rules argument.
