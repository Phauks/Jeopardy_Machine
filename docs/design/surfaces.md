# Play surfaces: routes, the room-store seam, and the M3 reconcile

> 2026-08-14 · M4 phase 2. The three play UIs (phone, display, console) as real routes over ONE typed client store, built mock-first: the complete implementation is a local simulation of the room (engine + fixtures), and the WebSocket implementation is a documented stub wired when M3's `GameRoomDO` lands. Spec: docs/design/user-flows.md (A2-A4, C1-C7). Tokens: docs/design/theming.md.

## Route map

| Route                  | Surface                                                                                                                                                                                                                                   | Store role |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `/room/[code]`         | Player path: A2 join (nickname, avatar+accent, buzzer sound with local preview, team cards) -> A3 lobby (roster, post-join customization, leader overflow menu) -> A4 buzzer (all states below)                                           | `player`   |
| `/room/[code]/display` | Projector window (C1): title screen with QR + code, category-reveal, board + clue card, scores strip, interstitials, winner screen, plus the live avatar diorama on the non-clue screens. Default owner of room audio (per-device toggle) | `display`  |
| `/room/[code]/host`    | C4 console: minimap, ARM (spacebar), judge row (arrows), answer visible, undo, score drawer, pause, DD + Final wizards, manual mode, **mirror mode** (C1b, `?mirror`), dev sim panel                                                      | `host`     |

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

## The avatar diorama (`src/lib/diorama/`)

The display's live 3D layer: one Kenney model per scoring entity, wandering a themed stage while the room fills up. Decision + guardrails: docs/decisions/2026-08-14-avatars-in-motion.md. Assets and how they are produced: tools/avatar-bake/README.md.

**What mounts when.** The diorama is a template branch on `display-screen.svelte`, so "not shown" also means "not rendering":

| Room state                                                       | Diorama | What the avatars do                                                            |
| ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| Lobby / title screen (`view.phase === "lobby"`, or no game yet)  | yes     | Wander; the newest arrival turns to the room and celebrates as they walk on    |
| `round-break`, `final-wagers`, `final-writing`, `final-reveal`   | yes     | Wander behind the interstitial's scores                                        |
| `game-over`                                                      | yes     | The winners face the camera and celebrate; everyone else strolls               |
| Category reveal, board, clue card, wagering, any answering phase | **no**  | -                                                                              |
| Host console mirror mode (`?mirror`)                             | **no**  | The console passes `environment="none"`; one renderer per room, on the display |

The clue-bearing phases are excluded by name and a gate test (`motion-guardrails.gate.test.ts`) asserts they never creep into the list. The layer sits at `z-index: 0` in the lower 46% of the screen with the content block padded clear of it, so a wandering avatar never crosses the join QR or the winner's name.

**Reactions.** `pulse(entityId)` gives one entity a visible beat - turn to camera, celebrate clip, rejoin the stroll. Lobby arrivals fire it from the roster; `setCelebrating(ids)` holds the winners in a celebration for as long as the winner screen is up. A buzz that happens during a live clue lands on an unmounted diorama and does nothing, which is the guardrail working rather than a gap. `/dev/diorama` has a button per player so the beat can be seen without a game.

**Degradation.** No WebGL (or a canvas that never gets a size, or a model that 404s) leaves the surrounding 2D screen exactly as it was - the canvas only fades in once the scene reports itself ready. `prefers-reduced-motion` stops the wandering outright: everyone stands on their spot playing the idle clip, and celebrations still play because those are the winner screen's content rather than ambient motion.

**Budget.** `three` is imported by exactly one module (`diorama-scene.ts`), reached only through a dynamic `import()` in `avatar-diorama.svelte`. Measured on 2026-08-14 (client chunks, uncompressed, against the pre-diorama build):

| Route                        | Static JS delta                     | Notes                                                    |
| ---------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `/room/[code]` (the phone)   | **+2.8 KB**                         | The animated avatar and its sheet entries. No three.js.  |
| `/`, `/dev/echo`, layouts    | **0 to +0.2 KB**                    | -                                                        |
| `/dev/theme`, `/dev/hotseat` | +1.5 to +1.7 KB                     | Shared avatar-manifest growth                            |
| `/room/[code]/display`       | +6.1 KB static, **+686 KB dynamic** | The three.js chunk, fetched only when the diorama mounts |

Two rules keep that true, both gate-tested: no static `three` import outside `diorama-scene.ts`, and `avatar-models.json` (the display-only GLB/clip/recolor data) is imported only from `src/lib/diorama/`. It used to live in `avatar-manifest.json` and cost every phone in the room 7.5 KB. Frame cost is capped too: at most 24 avatars animate (`maxDioramaAvatars`), the renderer's pixel ratio is capped at 2, and the whole thing runs only on screens that are about the people rather than the game.

**Environment slot.** The environments direction (docs/research/00-user-directives.md) wants a curated `environment` field on the THEME document - forest / pirate / dungeon / none, presentation-layer only. The protocol theme schema does not have it yet and this milestone does not edit the protocol, so the vocabulary is a local enum in `diorama-environment.ts` (`"none" | "studio"`), kept in the shape the schema will take. That file names the exact one-line addition `themeBodySchema` needs, mirroring how `soundSet` already reserves its slot.

## Audio (`room-audio.ts`)

Web Audio, pre-decoded buffers, three channels honoring the owner directives: `playBuzz` = the room's **exclusive slot** (would-overlap sounds are DROPPED, never queued; keyed off buzz-won alone), `playSoundCheck` = the one sanctioned queue (C3 serializes every team's sound), `playLocalPreview` = device-local feedback outside the slot (join preview, losing-buzz personal feedback). Routing is per-device: displays default on, everything else off. **Sound files are not bundled yet** - every catalog id (the approved 14 in `buzz-sound-catalog.ts`, slugs matching the roster fixture and docs/content/media-and-sounds.md section 9) synthesizes a placeholder tone with the uniform ~10 ms onset; the M5 bundling pass swaps `primeBuffers()` to `decodeAudioData` over real files and changes nothing else.

## Testing

- `room-store.contract.test.ts`: a full game (teams, wagers, final, undo, overrides, manual mode, late join) through the store's action surface, plus every `buzzerStageFor` mapping. The ws store must pass the same assertions behind a real DO at reconcile.
- `buzzer-screen.states.test.ts` / `host-console.states.test.ts` / `join-lobby.states.test.ts`: SSR renders (repo pattern) of every A4 state, every console state, the C1b mirror invariant (answers + wager dots NEVER in mirrored markup), and the overflow-menu rule.
- `surfaces-presets.smoke.test.ts`: all four theme presets x all three surfaces render; QR + room code on the title screen.
- `room-audio.test.ts`: the exclusive-slot drop rule and the sound-check queue against a fake AudioContext.
- `diorama/wander.test.ts`: the movement rules where they are pure - avatars never leave the pen (including under an absurd frame delta), reduced motion stops them dead, a beat expires, arrivals never stack, and a seed reproduces a layout exactly.
- `diorama/motion-guardrails.gate.test.ts`: the decision doc's guardrails as source-level invariants - the animated avatar reaches the join and lobby screens and nothing else (above all not the buzz screen), the reduced-motion freeze exists as a real state, `three` and `avatar-models.json` stay behind the dynamic import, and the clue phases stay out of the diorama's mount list.
- `avatar-manifest.gate.test.ts`: all three asset tiers agree with the files on disk and with their byte budgets (stills < 2 MB, sheets < 1 MB, models < 3 MB), with no orphans on either side.
- Not automated: the diorama itself. Verified by hand in headless Chromium against a preview build (models load, recolor, animate, react, degrade) - CI has no browser, and adding one to `pnpm test` would break the PR gate for a decoration. `/dev/diorama` is the standing way to look at it.

## Known gaps (tracked, deliberate)

- Buzzer sound FILES (placeholder tones until the M5 audio bundling pass).
- Mock rooms are per-tab (no cross-tab sync; by design until reconcile).
- The FLIP zoom-from-cell clue reveal: the display uses the baseline scale/fade (reduced-motion-aware); the FLIP measurement pass is display polish scheduled with M5's projector work.
- Host companion view (C1b option a - the phone-sized private layer for mirrored setups) is not built; mirror mode ships with the print-pack fallback story.
- `viewport-fit=cover` metas and wake lock ship on the player route; PWA precache of fonts/sounds grows in M5.
