# Play surfaces: routes, the room-store seam, and the M3 reconcile

> 2026-08-14 · M4 phase 2. The three play UIs (phone, display, console) as real routes over ONE typed client store, built mock-first: the complete implementation is a local simulation of the room (engine + fixtures), and the WebSocket implementation is a documented stub wired when M3's `GameRoomDO` lands. Spec: docs/design/user-flows.md (A2-A4, C1-C7). Tokens: docs/design/theming.md.

## Route map

| Route                  | Surface                                                                                                                                                                                                                                                                                                                                       | Store role |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `/`                    | The landing (A1): what this is, the room-code box, a secondary link to the browser with a live count, and the dev-surface index in a closed drawer. Polls `/api/rooms` for the count only - it never lists rooms                                                                                                                              | none       |
| `/lobby`               | The public room browser (A1 alternative arrival): room cards with title AND host label, capacity meters, lock, phase badge, age, inline per-card password prompt, and the code box repeated at the top. Polls, never sockets                                                                                                                  | none       |
| `/room/[code]`         | Player path, four stages: A2 character (name, avatar+accent, animated preview, buzzer sound) -> A2 team (staged lobby + team cards) -> A3 lobby (roster, staged view, post-join customization, overflow menus) -> A4 buzzer                                                                                                                   | `player`   |
| `/room/[code]/display` | Projector window (C1): title screen with QR + code (**or the "code hidden" affordance in streamer mode**), category-reveal, board + clue card, scores strip, interstitials, winner screen, the staged lobby before the game and the diorama on the other non-clue screens. Default owner of room audio. **Responsive to a phone** - see below | `display`  |
| `/room/[code]/host`    | C4 console: minimap, ARM (spacebar), judge row (arrows), answer visible, undo, score drawer, pause, DD + Final wizards, manual mode, **mirror mode** (C1b, `?mirror`), dev sim panel                                                                                                                                                          | `host`     |

All three shells apply a theme preset via `themeToStyleAttribute` + `data-effects` at the route root and accept `?theme=<preset-id>` as a dev preview affordance. Every component underneath consumes semantic tokens only.

**Mock mode (current)**: `createRoomStore` (apps/web/src/lib/room/create-room-store.ts) always returns the local-sim store, so each tab is an ISOLATED simulated room - a phone tab and a display tab do not see each other yet. That is the documented cost of mock-first; the host tab's sim panel makes a full single-tab game playable today. The reconcile flips the factory to the ws store and the tabs converge on the DO.

## The room-store seam

`apps/web/src/lib/room/room-store.ts` defines `RoomStore`: a reactive `view: RoomView` (room phase, roster + teams in the two customization tiers, role-redacted engine `GameState`, content join, per-phone buzz feedback, pending timer hints, wager ranges, pause, **the room's own settings, and the room's last refusal of this connection**) plus every action any surface takes (join/identity/team tier; buzz/wagers/final answers; the full host verb set). Components consume ONLY this interface.

- **`view.settings` is the protocol's `RoomSettings` verbatim** (`packages/protocol/src/room/room-settings.ts`), not a copy: every connection is sent it on join and again on every host edit, so a surface that respects it cannot drift from the room that owns it. Nothing in it is a secret - the password is the one settings field that never leaves the DO. It is what makes streamer mode work on the display and what the join screens read before offering a seat.
- **`view.refusal` carries the REASON, never a sentence** (`refusalReasonSchema`). `room-refusal.ts` is the single place the vocabulary becomes English, with an exhaustive switch, so a reason added to the protocol fails to compile rather than reaching a player as a raw string. `joinBlock(view)` answers the same question one step earlier - a full room or a spectator-free room disables the way forward with an explanation instead of letting somebody name a character and then be turned away.

- `room-view.ts` also owns the pure derivations: `buzzerStageFor` maps a view to exactly one A4 state (the whole states table is a tested function, not template conditionals), `standingsFor` feeds every score strip.
- `pre-game-stage.ts` does the same job one level up: `playerRouteStageFor` maps a view plus one local choice ("I'll play alone") to exactly one of `character | team | lobby | playing`. The route sets no screen variable, so the transitions nobody clicks are correct for free - a kick lands you back on the team screen because your `teamId` went null, and the host starting the game moves every phone to the buzzer from wherever it was.
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
8. **Room settings + refusals** (shape landed 2026-08-16, socket still to come): the ws store fills `view.settings` from the `room-settings` message (sent on join and on every host edit) and `view.refusal` from `refused`. The local-sim store already applies the same door rules in the same order - player cap, then the spectator switch, then the team-level reasons that keep the connection - so the surfaces are already written against real behavior.
9. **Revealing a hidden join code**: streamer mode hides the code on the display, and reveal deliberately does not live there (a button on the streamed screen defeats the setting). The room layer already has both doors - `PATCH /api/rooms/<CODE>` and the host-only `update-room-settings` message - so what remains is the console's room-settings panel, which is the next surface pass; `/dev/rooms` drives the same controls against real rooms today.

## The avatar diorama (`src/lib/diorama/`)

The display's live 3D layer: one Kenney model per scoring entity, wandering a themed stage while the room fills up. Decision + guardrails: docs/decisions/2026-08-14-avatars-in-motion.md. Assets and how they are produced: tools/avatar-bake/README.md.

**What mounts when.** The diorama is a template branch on `display-screen.svelte`, so "not shown" also means "not rendering":

| Room state                                                       | Diorama | What the avatars do                                                            |
| ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| Lobby / title screen (`view.phase === "lobby"`, or no game yet)  | STAGED  | Wait in the holding area or stand on their team's station (see below)          |
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
| `/`, layouts                 | **0 to +0.2 KB**                    | -                                                        |
| `/dev/theme`, `/dev/hotseat` | +1.5 to +1.7 KB                     | Shared avatar-manifest growth                            |
| `/room/[code]/display`       | +6.1 KB static, **+686 KB dynamic** | The three.js chunk, fetched only when the diorama mounts |

Two rules keep that true, both gate-tested: no static `three` import outside `diorama-scene.ts`, and `avatar-models.json` (the display-only GLB/clip/recolor data) is imported only from `src/lib/diorama/`. It used to live in `avatar-manifest.json` and cost every phone in the room 7.5 KB. Frame cost is capped too: at most 24 avatars animate (`maxDioramaAvatars`), the renderer's pixel ratio is capped at 2, and the whole thing runs only on screens that are about the people rather than the game.

## The staged lobby (`src/lib/staging/`)

Before the game the same stage stops being scenery and becomes the seating chart: a **holding area** where unassigned players wait and **team stations** they move to when they pick a team. Decision + the one guardrail that differs: docs/decisions/2026-08-15-staged-lobby.md.

| Piece                         | What it owns                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `staging-theme.ts`            | The theme INTERFACE: primitives (`box`/`cylinder`/`plane`), colour roles, seats, nouns. All data - no three.js anywhere in this directory |
| `staging-themes/boats.ts`     | First theme. Water, hulls in the team's colour, a pennant in the room's accent, six standing spots, a nameplate over the mast             |
| `staging-themes/campfires.ts` | Second theme, shipped to prove the seam: no drawn surface, a ring you sit around, four inward seats, milling instead of bobbing           |
| `staging-theme-registry.ts`   | The two built-ins, resolving the theme document's `staging` slot (ids held equal to the protocol enum by test)                            |
| `staging-layout.ts`           | Pure placement: station packing without overlap, seats, the holding grid, and the two anti-shuffle rules                                  |
| `staging-motion.ts`           | Pure movement: walking to a seat facing the way you travel, the reduced-motion snap, the holding-area bob                                 |
| `room-staging.ts`             | The one mapping from `RoomView` to stations/occupants/waiting, so no two surfaces can disagree about who is aboard what                   |
| `staged-lobby-2d.svelte`      | The layout in CSS: stations as team-coloured cards over a water band. Rendered by SSR and kept forever without WebGL                      |
| `staged-lobby.svelte`         | Picks one. 2D first, the live scene once it reports ready                                                                                 |

**Recolour is the cheap variant, concretely**: a theme names which parts wear the team's colour; `DioramaScene.#paintStation` derives shade and tint from one hex and writes two material colours per mesh. No geometry, no reload, no second theme.

**Degradation differs from the diorama's, deliberately.** The diorama is decoration and may vanish; staging carries an answer ("which boat am I on") and may not, so it degrades to the 2D layout instead of to nothing. Everything else holds and is gate-tested in `motion-guardrails.gate.test.ts`: three stays behind the dynamic import, the staging layer is three-free, reduced motion stands everyone still on their spot, and no staged view renders behind a live clue.

**The theme document's two presentation slots** (wired 2026-08-16). `themeBodySchema` carries `environment` (forest / pirate / dungeon / studio / none - the 3D scenery) and `staging` (boats / campfires - the pre-game seating chart), both optional, presentation-layer only, zero game-logic coupling. The display reads `theme.environment` through `resolveDioramaEnvironment` and `theme.staging` through `stagingThemeById`; the phone reads `staging` alone. Both resolvers FALL BACK rather than fail, because a theme document is data: scenery whose kit has not shipped renders on the studio stage, and an unknown staging id renders boats. `?environment=` and `?staging=` remain dev overrides and win over the document.

## The display on a phone

The display was written for one situation - a laptop driving a projector, one fixed pane, nothing scrolls - and a host checking their own room from their hand is an ordinary thing to do. The failure was worse than "small": a fixed, `inset: 0`, `overflow: hidden` pane makes everything past the first viewport height unreachable rather than tiny.

One breakpoint, `(max-width: 48rem), (max-height: 26rem)`, catches a phone in both orientations and neither a laptop nor a projector. Under it:

- The shell AND the screen both leave fixed positioning (either one left behind re-traps the page) and the page scrolls.
- The board type scale gains a **width** term. The projector scale in `tokens.css` is clamped against viewport HEIGHT alone, which is right across a 720p projector and a 4K TV and wrong on a tall narrow screen, where 8vh of numeral does not fit a 60px column. The compact block re-clamps the three layout constants on the display's own subtree - they are app layout constants, not theme document fields, so overriding them per viewport class is the sanctioned move.
- The stage joins the flow (`order: 2`) with a definite height and its own scroll, instead of floating over the lower 46%.
- The board scrolls sideways against a 34rem minimum rather than shrinking columns into illegibility; the scores strip caps and scrolls; the pause veil goes `fixed` so it stays over the viewport.

`display-responsive.gate.test.ts` holds all of the above as source-level invariants, including "no fixed pixel layout size anywhere in the screen". Source-level because CSS media queries do not resolve in an SSR render, and adding a browser to `pnpm test` for a layout would break the PR gate.

## Audio (`room-audio.ts`)

Web Audio, pre-decoded buffers, three channels honoring the owner directives: `playBuzz` = the room's **exclusive slot** (would-overlap sounds are DROPPED, never queued; keyed off buzz-won alone), `playSoundCheck` = the one sanctioned queue (C3 serializes every team's sound), `playLocalPreview` = device-local feedback outside the slot (join preview, losing-buzz personal feedback). Routing is per-device: displays default on, everything else off. The M5 bundling pass landed the FILES (docs/content/media-and-sounds.md section 10): `prime()` still returns synchronously - it seeds a placeholder tone per id, so nothing is ever silent inside a user gesture - and then decodes the real pack over the top. Music is a fourth channel that never rides the room slot and is never fetched at prime: the lobby track is one manifest slot (`lobbyTrack`), started by the display while the room phase is lobby, and its current occupant is a placeholder pending the owner pick.

## Testing

- `room-store.contract.test.ts`: a full game (teams, wagers, final, undo, overrides, manual mode, late join) through the store's action surface, plus every `buzzerStageFor` mapping. The ws store must pass the same assertions behind a real DO at reconcile.
- `buzzer-screen.states.test.ts` / `host-console.states.test.ts` / `pre-game.states.test.ts`: SSR renders (repo pattern) of every A4 state, every console state, the C1b mirror invariant (answers + wager dots NEVER in mirrored markup), the three pre-game screens, and the overflow-menu rule (kick, hand-off, AND team lock all behind "..."). `pre-game.states.test.ts` also drives `playerRouteStageFor` through the unclicked transitions - kick, game start, mid-game arrival.
- `surfaces-presets.smoke.test.ts`: all four theme presets x all three surfaces render; QR + room code on the title screen.
- `room-audio.test.ts`: the exclusive-slot drop rule, cues sharing that one slot, the sound-check queue, the synthesized time-up beep, and the music channel staying off the slot and idempotent per track - all against a fake AudioContext.
- `sound-manifest.gate.test.ts`: the bundled pack against the files on disk - every onset inside the 8-15 ms fairness window, buzz-ins inside 0.5-1.5 s, cues under 3 s, a per-file sha256 re-hash, no orphans, a CC0 credits row per file, and the eager (precached) half under 512 KB.
- `diorama/wander.test.ts`: the movement rules where they are pure - avatars never leave the pen (including under an absurd frame delta), reduced motion stops them dead, a beat expires, arrivals never stack, and a seed reproduces a layout exactly.
- `staging/staging-layout.test.ts`: the staged lobby where it is pure - station packing without overlap on either theme, waiting occupants never inside a station, a station keeping its spot when a team is created, a waiting player keeping theirs when somebody boards, the walk to a seat taking real time and never overshooting, the reduced-motion snap, and the theme interface's own shape.
- `staging/staged-lobby.states.test.ts`: the roster-to-stations mapping, and the 2D degradation carrying the same answer (nameplates, hull colours, crews aboard, the holding area) under both themes.
- `diorama/motion-guardrails.gate.test.ts`: the decision doc's guardrails as source-level invariants - the animated avatar reaches the join and lobby screens and nothing else (above all not the buzz screen), the reduced-motion freeze exists as a real state, `three` and `avatar-models.json` stay behind the dynamic import, and the clue phases stay out of the diorama's mount list.
- `avatar-manifest.gate.test.ts`: all three asset tiers agree with the files on disk and with their byte budgets (stills < 2 MB, sheets < 1 MB, models < 3 MB), with no orphans on either side.
- Not automated: the diorama itself. Verified by hand in headless Chromium against a preview build (models load, recolor, animate, react, degrade) - CI has no browser, and adding one to `pnpm test` would break the PR gate for a decoration. `/dev/diorama` is the standing way to look at it.

## Known gaps (tracked, deliberate)

- Mock rooms are per-tab (no cross-tab sync; by design until reconcile).
- The FLIP zoom-from-cell clue reveal: the display uses the baseline scale/fade (reduced-motion-aware); the FLIP measurement pass is display polish scheduled with M5's projector work.
- Host companion view (C1b option a - the phone-sized private layer for mirrored setups) is not built; mirror mode ships with the print-pack fallback story.
- `viewport-fit=cover` metas and wake lock ship on the player route. The precache now covers the bundled buzz/cue one-shots (under 320 KB) and deliberately EXCLUDES the music beds - install downloads its whole list before activating, and the lobby track alone is 3.8 MB.
