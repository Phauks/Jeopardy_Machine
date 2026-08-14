# Play surfaces: routes, the room-store seam, and the M3 reconcile

> 2026-08-14 · M4 phase 2. The three play UIs (phone, display, console) as real routes over ONE typed client store, built mock-first: the complete implementation is a local simulation of the room (engine + fixtures), and the WebSocket implementation is a documented stub wired when M3's `GameRoomDO` lands. Spec: docs/design/user-flows.md (A2-A4, C1-C7). Tokens: docs/design/theming.md.

## Route map

| Route                  | Surface                                                                                                                                                                                         | Store role |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `/room/[code]`         | Player path: A2 join (nickname, avatar+accent, buzzer sound with local preview, team cards) -> A3 lobby (roster, post-join customization, leader overflow menu) -> A4 buzzer (all states below) | `player`   |
| `/room/[code]/display` | Projector window (C1): title screen with QR + code, category-reveal, board + clue card, scores strip, interstitials, winner screen. Default owner of room audio (per-device toggle)             | `display`  |
| `/room/[code]/host`    | C4 console: minimap, ARM (spacebar), judge row (arrows), answer visible, undo, score drawer, pause, DD + Final wizards, manual mode, **mirror mode** (C1b, `?mirror`), dev sim panel            | `host`     |

All three shells apply a theme preset via `themeToStyleAttribute` + `data-effects` at the route root and accept `?theme=<preset-id>` as a dev preview affordance. Every component underneath consumes semantic tokens only.

**Mock mode (current)**: `createRoomStore` (apps/web/src/lib/room/create-room-store.ts) always returns the local-sim store, so each tab is an ISOLATED simulated room - a phone tab and a display tab do not see each other yet. That is the documented cost of mock-first; the host tab's sim panel makes a full single-tab game playable today. The reconcile flips the factory to the ws store and the tabs converge on the DO.

## The room-store seam

`apps/web/src/lib/room/room-store.ts` defines `RoomStore`: a reactive `view: RoomView` (room phase, roster + teams in the two customization tiers, role-redacted engine `GameState`, content join, per-phone buzz feedback, pending timer hints, wager ranges, pause) plus every action any surface takes (join/identity/team tier; buzz/wagers/final answers; the full host verb set). Components consume ONLY this interface.

- `room-view.ts` also owns the pure derivations: `buzzerStageFor` maps a view to exactly one A4 state (the whole states table is a tested function, not template conditionals), `standingsFor` feeds every score strip.
- **Field names deliberately mirror the M3 room protocol** (`packages/protocol/src/room/roster.ts`, `identity.ts`, `server-messages.ts` in the main tree): `playerId`, `teamId`, `colorId`, `leaderPlayerId`, `locked`, `connected`, `joinedAt`, and the personal quartet `nickname/avatarId/accentId/buzzSoundId`. Wiring the ws store is a mapping, not a rename.

### Implementation 1: local-sim (`local-sim-store.svelte.ts`) - complete

Wraps `@jeopardy/engine`'s `transition()` over the fixtures/ dummy dataset (`fixture-room.ts` is the only fixture import site): the dummy game (teams mode, manual wager cells, final) + the 30-player/6-team roster. Engine timer hints run on client `setTimeout` (the DO-alarm stand-in; `timerAutopilot` off in tests/SSR). Role redaction is reproduced honestly: player/display stores never hold answers in memory. Doubles as the sim-panel backend (`simBuzz`, `simBuzzRace`, `simSetConnected`, `simCompleteFinal`) and the future rehearse-mode core. Unteamed players in a teams-mode game are seated as solo teams of one at start-game.

### Implementation 2: ws (`ws-room-store.ts`) - stub until reconcile

Same interface; every method body names the exact room protocol message it will send, and the file header carries the full **server-message -> store-effect mapping table**. Renders a permanent "connecting" shell if constructed today.

### What the reconcile must wire (the honest gap list)

1. **Socket lifecycle**: open `wss://<origin>/room/<CODE>/ws`, `join`/`resume` with the sessionStorage token, snapshot/event folding with `stateVersion` gap detection -> `sync`.
2. **Content channel**: the M3 snapshot does NOT carry clue text (the engine never sees it). `RoomView.content` needs a defined source - snapshot extension or a fetched, host-redacted game definition. Until decided, only mock rooms can render prompts.
3. **Timers**: the ws store only RENDERS `timer-set` hints; expiries come back as server events (DO alarms). `expireTimer` becomes a host-only force-expire relay.
4. **Pause**: `setPaused` needs a room-level message that is not in the M3 catalog yet.
5. **Room audio**: `buzz-won` arrives with the server-resolved `buzzSoundId` (team-first). The mock display resolves it client-side with the same rule; delete that resolution when wiring.
6. **Roster events**: kicked/renamed phones need the polite screens (A5) driven by `room-closed` / roster diffs; the mock never disconnects anyone.
7. **Identity guardrails**: rename rate limits and the armed-window `identity-locked` error surface as toasts; the mock silently refuses during the armed window.

## Audio (`room-audio.ts`)

Web Audio, pre-decoded buffers, three channels honoring the owner directives: `playBuzz` = the room's **exclusive slot** (would-overlap sounds are DROPPED, never queued; keyed off buzz-won alone), `playSoundCheck` = the one sanctioned queue (C3 serializes every team's sound), `playLocalPreview` = device-local feedback outside the slot (join preview, losing-buzz personal feedback). Routing is per-device: displays default on, everything else off. **Sound files are not bundled yet** - every catalog id (the approved 14 in `buzz-sound-catalog.ts`, slugs matching the roster fixture and docs/content/media-and-sounds.md section 9) synthesizes a placeholder tone with the uniform ~10 ms onset; the M5 bundling pass swaps `primeBuffers()` to `decodeAudioData` over real files and changes nothing else.

## Testing

- `room-store.contract.test.ts`: a full game (teams, wagers, final, undo, overrides, manual mode, late join) through the store's action surface, plus every `buzzerStageFor` mapping. The ws store must pass the same assertions behind a real DO at reconcile.
- `buzzer-screen.states.test.ts` / `host-console.states.test.ts` / `join-lobby.states.test.ts`: SSR renders (repo pattern) of every A4 state, every console state, the C1b mirror invariant (answers + wager dots NEVER in mirrored markup), and the overflow-menu rule.
- `surfaces-presets.smoke.test.ts`: all four theme presets x all three surfaces render; QR + room code on the title screen.
- `room-audio.test.ts`: the exclusive-slot drop rule and the sound-check queue against a fake AudioContext.

## Known gaps (tracked, deliberate)

- Buzzer sound FILES (placeholder tones until the M5 audio bundling pass).
- Mock rooms are per-tab (no cross-tab sync; by design until reconcile).
- The FLIP zoom-from-cell clue reveal: the display uses the baseline scale/fade (reduced-motion-aware); the FLIP measurement pass is display polish scheduled with M5's projector work.
- Host companion view (C1b option a - the phone-sized private layer for mirrored setups) is not built; mirror mode ships with the print-pack fallback story.
- `viewport-fit=cover` metas and wake lock ship on the player route; PWA precache of fonts/sounds grows in M5.
