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

- **No player sound uploads, ever** (owner, 2026-08-13): buzzer sounds are curated-pack-only long-term. Low benefit, too many issues (live-event moderation, music rights, pipeline QA). The pack grows by request instead - adding a vetted CC0 sound is a PR. Supersedes the earlier upload-with-host-veto idea in M7.
- **Only the winning buzz is heard.** When multiple players buzz, exactly one room sound plays - the adjudicated winner's. Room audio is driven by the server's buzz-won event (one per clue arming), never by client presses, so overlap is structurally impossible rather than merely avoided. Losing buzzers get silent local feedback on their own phone only. Rebounds re-arm and may produce a second (sequential) winner sound; that is correct. Rule generalizes: the room audio channel plays buzz sounds in an exclusive slot - a would-overlap event is dropped, not queued (a late sound after the moment is confusing). Exception: the host's sound-check mode intentionally plays every team's sound, serialized through a queue.
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
- **UPDATE 2026-08-13: single-color emblems rejected too.** Owner wants **full-color icon packs** for player identity, preferably with animals. Requirements: bundle-clean license (CC0/MIT/Apache preferred; CC-BY acceptable with credits screen), consistent style across the set, reads at chip size on phones AND on the big-screen roster, animals well represented. Candidates under evaluation (see comparison artifact): Kenney game-asset packs (CC0), Microsoft Fluent Emoji (MIT), Google Noto Color Emoji (OFL/Apache), OpenMoji (CC BY-SA - flag the SA). The 16 single-color SVG emblems in apps/web/src/lib/emblems/ get replaced once a pack is chosen; tint-via-currentColor machinery goes away.
- **Post-join customization required**: players can change appearance after joining a team (see user-flows "Post-join customization").
- **Host mirror view required**: host's screen is sometimes literally mirrored to the projector; console needs a mirror mode whose private layer (answers, DD locations) moves to a host-phone companion view or the print pack (see user-flows C1b).
- **Interactive token swap**: gallery presets were static; owner wanted to actually flip themes. Next gallery revision gets a working preset switcher (also a proof-drill for the token contract). Owner endorses the constraint: "having theming this way forces our theming to be very well designed."
- **Team-scoped buzz sounds**: in team mode the room-audible sound is the team's (leader-picked), acting as double confirmation (audio + visual) of who won the buzz; personal sounds play locally only (see user-flows "Teams & leadership").

## Avatars: Kenney 3D only (owner, 2026-08-13 - RESOLVES the avatar decision)

- **No 2D packs. Kenney 3D assets exclusively, for consistency** with the environments direction - characters and worlds are one visual universe.
- Candidate sets (all CC0): **Cube Pets** (15 animals - recolor + legibility proven in the Cube Pets Proof artifact), **Mini Characters** (kenney.nl/assets/mini-characters), **Blocky Characters** (kenney.nl/assets/blocky-characters). Humans + pets can coexist as avatar categories if styles mesh - render proof to verify.
- The **baked-sprite pipeline** (headless three.js -> webp at build time) is the canonical avatar path: phones get sprites, never 3D. The proven palette-recolor mechanism applies; verify per-pack how skins/materials store color.
- Small-size story per the proof: avatars render at 48px+; at 24px the team/player accent-colored chip carries identity. Accepted trade-off (owner chose charm + consistency over 24px face detail).

## 3D environments - "worlds where the players live" (owner, 2026-08-13)

Owner direction: use Kenney's 3D asset kits (all CC0, one consistent low-poly style) to build **environments the player avatars inhabit** - pirate ship deck, dungeon, forest, etc. Cube Pets avatars + Kenney world kits = a coherent visual universe.

Scoping (proposed, to keep this shippable):

- **Display-device only.** 3D renders on the big screen (a laptop driving a projector - three.js, low-poly = cheap). Phones never render 3D; their chips use the pre-rendered avatar sprites. Console untouched.
- **Lobby first.** The signature moment: as players join, their pets appear IN the environment (wandering/dancing - Cube Pets ship with walk/run/dance animations) under the QR code while the lobby track plays. Kahoot-lobby energy, but a diorama filling with your friends.
- **Environment = a theme-document slot.** Like sound sets: a curated `environment` field (forest / pirate / dungeon / none) in the presentation layer, zero game-logic coupling (design law holds). "None" keeps the clean 2D lobby - 3D is additive, never required.
- **In-game stays 2D.** The board/clue screens remain the readable 2D surfaces; environments may frame interstitials (round transitions, winner podium - pets on deck celebrating) later.
- **First event fit**: the forest/nature kit IS the environmental theme. Terra Verde lobby = pets in a low-poly forest.
- Candidate kits to evaluate: Nature Kit, Pirate Kit, Graveyard/dungeon kits, Castle Kit (verify current names/contents at build time).
- Milestone placement: after M5 (event may get a v0 forest lobby ONLY if M4/M5 land early; otherwise first post-event delight milestone). The Cube Pets render pipeline (sprite baking) is the same tooling foundation either way.

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

## Full-color avatar pack candidates (2026-08-13)

Research round for the full-color player-identity icons that replace the rejected single-color emblems (`apps/web/src/lib/emblems/`). Real samples were downloaded from each pack and licenses verified on the actual license files (not marketing pages). Visual comparison page with all samples at 96/48/24 px: scratchpad `avatar-packs.html` (published as the "Avatar Packs" artifact).

| Pack                                                                                                            | License (verified)                                                                                                                                                                                | Animals                                                                                                                                | Style                                                                                                            | Verdict                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Kenney Animal Pack Remastered** ([kenney.nl](https://kenney.nl/assets/animal-pack-remastered))                | **CC0 1.0** — confirmed in the zip's `License.txt` ("credit would be nice but is not mandatory")                                                                                                  | 30 animals × 8 variants (round/square, ±details, ±outline) = 240 assets; animals only                                                  | Chunky round game-art heads, flat cel shading, identical framing; outlined variant stays crisp on any chip color | **Front-runner.** Purpose-built for games, zero license overhead, best 24 px legibility. Limits: 30 animals, no fox/lion/tiger, no objects |
| **Microsoft Fluent Emoji** ([github.com/microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji)) | **MIT** — plain MIT LICENSE, © Microsoft; keep notice in bundle                                                                                                                                   | Full Unicode: 131 animal glyphs (66 mammal / 22 bird / 18 marine / 16 bug / 8 reptile / 1 amphibian; ~19 big-face heads) + all objects | Soft-gradient modern flat (Color SVG) plus glossy 3D PNG style; consistent but more "app" than "game"            | **Strong runner-up.** Huge roster incl. fox/lion/tiger + objects in one style; MIT is bundle-clean                                         |
| **Twemoji** (maintained fork: [github.com/jdecked/twemoji](https://github.com/jdecked/twemoji))                 | **CC-BY 4.0** graphics (`LICENSE-GRAPHICS`), MIT code; README accepts footer/about-screen attribution                                                                                             | Full Unicode: 131 animal glyphs (~19 faces) + objects; tiny SVGs (<3 KB)                                                               | Flat, bold, geometric; crispest emoji set at 24 px (no gradients to mush)                                        | Workable with a credits screen, but Fluent offers a comparable roster without the attribution requirement                                  |
| **Google Noto Color Emoji** ([github.com/googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji))    | **Ambiguous**: root LICENSE is now OFL 1.1, but README still claims images are Apache-2.0 and links to that same file. Both free, but contradictory paperwork; OFL is awkward for standalone SVGs | Full Unicode: 131 animal glyphs (~19 faces) + objects                                                                                  | Stock Android emoji look — soft, rounded, least distinctive                                                      | Fallback only; license contradiction upstream and no styling advantage over Fluent/Twemoji                                                 |
| **OpenMoji** ([openmoji.org](https://openmoji.org))                                                             | **CC BY-SA 4.0** — confirmed in repo `LICENSE.txt` and site FAQ. **Flagged: ShareAlike** — adaptations (recolor/composite into chips) arguably must be BY-SA too                                  | Full Unicode + ~800 extras                                                                                                             | Hand-drawn line art with signature black outline; charming, very consistent; outlines thin at 24 px              | **Do not pick.** SA is legal overhead we don't need when CC0/MIT peers exist                                                               |
| Kenney Fish Pack 2.0 / Cube Pets ([kenney.nl](https://kenney.nl/assets/fish-pack))                              | CC0 1.0 — confirmed in zip `License.txt`                                                                                                                                                          | ~8 distinct fish (color variants, 64 px sprites); Cube Pets = 24 3D models, not icons                                                  | Same lovable Kenney game style                                                                                   | Not a fit: too few shapes, and color is the distinguisher — collides with per-player accent colors                                         |

**Ranked recommendation:**

1. **Kenney Animal Pack Remastered** — CC0 (literally zero obligations), the only set actually designed as game art, the strongest small-size legibility (thick outlines, no gradients), and the white-outline variant solves icon-on-colored-chip contrast for free. 30 animals covers 2–100 players if avatars may repeat across teams (they're per-player identity _within_ a team display, so repeats are tolerable) — or cap unique-avatar count at 30.
2. **Fluent Emoji (Color style)** — if we want 100+ unique animals or non-animal avatars (robot/alien/ghost) in the same style, MIT-clean. Also the designated _extension_ pack: if Kenney's 30 ever feels tight, mixing Kenney animals + Fluent objects is licence-clean but visibly style-inconsistent — treat mixing as a deliberate later decision, not the default.
3. **Twemoji (jdecked)** — only if the flat style wins on looks; costs a credits screen (CC-BY).
4. **Noto** — fallback; upstream license paperwork contradictory (OFL vs Apache).
5. **OpenMoji** — rejected on CC BY-SA despite the nicest illustration style.

## Avatar set FINAL + autonomy scope (owner, 2026-08-13, before leaving)

- **Avatar set: Cube Pets + Mini Characters** (proof-verified single universe, shared recolor mechanism). Sprite pipeline builds against both; Blocky is out.
- **Autonomy scope granted: build as far as possible** - M3 (realtime rooms) -> M4 (play surfaces) -> M5 prep, each milestone gate-verified. PRs are opened with green CI; owner merges on return (nothing deploys unattended).

## No legacy code (owner, 2026-08-14)

- **There are no users and no backwards-compatibility obligation.** Do not carry deprecation shims, redirects for renamed routes, compatibility branches, or "kept for old clients" code paths. Rename freely and delete the old thing in the same commit.
- Applies to: route renames (no redirects), protocol shapes (change them; the wire version refuses mismatches and the PWA reload is the upgrade path), document schemas (edit the schema and update fixtures rather than writing a migration for a format nobody has), and config/env vars.
- **Keeps its value:** the migration MACHINERY in the protocol package (proven by a synthetic fixture, not by real legacy) - it exists for the day documents are in strangers' Downloads folders, which is a real future, not a legacy debt. Same for the WS version handshake.
- First application: `/dev/echo` redirect deleted (the page is `/dev/rooms`), and the lobby hand-off now points at the real join screen instead of the harness.
