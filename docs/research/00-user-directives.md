# User Directives & Ideas Log

> Running log of decisions and feature requests from the project owner, captured during research round 1 (2026-08-13). These override or extend anything in the research docs.

## Confirmed decisions
- **Framework**: SvelteKit 3 (user wants to try it; architecture research to verify release status and fallback).
- **Platform**: Cloudflare Workers (Pages is deprecated — do not target Pages). Durable Objects for game rooms.
- **Scale**: design for 2–100 players per game.
- **Top priorities**: modularity and documentation. Living `ROADMAP.md` updated as work proceeds.
- **Style reference repos**: `Phauks/magna-carta`, `Phauks/Sagebrush-Barrister`.
- **Content requirements**: import/upload, download/export of games must be first-class.
- **Open question (research to recommend)**: multi-user login vs local-only storage.
- **UI**: must look genuinely good — deliberately designed, not "AI-made" — and be easy to develop against.

## Design philosophy (owner directive, 2026-08-13)
- **Jeopardy is the inspiration, not the specification.** Do not arbitrarily match the TV show. Every show-derived setting or mechanic must be justified by fun; if it is not, relax it or explore a better variant. Ship TV rules as one preset, not as the definition of the game. Examples of things explicitly open to rethinking: dollar values vs points, question-format requirement, negative scoring, round structure, buzzer conventions, board dimensions.

## Feature ideas from the user
- **Customizable buzzer sounds**: each player/team can pick (or upload?) the sound that plays when they buzz in. Fun + helps the host identify who buzzed without looking.
  - Design implications: sound picker in the player join/lobby flow; a curated royalty-free sound pack (short, distinct, room-friendly); optional per-player upload (needs R2 + moderation/size limits + host veto); host master-volume/mute; preview button; sounds play on the host/board device (not the phone) so the room hears one canonical audio source.
- **Other customizable elements** (same spirit — personalization as a feature pillar):
  - Player/team names with emoji + color/avatar pick at join.
  - Per-event theming of the board (colors/fonts/logo) — first event: Board Game Club × Environmental Law Society.
  - Custom category header styling, custom win screens, custom "Daily Double"-equivalent branding per game.
  - Treat personalization as a module ("cosmetics") so it can grow without touching game logic.

## Team leadership (owner, 2026-08-13)
- Team creator = **team leader**: names the team, kicks members who don't belong, controls team-level customization (e.g. team color), and can **hand off the leader role** to another player.
- Personal customization stays personal: players keep their own identity assets (avatar/accent/buzzer sound) visible within the team display, independent of team-level choices.
- Specced in docs/design/user-flows.md ("Teams & leadership"); protocol modeling in M3, ships with team mode in M5.

## Architecture directive (owner, 2026-08-13)
- **Quiz content must be reusable across game modes.** Question files should be usable in other types of games, which delineates how we deal with files, questions, assets, game data, and user data as separate layers. See docs/decisions/2026-08-13-stack-choices.md for the resulting model (content packs vs game definitions vs live game data vs user data).

## Decisions resolved 2026-08-13
- SvelteKit 3 prerelease (not 2.x-then-migrate). Tailwind v4. kebab-case components. zod. partyserver evaluated M0 week 1.
- Art direction: **all three directions ship as theme presets; the game screen is highly customizable** (fonts, colors, background chosen by the host). Theme = portable document; visual customizer UI in M7 (owner priority). See docs/decisions/2026-08-13-theming-as-feature.md.
- Name: will change from "Jeopardy" for shipping; shortlist in ROADMAP.md.

## First event target
- Joint Board Game Club × Environmental Law Society night.
- Questions: environmental + gaming topics ONLY — explicitly nothing law-related.
