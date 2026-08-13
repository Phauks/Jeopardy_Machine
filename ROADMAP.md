# Roadmap

> **This is a living document.** It is updated in the same commit as any work that changes it - milestones move between sections, shipped items get pruned to the changelog, and open decisions get resolved into dated records under `docs/decisions/`. If this file disagrees with the code, fix this file.
>
> Last updated: 2026-08-13 (research round 1 complete; stack decisions resolved; no code yet)

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
Scaffold the pnpm monorepo (`apps/web`, `apps/realtime`, `packages/protocol`) with the owner's conventions from docs/research/04-style-guide.md: Vite+ (`vp`) with Oxlint/Oxfmt, TypeScript strict, Svelte 5 runes, `wrangler.jsonc` with commented bindings, CI gate (PR-only), `.claude/settings.json` deploy denies, CLAUDE.md + docs skeleton (STATUS.md, decisions/, proposals/). **Exit criteria:** `pnpm test` green in CI; hello-world deploys of both Workers verified manually; local dev loop for the two-Worker + DO setup proven (architecture risk 6).

### M1 - Content model + board format + editor core
Two-layer data model in `packages/protocol` (zod schemas + migration functions): the **content layer** (question items: prompt, answer, media refs, tags, difficulty, source note - game-mode-agnostic) and the **jeopardy mode layer** (board layout: rounds, categories, cells referencing content items, values, wager cells). The visual editor: create/edit content items and compose boards from them (with a fast "type straight into the grid" path that creates content items implicitly), localStorage persistence behind repository interfaces; export/import of content packs and game definitions. **Exit criteria:** a full 6x5 two-round board can be authored, exported, re-imported, survives a format-version bump - and its questions can be listed/reused independently of the board. The protocol also defines the **theme document** schema (token values, font-slot choices, background spec, effects level) so themes are a portable, shareable artifact from day one.

### M2 - Game engine (pure logic, no network)
The rules state machine as pure, heavily-tested functions: round flow, clue lifecycle (reading -> armed -> buzzed -> judged -> rebound), scoring incl. negatives and overrides, Daily Double wagering math, Final round flow, tiebreakers - all 42 settings from the configurable rules matrix (docs/research/01-game-anatomy.md) as a typed config object with defaults. **Exit criteria:** engine passes a test suite covering the rules matrix; a keyboard-driven "hotseat" debug page can play a full game locally with no server.

### M3 - Realtime rooms (DO + WebSockets)
`GameRoomDO` in `apps/realtime`: room codes via `idFromName`, WebSocket Hibernation, session-token reconnection, snapshot + patch protocol, server-arrival buzz ordering (fairness compensation deferred to M6), alarms for room cleanup. **Exit criteria:** vitest-pool-workers suite incl. hibernation-eviction tests; Playwright multi-context test proves deterministic buzz ordering with simulated phones.

### M4 - Play surfaces (board, buzzer, host)
The three UIs on the design-token foundation (docs/research/05-ui-design.md): tokens.css + fonts + theme mechanism first - the three "Three Boards" art directions all ship as built-in **theme presets** (retro-tv, modern-flat, event-poster) plus the Terra Verde event variant, proving the token contract covers real visual range - then primitives in a `/dev` gallery, then the board screen (fill-in stagger, FLIP clue zoom, DD splash, timer bars), the phone buzzer (fixed layout, wake lock, pointerdown + optimistic feedback, per-player buzz sounds from a curated pack), and the host console (arm button, correct/wrong/no-penalty, score override, undo, Final round wizard). Join flow: QR + room code + nickname + lobby. **Exit criteria: a complete real game is playable end-to-end by phones in a room.** This is the "usable at an event" line.

### M5 - Event readiness (the club night)
Team mode (shared-phone first), the event's board built in the editor from the curated content pool, per-event theme (environmental green/gold variant), picture/audio clue support (R2 media upload, Worker-proxied), sound pack (original/royalty-free - never sampled from the show), projector-boost display mode, and a full dress rehearsal. **Exit criteria: the Board Game Club x Environmental Law Society game runs on this software.**

### M6 - Fairness + resilience polish
Buzz latency compensation (arm-window + client-elapsed with RTT clamps), early-buzz lockout penalty, reconnection hardening under real phone conditions, host "resume crashed game" from DO state.

### M7 - Suite features
**Theme customizer** (owner priority - pull earlier if appetite allows): a visual editor over the theme document - pick fonts per slot from the curated self-hosted set, full color control, background (solid/gradient/pattern/uploaded image via R2 with auto-dim overlay), effects level (flat vs bevel-and-glow), live board preview, WCAG-contrast warnings; themes export/import and share like content packs. Also: CSV/spreadsheet import (+ J-Archive-shaped and Quizlet/Anki TSV), zip bundle export with media, print stylesheet, board sizes beyond 6x5, everyone-answers mode for large crowds, cosmetics module (player colors/avatars, custom buzzer sound upload with host veto), single-file offline HTML export.

### M8 - Multi-user (only if wanted)
Phase 2 auth: Cloudflare Access in front of editor/host, boards in D1 keyed by Access email. Phase 3 (only if it goes multi-tenant): better-auth on D1. The `BoardRepository` seam from M1 makes this additive.

---

## Now / Next / Later

**Now**
- [x] Research round 1 (six agents: anatomy, landscape, architecture, style, UI, content) - docs/research/, docs/content/
- [ ] Owner decisions on the open questions below
- [ ] M0 foundations

**Next**
- [ ] M1 board format + editor core
- [ ] M2 game engine

**Later**
- M3 -> M5 in order (M5 is date-driven by the event; pull it earlier if the event date demands)
- M6 -> M8 as appetite allows

## Open decisions (owner input needed)

Resolved 2026-08-13 (see docs/decisions/2026-08-13-stack-choices.md): SvelteKit 3 prerelease · Tailwind v4 · kebab-case · zod · partyserver evaluated in M0 week 1.

Resolved 2026-08-13 (see docs/decisions/2026-08-13-theming-as-feature.md): art direction - no single winner; all three directions ship as theme presets and the game screen becomes highly customizable (fonts, colors, background) via the theme document + M7 customizer.

| # | Decision | Status |
|---|---|---|
| 5 | Product name | Shortlist under review: Buzzboard · Big Board · What Is · Podium · Answers First · Clueboard · Double Down. Will not ship as "Jeopardy"; repo may stay Jeopardy_Machine |

## Update protocol

- Every PR that ships roadmap-relevant work moves its checkbox/milestone state **in the same PR**.
- Resolved decisions leave the table above and become `docs/decisions/YYYY-MM-DD-<slug>.md`.
- Shipped milestones collapse to one line under "Recently shipped" (add the section at first ship).
- Scope changes (new features, cut features) are edits to the milestone list with a one-line rationale, not silent drift.

## Document map

| You need | Home |
|---|---|
| Owner directives + feature ideas log | docs/research/00-user-directives.md |
| Game rules, buzzer mechanics, 42-setting rules matrix | docs/research/01-game-anatomy.md |
| Competitor features, paywalls, lessons | docs/research/02-landscape.md |
| Stack, DO design, storage, auth phases, costs | docs/research/03-architecture.md |
| Owner coding conventions + divergence questions | docs/research/04-style-guide.md |
| UI tooling, art direction, tokens, buzzer UX | docs/research/05-ui-design.md |
| Event question pool (105 clues, media sources, fact-check flags) | docs/content/event-content-pool.md |
