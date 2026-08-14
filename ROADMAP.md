# Roadmap

> **This is a living document.** It is updated in the same commit as any work that changes it - milestones move between sections, shipped items get pruned to the changelog, and open decisions get resolved into dated records under `docs/decisions/`. If this file disagrees with the code, fix this file.
>
> Last updated: 2026-08-13 (M2 engine landed: pure state machine + seeded rng + fixtures + /dev/hotseat exit-criteria page. M1 editor phase open; M0 awaits owner's first manual deploy)

## What we are building

A free, self-hosted **Jeopardy-style game creation suite**: a visual board editor, a big-screen game board, a host control panel, and phone-as-buzzer play for 2-100 players (individuals or teams) who join with a QR code or room code - no accounts, no paywalls. Built on SvelteKit + Cloudflare Workers/Durable Objects.

The competitive research (docs/research/02-landscape.md) confirmed the gap: nobody offers an authored board + integrated phone buzzers for free. Everything competitors paywall - buzzers, media clues, saved games, player counts, board sizes - is unconditionally free here.

**First real-world target:** a game night for the Board Game Club x Environmental Law Society (environment + gaming questions only, no law). Content pool drafted in docs/content/event-content-pool.md.

## Guiding principles

0. **Jeopardy is the inspiration, not the specification.** TV-fidelity is never its own justification: any rule, timer, or convention copied from the show must earn its place by making the game more fun. Where it does not, relax it, make it a toggle, or explore a better variant (the 42-setting rules matrix is the exploration surface, and the TV column is just one preset among several). The research docs describe the show accurately so that departures are informed choices, not accidents.
1. **Modular** - game rules engine, realtime transport, editor, cosmetics, and import/export are separate modules with typed contracts (`packages/protocol` is the keystone).
2. **Documented** - docs updated in the same commit as behavior changes; this roadmap is the index of intent; decisions get dated one-pagers.
3. **Players never log in** - room code is the entire join flow, forever.
4. **The host is always in control** - every automated step (arm, timers, judging) has a manual override and an undo.
5. **Own your data** - versioned JSON export/import from day one; no walled garden.
6. **Content is portable across game modes.** Questions and assets live in a game-mode-agnostic content layer; a Jeopardy board is a presentation of content items, not their owner. Content packs (questions + assets), game definitions (mode + layout + settings), live game data, and user data are four distinct layers with their own file/storage stories. Future modes reuse the same content packs.

---

## Milestones

### M0 - Foundations (repo, tooling, docs skeleton)

Scaffold the pnpm monorepo (`apps/web`, `apps/realtime`, `packages/protocol`) with the owner's conventions from docs/research/04-style-guide.md: Vite+ (`vp`) with Oxlint/Oxfmt, TypeScript strict, Svelte 5 runes, `wrangler.jsonc` with commented bindings, CI gate (PR-only), `.claude/settings.json` deploy denies, CLAUDE.md + docs skeleton (STATUS.md, decisions/, proposals/). PWA skeleton (added to scope 2026-08-13, docs/decisions/2026-08-13-pwa.md): web manifest + service worker with the caching policy (precache immutable assets, network-first navigations), documented in DEVELOPMENT.md. **Exit criteria:** `pnpm test` green in CI; hello-world deploys of both Workers verified manually; local dev loop for the two-Worker + DO setup proven (architecture risk 6).

Progress 2026-08-13 - everything agent-verifiable is done; what remains is owner-manual:

- [x] Monorepo + catalog-pinned toolchain (versions verified live; docs/decisions/2026-08-13-m0-version-pins.md)
- [x] `packages/protocol`: versioned envelope + `ext` bag + limits module, tested
- [x] `apps/realtime`: `GameRoomDO` stub on partyserver (verdict: use, transport-only - docs/decisions/2026-08-13-partyserver.md), tested inside workerd
- [x] `apps/web`: SvelteKit 3 shell + Tailwind v4 + PWA manifest/service-worker skeleton + `/dev/echo` proof page
- [x] Local dev loop proven end to end (`pnpm dev`; cross-script DO binding `[connected]` under multi-config `wrangler dev`) - docs/DEVELOPMENT.md
- [x] CI gate (PR-only: fmt, lint, typecheck, test, build), deploy denies, CLAUDE.md, STATUS.md, per-package READMEs
- [ ] Owner: first manual hello-world deploy of both Workers (docs/cloudflare-setup.md) - closes M0

### M1 - Content model + board format + editor core

Two-layer data model in `packages/protocol` (zod schemas + migration functions): the **content layer** (question items: prompt, answer, media refs, tags, difficulty, source note - game-mode-agnostic) and the **jeopardy mode layer** (board layout: rounds, categories, cells referencing content items, values, wager cells). The visual editor: create/edit content items and compose boards from them (with a fast "type straight into the grid" path that creates content items implicitly), local-first persistence behind repository interfaces - IndexedDB-backed per the PWA decision (docs/decisions/2026-08-13-pwa.md; localStorage only for tiny prefs/tokens); export/import of content packs and game definitions. **Exit criteria:** a full 6x5 two-round board can be authored, exported, re-imported, survives a format-version bump - and its questions can be listed/reused independently of the board. The protocol also defines the **theme document** schema (token values, font-slot choices, background spec, effects level) so themes are a portable, shareable artifact from day one.

Progress 2026-08-13 - the protocol phase landed (docs/proposals/m1-protocol.md with owner resolutions R1-R4); the editor phase is open:

- [x] Document envelope + semver migration machinery: `parsePortableDocument` single entry point, migration chains validated at registry construction, committed fixture pair per migration enforced by a gate test (proven by a synthetic example migration)
- [x] UUIDv7 ids everywhere (R3), `ids.ts` owns generation + validation
- [x] Content layer: content-item with media attachable to prompt AND answer (owner directive 2026-08-13), content-pack, media identity/bytes indirection with sha256 dedupe-and-relink
- [x] Settings registry (R2): all 43 matrix rows defined once, deriving the composed schema + TS types + a UI-renderable description + the generated docs table (docs/reference/settings.md, regenerate-and-diff gate); presets as sparse diffs (tv, casual-party); group-level cross-field refinements
- [x] Rule-set document (R4): the fifth portable document (`.rules.json`); design-law table updated in docs/design/expansion-and-boundaries.md
- [x] Theme document: tokens, curated font slots, background variants with auto-dim, effects level, reserved sound-set slot
- [x] Jeopardy mode layer: game-definition with embedded-or-external content, embed-or-preset rules and theme, authored-wins wager cells, value schemes
- [ ] Visual editor + IndexedDB repositories + export/import UI (M1 phase 2)
- [ ] Exit-criteria run (author, export, re-import, survive a version bump via the editor) - blocked on phase 2

### M2 - Game engine (pure logic, no network)

The rules state machine as pure, heavily-tested functions: round flow, clue lifecycle (reading -> armed -> buzzed -> judged -> rebound), scoring incl. negatives and overrides, Daily Double wagering math, Final round flow, tiebreakers - all 42 settings from the configurable rules matrix (docs/research/01-game-anatomy.md) as a typed config object with defaults. **Exit criteria:** engine passes a test suite covering the rules matrix; a keyboard-driven "hotseat" debug page can play a full game locally with no server.

Progress 2026-08-13 - `packages/engine` (@jeopardy/engine) landed:

- [x] Pure transition core: `(state, action, setup) -> {state, events}`; time is action data, timers are hint events, total (invalid actions reject, never throw)
- [x] Clue lifecycle incl. early-buzz lockout (#12), first-valid-buzz-wins with ONE buzz-won per arming (owner audio directive), rebound chains (#15/#16), manual-mode host awards, cancel/reopen
- [x] Scoring rows #17/#18 (deduct / floor-at-zero / none), host score override + undo as first-class actions (row 20)
- [x] Wager cells (#23-#28): seeded weighted/uniform auto-placement (aired row distribution), authored-wins manual placement, TV/score-only/unlimited maxima, entry timer, true doubles
- [x] Final round (#29-#33): eligibility, simultaneous secret wagers + answers, lowest-first / top-contenders (batch threshold) / leaderboard reveal plans with enforced drama order
- [x] Round flow (#1-#9), shot clock (#10), round time limit (#6, latching), control passing (last-correct / rotate / host-picks / auto-sweep), tiebreakers (#37) + degenerate finishes (#38), teams (#34-#36), late join (#43), everyone-answers (#21/#22)
- [x] Undo = replay of the append-only action log; seeded rng in state (same seed = identical game)
- [x] Scenario fixtures (`packages/engine/fixtures/`) as replayable JSON games + `simulate()` as the public simulation API (M3 bots / M4 sim panel build on it)
- [x] `/dev/hotseat` keyboard-driven full-game page against the engine, no server (exit criteria; plus a headless full-game drive in `apps/web/src/lib/hotseat/sample-game.test.ts`)

### M3 - Realtime rooms (DO + WebSockets)

`GameRoomDO` in `apps/realtime`: room codes via `idFromName`, WebSocket Hibernation, session-token reconnection, snapshot + patch protocol, server-arrival buzz ordering (fairness compensation deferred to M6), alarms for room cleanup. **Single-origin connections** (owner decision, docs/decisions/2026-08-13-single-origin-binding.md): all clients hit `wss://<web-origin>/room/<CODE>/ws` and the web Worker forwards upgrades to the DO via the cross-script binding - week-1 risk item is proving the upgrade passes through the SvelteKit-on-Workers path (fallback: thin custom entry ahead of the Kit handler); `/dev/echo` + `REALTIME_ORIGIN` are then deleted. **Exit criteria:** vitest-pool-workers suite incl. hibernation-eviction tests; Playwright multi-context test proves deterministic buzz ordering with simulated phones - all through the single origin.

### M4 - Play surfaces (board, buzzer, host)

The three UIs on the design-token foundation (docs/research/05-ui-design.md): tokens.css + fonts + theme mechanism first - the three "Three Boards" art directions all ship as built-in **theme presets** (retro-tv, modern-flat, event-poster) plus the Terra Verde event variant, proving the token contract covers real visual range - then primitives in a `/dev` gallery, then the board screen (fill-in stagger, FLIP clue zoom, DD splash, timer bars), the phone buzzer (fixed layout, wake lock, pointerdown + optimistic feedback, per-player buzz sounds from a curated pack), and the host console (arm button, correct/wrong/no-penalty, score override, undo, Final round wizard). Join flow: QR + room code + nickname + lobby. PWA: the precache manifest grows to fonts + sound pack, and the install affordance appears in editor chrome (only there - players are never prompted). **Exit criteria: a complete real game is playable end-to-end by phones in a room.** This is the "usable at an event" line.

Progress 2026-08-14 - phase 2 (the surfaces) landed mock-first on the room-store seam (docs/design/surfaces.md):

- [x] Room-store seam: one typed `RoomStore` interface + `RoomView` (field names mirror the M3 room protocol); local-sim implementation complete over engine + fixtures/, ws implementation stubbed with the full message-to-store mapping for the M3 reconcile
- [x] Player route `/room/[code]`: A2 join (avatars, accents, the 14 buzz sounds with local preview, team cards), A3 lobby (leader overflow menu, post-join customization sheet), A4 buzzer with every state as a tested pure derivation (fixed layout, pointerdown + haptic, wake lock, reduced-motion)
- [x] Display route `/room/[code]/display`: title screen with real QR (uqr, catalog-pinned) + room code, category-reveal, board + clue card, DD splash, scores strip, winner screen; room-audio module with the only-winner-heard exclusive slot (placeholder tones until the M5 sound bundling)
- [x] Host route `/room/[code]/host`: C4 panel (minimap with host-only wager dots, spacebar ARM, arrow judging, answer visible, undo, score drawer, pause), DD + Final wizards, manual mode, C1b mirror mode (answers provably absent from mirrored markup), dev-gated sim panel driving fixture players
- [x] Hotseat page reuses the shared scores strip; 75 new web tests (store contract full-game, every buzzer/console state, mirror invariant, preset x surface smoke, audio slot rules)
- [x] **Avatars in motion** (docs/decisions/2026-08-14-avatars-in-motion.md, owner-approved 2026-08-14): the avatar set becomes three tiers by surface. The 27 Kenney GLBs ship trimmed (4.97 -> 2.33 MB) alongside the sprites; the bake gains a walk-cycle sheet mode (10 frames, 568 KB) that phones animate with CSS alone on the join preview and lobby card; and `src/lib/diorama/` puts the players' avatars in a live themed 3D room on the display's lobby, interstitial, and winner screens - wandering, reacting to arrivals, celebrating the winners. three.js is code-split behind a dynamic import so the phone's route grows 2.8 KB and downloads no renderer. Preview without a game: `/dev/diorama`. This is the M4-follow-on delight pass the decision doc scheduled, and the groundwork the M7 world kits attach to.
- [ ] Reconcile with M3: flip `createRoomStore` to the ws store and wire the gap list in docs/design/surfaces.md (content channel, timers, pause, room-closed screens) - exit criteria (real phones in one room) blocks on this
- [ ] Deferred in-milestone: FLIP zoom-from-cell reveal, host companion view for mirrored setups, bundled sound files, PWA precache growth (tracked in docs/design/surfaces.md "Known gaps")

### M5 - Event readiness (the club night)

Team mode (shared-phone first), the event's board built in the editor from the curated content pool, per-event theme (environmental green/gold variant), picture/audio clue support (R2 media upload, Worker-proxied), sound pack (original/royalty-free - never sampled from the show), projector-boost display mode, and a full dress rehearsal - whose checklist includes the PWA drills: airplane-mode editor test and a service-worker-update-during-game drill (docs/decisions/2026-08-13-pwa.md). **Exit criteria: the Board Game Club x Environmental Law Society game runs on this software.**

### M6 - Fairness + resilience polish

Buzz latency compensation (arm-window + client-elapsed with RTT clamps), early-buzz lockout penalty, reconnection hardening under real phone conditions, host "resume crashed game" from DO state.

### M7 - Suite features

**Theme customizer** (owner priority - pull earlier if appetite allows): a visual editor over the theme document - pick fonts per slot from the curated self-hosted set, full color control, background (solid/gradient/pattern/uploaded image via R2 with auto-dim overlay), effects level (flat vs bevel-and-glow), live board preview, WCAG-contrast warnings; themes export/import and share like content packs. Also: CSV/spreadsheet import (+ J-Archive-shaped and Quizlet/Anki TSV), zip bundle export with media, print stylesheet, board sizes beyond 6x5, everyone-answers mode for large crowds, cosmetics module (player colors/avatars; buzzer sounds stay curated-pack-only - owner cut uploads 2026-08-13, boundary 2.10), single-file offline HTML export.

**3D lobby environments** (owner direction 2026-08-13, see directives log): Kenney world kits (CC0) + Cube Pets avatars as display-only three.js dioramas the players "live in" - lobby first, environment as a curated theme-document slot, phones and in-game surfaces stay 2D. **The diorama itself landed early, in M4** (above): avatars, wandering, reactions, theme-derived colors, and a `"none" | "studio"` environment enum. What remains here is the two halves it was deliberately built to receive - (a) the WORLD KITS: download + license-verify + budget a Kenney Nature/Pirate/Dungeon kit in `tools/avatar-bake`, and render it around the existing stage; (b) the THEME SLOT: one `environment` field on `themeBodySchema` in packages/protocol (the exact line is written out in `apps/web/src/lib/diorama/diorama-environment.ts`), after which the display passes `theme.environment` straight through and the local enum is deleted.

### M8 - Multi-user (only if wanted)

Phase 2 auth: Cloudflare Access in front of editor/host, boards in D1 keyed by Access email. Phase 3 (only if it goes multi-tenant): better-auth on D1. The `BoardRepository` seam from M1 makes this additive.

---

## Now / Next / Later

**Now**

- [x] Research round 1 (six agents: anatomy, landscape, architecture, style, UI, content) - docs/research/, docs/content/
- [x] Owner decisions on the open questions below (name still workshopping - not a blocker)
- [x] Pre-M0 design audit: expansion paths + customization boundaries + end-to-end user flows (docs/design/)
- [ ] M0 foundations - **scaffold landed 2026-08-13; only the owner's manual hello-world deploy remains** (per-item progress in the M0 section above)

**Next**

- [ ] M1 board format + editor core (protocol schemas landed 2026-08-13 - see the M1 progress list; visual editor remains)
- [x] M2 game engine (landed 2026-08-13 - see the M2 progress list; everyone-answers is engine-complete but not yet driven by the hotseat page)

**Later**

- M3 -> M5 in order (M5 is date-driven by the event; pull it earlier if the event date demands)
- M6 -> M8 as appetite allows

## Open decisions (owner input needed)

Resolved 2026-08-13 (see docs/decisions/2026-08-13-stack-choices.md): SvelteKit 3 prerelease · Tailwind v4 · kebab-case · zod · partyserver evaluated in M0 week 1.

Resolved 2026-08-13 (see docs/decisions/2026-08-13-theming-as-feature.md): art direction - no single winner; all three directions ship as theme presets and the game screen becomes highly customizable (fonts, colors, background) via the theme document + M7 customizer.

Resolved 2026-08-13: code license = **AGPL-3.0-only** (owner pick; four-surface analysis in docs/design/licensing.md). Sound pack round-1 approvals recorded in docs/content/media-and-sounds.md §7; buzzer pack needs a second sourcing round (6 approved vs ~10 target, min-duration standard added).

| #   | Decision     | Status                                                                                                                                                                  |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Product name | Shortlist under review: Buzzboard · Big Board · What Is · Podium · Answers First · Clueboard · Double Down. Will not ship as "Jeopardy"; repo may stay Jeopardy_Machine |

## Update protocol

- Every PR that ships roadmap-relevant work moves its checkbox/milestone state **in the same PR**.
- Resolved decisions leave the table above and become `docs/decisions/YYYY-MM-DD-<slug>.md`.
- Shipped milestones collapse to one line under "Recently shipped" (add the section at first ship).
- Scope changes (new features, cut features) are edits to the milestone list with a one-line rationale, not silent drift.

## Document map

| You need                                                         | Home                                         |
| ---------------------------------------------------------------- | -------------------------------------------- |
| Conventions, hard rules, commands (repo operating manual)        | CLAUDE.md                                    |
| Dev loop, testing, adding a package                              | docs/DEVELOPMENT.md                          |
| Stamped live state + reproduce-commands                          | docs/STATUS.md                               |
| Cloudflare account/provisioning/deploy runbook (owner-run)       | docs/cloudflare-setup.md                     |
| Exact version pins + SvelteKit 3 breaking-change notes           | docs/decisions/2026-08-13-m0-version-pins.md |
| M1 protocol schema proposal (under review)                       | docs/proposals/m1-protocol.md                |
| Owner directives + feature ideas log                             | docs/research/00-user-directives.md          |
| Expansion paths + customization boundaries (the design law)      | docs/design/expansion-and-boundaries.md      |
| End-to-end user flows: guest / creator / host                    | docs/design/user-flows.md                    |
| Game rules, buzzer mechanics, 42-setting rules matrix            | docs/research/01-game-anatomy.md             |
| Competitor features, paywalls, lessons                           | docs/research/02-landscape.md                |
| Stack, DO design, storage, auth phases, costs                    | docs/research/03-architecture.md             |
| Owner coding conventions + divergence questions                  | docs/research/04-style-guide.md              |
| UI tooling, art direction, tokens, buzzer UX                     | docs/research/05-ui-design.md                |
| Event question pool (105 clues, media sources, fact-check flags) | docs/content/event-content-pool.md           |
