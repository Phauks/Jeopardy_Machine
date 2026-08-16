# Jeopardy Machine

A free, self-hosted quiz-show game creation suite (Jeopardy-inspired; shipping name pending): visual board editor, big-screen game board, host control panel, and phone-as-buzzer play for 2-100 players who join via QR/room code - no accounts, no paywalls, no app installs.

Built with SvelteKit 3 + Svelte 5 on Cloudflare Workers; one Durable Object per game room powers real-time buzzing. Installable as a PWA for creators and hosts; players always stay in the browser tab.

**Status:** M0 foundations - monorepo, shared protocol package, realtime Worker stub, app shell, and the local dev loop are in place; nothing is deployed yet. [ROADMAP.md](ROADMAP.md) is the living index of what exists, what is next, and what is decided.

## Features (committed direction)

- **Authored boards + integrated phone buzzers, free** - the exact combination competitors paywall.
- **Content is portable** - questions live in game-mode-agnostic content packs; boards, settings, and themes are separate versioned JSON documents that export/import cleanly.
- **The host is always in control** - every automated step has an override and an undo.
- **Theming as a feature** - the board's look (fonts, colors, background) is a portable theme document, with built-in presets.
- **Players never log in** - room code is the entire join flow, forever.
- **Public lobby or private code** - a room is public or private, and independently open or password-protected; the password is a shared room secret, never an account.

## Quick start (development)

```sh
pnpm install
pnpm dev        # SvelteKit app on :5173 + realtime Worker on :8787
```

Then open <http://localhost:5173/> - the landing page carries the Join section (room code, password, and the public-rooms lobby) above the index of everything that exists so far. The real room path (create, connect, join) runs under the single-origin loop documented in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), which also covers testing and the deploy story.

## Repo map

| Path                 | What                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `apps/web/`          | SvelteKit 3 app Worker - all UI, later REST API + D1/R2                               |
| `apps/realtime/`     | Plain Worker - `GameRoomDO`, WebSocket-only                                           |
| `packages/protocol/` | Shared contracts: wire envelope, `ext` bag, operational limits, room + document layer |
| `tools/avatar-bake/` | Offline pipeline that bakes the committed avatar sprites from Kenney CC0 3D packs     |
| `docs/`              | Development guide, stamped status, dated decisions, proposals, design docs, research  |
| `CLAUDE.md`          | Conventions + hard rules (the repo's operating manual)                                |

## Documentation

- [ROADMAP.md](ROADMAP.md) - milestones, open decisions, document map
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - dev loop, testing, adding packages
- [docs/STATUS.md](docs/STATUS.md) - stamped live state with reproduce-commands
- [docs/decisions/](docs/decisions/) - dated one-page decision records
- [docs/design/](docs/design/) - the design law (expansion & boundaries) and end-to-end user flows

## Stack

SvelteKit 3 (prerelease, pinned) · Svelte 5 runes · Tailwind v4 · Cloudflare Workers + Durable Objects (partyserver transport) · zod · pnpm workspace · Vite+ (`vp`: Vitest 4, Oxlint, Oxfmt) · vitest-pool-workers for in-workerd DO tests.

## License

- **Code**: [AGPL-3.0-only](LICENSE) - free to self-host, modify, and share; a hosted service built on modified code must publish its modifications (the network clause is the point: this project exists because the alternatives are paywalled). Rationale: docs/design/licensing.md.
- **Bundled fonts**: SIL OFL 1.1, per-face texts in apps/web/static/fonts/LICENSES.md.
- **Bundled avatar sprites**: baked from Kenney CC0 1.0 packs, provenance in apps/web/static/avatars/LICENSES.md.
- **Bundled sounds**: CC0 only (curated pack policy - docs/design/expansion-and-boundaries.md §2.10), credits ledger kept anyway.
- **Your content**: boards, packs, and themes you create are yours; exports carry an optional license field you control. The app claims nothing.
