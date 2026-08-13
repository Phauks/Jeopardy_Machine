# 2026-08-13 - Stack choices (owner-resolved)

Owner resolved the open decisions from research round 1:

1. **SvelteKit 3 prerelease.** Build on `@sveltejs/kit@3.0.0-next.*` from day one, accepting prerelease churn to be current at GA. Mitigation: pin exact versions, keep a CI job on `@next`, and treat breakage as ordinary maintenance. (Research had leaned 2.x-then-migrate; owner chose 3 now.)
2. **Tailwind v4** as the utility + token layer (magna-carta philosophy wins over sagebrush's no-Tailwind stance). tokens.css remains the SSOT; Tailwind consumes it via `@theme inline`. Game board and buzzer stay fully custom components regardless.
3. **kebab-case** file naming everywhere, including Svelte components (`board-cell.svelte`).
4. **Art direction: deferred to owner**, iterated visually via the "Three Boards" artifact (three directions: faithful-retro TV, modern flat, event poster; plus token-theming demo). Owner will co-develop; no base direction locked yet.
5. **Product name: to be chosen; will not ship as "Jeopardy".** JeopardyLabs' use noted, but we change anyway. Shortlist under consideration (see roadmap).
6. **zod** for validation - the shared protocol package is a large schema surface (WS messages, board format, settings).
7. **partyserver evaluation** happens in M0 week 1 alongside the local-dev-loop validation.

## Content portability (owner directive, same day)

Quiz content must be usable across game modes. Questions, media assets, and their metadata form a **game-mode-agnostic content layer**; a Jeopardy board is a _presentation_ of content items, not their owner. Consequences:

- `packages/protocol` splits into `content` (question items: prompt, answer, media refs, tags, difficulty, source note) and `modes/jeopardy` (board layout: rounds, categories, cell -> content-item references, values, wager cells).
- The file-format story follows: a **content pack** (questions + assets) exports/imports independently of a **game definition** (which mode, which layout, which settings). A single bundle can carry both.
- User data (accounts later, play history) and game data (live room state, results) stay separate layers from content.
- Future game modes (e.g. rapid-fire quiz, Kahoot-style everyone-answers, picture rounds as their own mode) consume the same content packs.
- M1 is reframed to build the content model first, then the Jeopardy board format on top of it.
