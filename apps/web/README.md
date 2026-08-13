# @jeopardy/web

The SvelteKit 3 app Worker: every UI surface (editor, host console, board display, phone buzzer - all future milestones), later the REST API with D1/R2. Realtime WebSockets are NOT served here - phones connect directly to the sibling realtime Worker (origin configured via `REALTIME_ORIGIN`, declared in `src/env.ts`).

- SvelteKit 3 prerelease: config lives in `vite.config.ts` (no svelte.config.js), `#lib` replaces `$lib`, env vars are declared in `src/env.ts` - the full SK2-vs-SK3 list: docs/decisions/2026-08-13-m0-version-pins.md.
- PWA skeleton: `static/manifest.webmanifest` + `src/service-worker/` (network-first navigations, precached immutable assets, no skipWaiting - docs/decisions/2026-08-13-pwa.md). No install prompts anywhere.
- `/dev/echo` is the dev-loop smoke page (docs/DEVELOPMENT.md); `/dev/theme` is the theme gallery (live preset switcher over the token contract - docs/design/theming.md); `/dev/hotseat` plays a full game against `@jeopardy/engine` with one keyboard and no server (the M2 exit-criteria proof; game material from `src/lib/hotseat/sample-game.ts`, a real parsed game-definition document). `/dev/*` routes never get linked from product UI.
- Theming: token contract in `src/lib/theme/tokens.css`, presets + document-to-CSS mapping alongside it, self-hosted fonts in `static/fonts/` (licensing there). Reference: docs/design/theming.md.
- `pnpm check` runs svelte-check plus a separate `tsc -p src/service-worker` (WebWorker libs).
