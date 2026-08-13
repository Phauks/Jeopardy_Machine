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

## First event target
- Joint Board Game Club × Environmental Law Society night.
- Questions: environmental + gaming topics ONLY — explicitly nothing law-related.
