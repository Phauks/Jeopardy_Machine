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

## UX questions resolved (owner, 2026-08-13)

- **No-phones "manual mode": ship it** (M4) - host awards points from the console, no buzzers; doubles as the Wi-Fi-failure fallback.
- **Audio routing: selectable** - per-device "play room audio here" toggle (display on by default); multiple devices can opt in.
- **Late-join score: flexible** - a setting (0 default / match lowest / prompt host), rules matrix #43.

## Audio pipeline (owner, 2026-08-13)

- **Standardized sound onset.** Source audio has inconsistent leading silence; every bundled sound gets a uniform onset (~10 ms to first audible energy - not too short: a micro fade-in prevents clicks; not too long: onset is perceived buzz latency, and non-uniform onsets are unfair across teams). Spec in docs/content/media-and-sounds.md checklist §7b; playback uses pre-decoded Web Audio buffers (M4).

## Development simulation (owner, 2026-08-13)

- **Built-in mocking of players/teams/actions for development.** We must be able to pretend that teams and players are present and acting - without real phones. Three layers, matching the milestones:
  - **Engine level (M2)**: scripted action sequences (join, buzz at t+ms, answer wrong, disconnect, late-join) as data - the same fixtures drive unit tests and the hotseat/rehearse page.
  - **Realtime level (M3)**: **bot players** - headless clients speaking the real WS protocol against a real GameRoomDO (join with names/teams, configurable buzz latency distributions, scripted or seeded-random behavior). Highest fidelity: exercises the exact code paths phones use.
  - **UI level (M4)**: a dev-only **simulation panel** on the host console (spawn N bots, assign teams, trigger specific events: leader kick, phone-sleep reconnect, mass buzz race) - feature-flagged, available on preview deploys, never reachable by players.
- Seeded randomness so any simulated game is reproducible in a bug report.

## Content model (owner, 2026-08-13)

- **Media attaches to both question AND answer.** A content item's prompt and its answer each carry an optional media ref - the reveal can show an image/audio (picture-round reveal shows the labeled park photo; music clue reveals the cover art). In the v1 content-item schema from the start.

## UI gallery feedback round 1 (owner, 2026-08-13)

- **Kick / make-leader go behind a per-member "..." overflow menu** - not exposed buttons. (Answers the gallery's kick-exposure question.)
- **Emoji skepticism**: owner is unsure about raw emoji as player identity markers. Next UI iteration explores a curated emblem set (consistent, designed marks - could be a custom SVG icon set or a tightly curated emoji subset rendered uniformly) instead of free emoji.
- **Post-join customization required**: players can change appearance after joining a team (see user-flows "Post-join customization").
- **Host mirror view required**: host's screen is sometimes literally mirrored to the projector; console needs a mirror mode whose private layer (answers, DD locations) moves to a host-phone companion view or the print pack (see user-flows C1b).
- **Interactive token swap**: gallery presets were static; owner wanted to actually flip themes. Next gallery revision gets a working preset switcher (also a proof-drill for the token contract). Owner endorses the constraint: "having theming this way forces our theming to be very well designed."
- **Team-scoped buzz sounds**: in team mode the room-audible sound is the team's (leader-picked), acting as double confirmation (audio + visual) of who won the buzz; personal sounds play locally only (see user-flows "Teams & leadership").

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
