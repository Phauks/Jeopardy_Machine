# Expansion Paths & Customization Boundaries

> 2026-08-13 · Pre-M0 design audit. Companion to ROADMAP.md and docs/decisions/2026-08-13-theming-as-feature.md.
> Purpose: know where the product can grow and where we deliberately do NOT allow customization, so module seams are designed for the former and defended at the latter.

## The design law

**Customization lives in documents, never in code paths.** Everything a user can change is expressed in one of four portable, versioned, zod-validated documents:

| Document            | Customizes      | Examples                                                  |
| ------------------- | --------------- | --------------------------------------------------------- |
| **Settings object** | The rules       | all 42 matrix settings, presets (TV / casual / custom)    |
| **Theme document**  | The look        | tokens, font slots, background, effects level             |
| **Content pack**    | The material    | questions, media, tags, difficulty                        |
| **Game definition** | The composition | mode, layout, cell->content refs, settings ref, theme ref |

If a proposed feature can't be expressed as data in one of these documents, it is either a **new game mode** (a new consumer of content packs), or it is **out of bounds**. This is the test every future "can we make X customizable?" question runs through.

Every document round-trips through export/import. A namespaced `ext` field (object keyed by reverse-domain strings) is preserved untouched on parse/serialize in all four documents, so third parties and future-us can annotate without forking the format.

---

## Part 1 - Expansion paths (design the seams now, build later)

Ordered roughly by likelihood. None are commitments; all are shaped by existing seams.

### 1.1 New game modes on the same content packs (the big one)

The content layer is mode-agnostic by owner directive. Modes are consumers:

- **Everyone-answers** (Kahoot-style): all phones answer every clue within a timer; speed-weighted scoring. Already an M7 line item; it is the escape valve for 50-100 solo players where buzz-racing breaks down.
- **Lightning round / rapid-fire**: linear queue of content items, no board. Trivial once the engine and content layer are separate.
- **Picture/audio rounds as a first-class mode**: media item -> guess, all-play. (The event's national-parks round is this, jammed into board format; a dedicated mode does it better later.)
- **Pub-quiz mode**: rounds of questions, phones as answer sheets, host grades between rounds. Same content, no buzzers, different pacing engine.
- **Study/solo mode**: flashcard-style self-quiz over any content pack. No realtime at all - pure client.
- **Seam to protect**: the engine package must not import board-shaped types from anywhere but the mode layer; content items must not know what mode displays them. Content item _types_ are an enum designed for extension (`basic` Q/A now; `ordered-list`, `estimate` (closest-number), `survey` later - each new type states which modes can render it).

### 1.2 Event & organization tooling

- **Tournaments/series**: multiple games, persistent standings, brackets. Needs results-as-documents (game results export already planned in the host flow) - keep results schema clean and versioned from M4.
- **Multi-room events**: several concurrent rooms from one host account, lobby routing. DOs already give per-room isolation; this is UI + (phase 2) auth.
- **Stream/spectate**: a read-only board view already exists architecturally (the board display is just another WS client with role `display`). An OBS browser-source overlay and a remote-spectator page are the same seam. Design roles as `host | display | player | spectator` from M3 even though `spectator` ships later.

### 1.3 Content ecosystem

- **Community pack library**: browse/share content packs and themes. Needs accounts + moderation - firmly phase 3+, but the _pack format_ being self-contained, versioned, and attributable (author, license fields in metadata from day one) is what makes it possible.
- **AI-assisted authoring**: generate/vet candidate clues into the editor's staging area (never directly into a board). A pure editor feature; no protocol impact. Add `source: "ai-draft" | "human"` provenance to content-item metadata now (one field, costless) so trust filtering exists later.
- **More importers**: J-Archive-shaped, Quizlet/Anki TSV (M7); "paste a spreadsheet" grid paste in the editor.

### 1.4 Play-surface expansion

- **Physical buzzers**: WebHID/gamepad-API buzzers (USB quiz buzzers exist) as an alternative input to the phone page - enters through the same `buzz` message; zero protocol change.
- **Cast/TV apps**: the display route is a URL; Chromecast/AirPlay tab-casting works day one. A dedicated receiver app is never needed unless we want it.
- **Remote play**: nothing in the architecture assumes co-location except audio (host reads clues aloud). Remote mode = TTS clue reading + clue text shown on phones. Both are settings, not rewrites - keep `clue-text-on-phones` a setting from M4 (default off for in-room play, since reading ahead beats listening).
- **Accessibility as expansion**: TTS reading, per-player large-text/high-contrast on phones (player-side overrides that ignore the theme - see boundary 2.9), multilingual UI (string catalog from M0: all UI strings in one module, even if English-only ships).

### 1.5 Deployment expansion

- **"Deploy your own" path**: the repo IS the product for self-hosters; a documented `wrangler deploy` guide plus a Deploy-to-Cloudflare button keeps the free-forever promise credible even if the hosted instance ever gates something.

---

## Part 2 - Where we do NOT allow customization (and whether we should)

Each boundary: what's locked, why, the pressure we expect, and the escape valve if we ever bend. **Verdict** = keep locked / bend later.

### 2.1 Buzz adjudication core

**Locked:** first-armed-buzz-wins determinism, server-authoritative ordering, the lockout state machine. No hooks, no plugins, no per-game algorithm choice beyond the exposed settings (timings, penalty on/off, fairness compensation on/off in M6).
**Why:** fairness is the product's credibility; every alternative path is a bug farm and a rules-lawyering surface at a live event.
**Escape valve:** new _settings_ on the one state machine, never alternative state machines.
**Verdict: keep locked. Hard.**

### 2.2 Player join = room code only, no player accounts

**Locked:** hosts cannot require player registration, email, or login. Guiding principle 3.
**Pressure:** schools/corporate may want rosters and persistent identity.
**Escape valve:** host-side pre-made rosters ("claim your name from this list") give 90% of the value with zero player auth. Design the roster as host-supplied data, not player-supplied identity.
**Verdict: keep locked; build claim-a-name later if asked.**

### 2.3 Scoring math

**Locked:** no user-scripted scoring formulas, no embedded scripting engine anywhere.
**Why:** security (shared origin, other people's phones), testability (the 42-setting matrix is exhaustively testable; arbitrary scripts are not), and support burden.
**Escape valve:** if a legitimately popular scheme appears (e.g. streak bonuses), it becomes setting #43 with tests, not a script.
**Verdict: keep locked. A scripting engine is how hobby projects die.**

### 2.4 The board's structural grammar

**Locked:** a Jeopardy-mode board is a grid: category headers on top, value cells beneath, clue fills cell, cell dies after play. Sizes/values/rounds are settings; the _grammar_ is not.
**Why:** this is the boundary between theme and mode (decision doc): **themes change look, modes change structure.** A "board" that's a wheel or a ladder is a new mode reusing the same content - welcomed as such.
**Verdict: keep locked per mode; unlimited via new modes.**

### 2.5 Fonts: curated set only

**Locked:** font slots choose from our self-hosted OFL set (~10-12 faces); no arbitrary font upload, no external font URLs.
**Why:** licensing hygiene, projector legibility floor, bundle size, and CSP (self-hosted only).
**Pressure:** "let me use my club's brand font" is the most likely theming request we refuse.
**Escape valve:** grow the curated set on request (adding an OFL face is a PR); org-brand fonts only if/when a multi-tenant phase makes per-org asset uploads a real feature with real review.
**Verdict: keep locked through M7; revisit with real demand.**

### 2.6 Wire protocol & document schemas

**Locked:** message shapes and document schemas are versioned and migrate forward; no user-defined fields outside the `ext` bag; clients that speak unknown versions are refused with a clear error.
**Why:** the migration story (principle 5) dies the day arbitrary shapes enter.
**Verdict: keep locked; `ext` is the pressure release.**

### 2.7 Operational limits

**Locked:** media size caps (image ~10 MB, audio ~20 MB per file; per-game total cap), room cap (soft 100, hard 128), message rate limits, nickname length; hosts cannot lift them.
**Why:** venue Wi-Fi, DO memory, R2 bills, and abuse are physics, not preferences. Limits are constants in one documented module (`packages/protocol/limits`), surfaced in editor validation - never discovered at game time.
**Verdict: keep locked; tune values with real-world data.**

### 2.8 Host authority

**Locked:** every automated step has a host override and undo (principle 4); conversely, there is no host-less autopilot mode in scope - someone owns the room.
**Pressure:** "let it run itself" for solo practice.
**Escape valve:** solo/rehearse mode (creator flow) runs engine auto-judging locally - that's a mode where the _player is the host_, not a host-less room.
**Verdict: keep locked.**

### 2.9 Theme reach stops at the player's accessibility settings

**Locked:** themes style the board display and the buzzer's _chrome_, but a player's device-level overrides (large text, high contrast, reduced motion) always win on their own phone, and the buzz button's size/placement is not themeable below a minimum.
**Why:** the host's aesthetics never get to make a guest's phone unusable.
**Verdict: keep locked. Non-negotiable a11y floor.**

### 2.10 Sounds

**Locked (owner decision 2026-08-13): all sounds are curated - player sound uploads are permanently out.** Originally planned as upload-with-host-veto in M7; owner cut it: low benefit, too many issues (moderation at a live event, music rights, and every upload would need the standardized-onset/loudness pipeline to not break buzz fairness). Buzzer sounds: players/teams pick from the curated pack (grown by us on request - adding a CC0 sound is a PR, same escape valve as fonts). System cues: one original set, toggleable per cue.
**Gap we still open (cheap):** theme documents get an optional **sound-set slot** (choose among our curated packs) in M7 alongside the customizer - a "retro" and a "minimal beeps" set make themes feel complete.
**Verdict: locked (uploads out); bend only via curated sound-set choice in themes (M7).**

### Summary table

| #    | Area              | Customizable?                                   | Verdict                                       |
| ---- | ----------------- | ----------------------------------------------- | --------------------------------------------- |
| 2.1  | Buzz adjudication | Settings only                                   | Locked hard                                   |
| 2.2  | Player identity   | Never required                                  | Locked; claim-a-name later                    |
| 2.3  | Scoring           | 42 settings, no scripts                         | Locked hard                                   |
| 2.4  | Board grammar     | Sizes/values yes; structure no                  | Locked per mode; new modes for new structures |
| 2.5  | Fonts             | Curated set                                     | Locked thru M7, revisit                       |
| 2.6  | Protocol/schemas  | `ext` bag only                                  | Locked                                        |
| 2.7  | Ops limits        | No                                              | Locked, values tunable by us                  |
| 2.8  | Host authority    | Overrides yes, autopilot no                     | Locked; solo mode covers practice             |
| 2.9  | Player a11y floor | Theme never overrides                           | Locked                                        |
| 2.10 | Sounds            | Curated packs only - no uploads (owner)         | Locked; curated sound-set slot in M7          |

The pattern: **rules, look, and material are radically open; the referee, the wire, and the guest's phone are closed.** That split is what lets the open parts be fearless.
