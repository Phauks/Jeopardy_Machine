# UI Research: SvelteKit Jeopardy Suite (Aug 2026)

> Research round 1 · Agent: UI & Design · 2026-08-13
> Goal: UI that (a) looks genuinely good and distinctive — NOT generic AI slop, (b) is easy and fast to develop, (c) stays modular. Three surfaces: big-screen game board (projector/TV), phone player/buzzer view, desktop board editor + host control panel.

---

## 1. Svelte UI ecosystem — state of play, August 2026

| Option                          | Svelte 5 / runes                                                | Tailwind v4                                                       | Maintained?                                           | "Custom look" potential                                   | Verdict for this project                                                               |
| ------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **shadcn-svelte** (huntabyte)   | Yes — current version is runes-native                           | Yes — full `@theme` support, CLI scaffolds Tailwind v4 + Svelte 5 | Actively; the de-facto standard                       | High — you own the copied source, restyle freely          | **Best choice for editor/host panel**                                                  |
| **Bits UI**                     | Yes — built for Svelte 5                                        | Headless, CSS-agnostic                                            | Actively (same author; what shadcn-svelte sits on)    | Maximum — unstyled primitives                             | Use directly for any one-off primitive styled with your own tokens                     |
| **Melt UI**                     | Works, but internals still store-based; runes migration ongoing | Headless                                                          | Slower cadence; Bits UI has effectively superseded it | Maximum, but more code                                    | Skip                                                                                   |
| **Skeleton v3**                 | Yes (Zag.js-based)                                              | Yes (requires Tailwind v4)                                        | Actively                                              | Medium — recognizable "Skeleton look"                     | Viable but adds an opinionated system you'd fight on game surfaces                     |
| **daisyUI 5**                   | CSS-only plugin                                                 | Yes                                                               | Actively                                              | Low-medium — instantly recognizable                       | Skip for user-facing                                                                   |
| **Flowbite-svelte**             | Exists                                                          | Yes                                                               | Actively, but quality/a11y trails Bits UI             | Low — the definition of the generic look                  | Skip                                                                                   |
| **Plain Tailwind v4**           | n/a                                                             | v4 current; CSS-first config via `@theme`, native CSS vars        | —                                                     | High if you define your own tokens and never use defaults | Good utility layer for all surfaces                                                    |
| **Vanilla CSS + design tokens** | n/a                                                             | —                                                                 | —                                                     | Highest                                                   | **Best for game board + buzzer** — ~a dozen bespoke components; a library buys nothing |

**Per-surface recommendation:**

- **Board editor + host control panel (desktop):** shadcn-svelte on Tailwind v4. Real, accessible primitives (data tables, dialogs, command palette, forms, toasts) fast; vendored source means full retheming with project tokens so nothing reads as stock. Bits UI underneath means keyboard/focus behavior is solved.
- **Game board (projector/TV):** fully custom Svelte 5 components, vanilla CSS (or minimal utilities) driven entirely by design tokens. The board is a single strongly art-directed screen; a component library is pure weight.
- **Phone buzzer:** fully custom. Essentially one giant button plus a status strip and score readout; every byte and every ms of input latency matters more than library convenience.

Stack detail: keep Tailwind v4 as the shared utility layer across all three surfaces (it's just CSS now — `@theme` emits native custom properties), so the token system is one file and custom surfaces can still use utilities for layout scaffolding without adopting component classes.

> NOTE (orchestrator): the owner's style research (04-style-guide.md) shows a genuine fork — sagebrush-barrister bans Tailwind ("plain CSS with tokens.css SSOT"), magna-carta embraces Tailwind v4 + headless Bits UI + tokens. Both philosophies are compatible with this section's per-surface split; the CSS question is a flagged decision for the owner.

## 2. Avoiding the "AI-made" look

The generic-AI tell is a specific cluster: default Tailwind palette (slate/indigo/violet), Inter everywhere, `rounded-xl` cards with `shadow-md`, purple-to-blue gradients, emoji-as-icons, equal 1rem spacing everywhere, no typographic hierarchy beyond font-size. The antidote is committing to one real art direction and letting it constrain every decision:

**Concrete principles**

1. **Commit to trade dress, not decoration.** Jeopardy's identity IS typography + two colors. Deep saturated blue (`#060CE9` is the commonly-cited board blue), gold/yellow money values, white all-caps condensed category type, serif all-caps clue text. Build the whole system from that and it cannot look generic.
2. **Deliberate type pairing, zero Inter.** Per [Fonts In Use](https://fontsinuse.com/uses/5507/jeopardy-game-show): categories/dollar values = **Swiss 911** (Bitstream Helvetica Compressed family, incl. Ultra Compressed); clues = **ITC Korinna** (soft art-nouveau serif) in all caps; logo derives from a phototype face called Anonymous ([Gyparody](https://famfonts.com/jeopardy/) is the well-known free logo lookalike — fine for a personal event, but designing your own wordmark is safer and more distinctive).
3. **Legally-safe free font stand-ins (all Google Fonts / open licenses):**
   - _Swiss 911 Ultra Compressed (dollar values):_ **Six Caps** is the closest free match (extremely compressed grotesque); **Anton** or **Archivo Black/Condensed** for a slightly less extreme, more legible take; **League Gothic** (condensed axis) as a variable-width option.
   - _Swiss 911 Compressed (categories):_ **Oswald** (SemiBold/Bold) is the widely-used stand-in (confirmed in Jeopardy-recreation guides); **Fjalla One** and **Bebas Neue** are credible alternates (Bebas more "poster," Oswald closer to Helvetica Compressed's skeleton).
   - _ITC Korinna (clues):_ **no great Google Fonts match** — Korinna's rounded art-nouveau serifs are distinctive. Nearest usable open options: **Bitter** or **Roboto Slab** (slab warmth, reads well at distance), **Lora**/**PT Serif** as conventional serifs. Recommendation: don't chase Korinna; set clues in all-caps **Bitter Medium/SemiBold** with generous letter-spacing — evokes "TV clue card" without being a knockoff. (OPTIKorinna-Agency floats around free-font sites but its licensing provenance is murky — avoid.)
4. **Constrained palette, derived not defaulted.** 1 blue (plus 1–2 hand-tuned darker/lighter steps for depth), 1 gold, white, near-black. Editor gets a desaturated neutral ramp derived from the blue's hue. No Tailwind default colors anywhere.
5. **Real spacing rhythm.** Pick a scale (4px base, modular steps) and a distinct board grid rhythm — the Jeopardy board has _thick_ black gutters between cells (the grid lines are part of the trade dress). Use them.
6. **Texture/depth where the era demands it.** The TV board has subtle inner bevels, vignette lighting on cells, and a slight glow on the gold numerals. A faint radial gradient per cell + `text-shadow` on values gets 90% of it for near-zero cost. That physicality is exactly what flat AI-slop lacks.
7. **Motion as identity** (§4): the board fill-in stagger and the clue zoom are signature moves; generic fade-ins are not.

**Three art-direction options**

- **A. Faithful-retro TV look (recommended default):** `#060CE9`-family blue cells, thick near-black gutters, gold Six Caps/Anton dollar values with soft glow, Oswald all-caps white categories, all-caps serif clues on full-bleed blue, cell bevel/vignette; CRT-adjacent touches optional (very subtle scanline/bloom on projector surface only). Nostalgic, instantly legible, reads "crafted."
- **B. Modern flat reinterpretation:** keep the blue/gold ratio but shift blue toward a designed indigo-ink, remove bevels, single ultra-condensed variable font (League Gothic width axis) for everything, oversized numerals cropped by cell edges, hard 2px rules instead of gutters, kinetic type for reveals. Cleaner, more "design studio," less nostalgic.
- **C. Playful event-poster style:** for the club-night context — riso/screenprint energy: off-white paper background on non-board screens, blue+gold as overprinting ink colors with slight misregistration, chunky slab (Alfa Slab One display-only), stamped/sticker score chips. Most distinctive, most work, weakest "it's Jeopardy!" recognition. Good as a _theme_, not the base.

Build A as the default theme; make B/C achievable purely through the token layer.

## 3. Design tokens & theming

**Strategy: one `tokens.css` of CSS custom properties, consumed by Tailwind v4's `@theme inline` so utilities and bespoke CSS share the same variables.**

- **Two tiers:** primitive tokens (`--blue-700`, `--gold-400`, `--font-display`, `--space-3`) and semantic tokens (`--board-cell-bg`, `--board-value-color`, `--clue-bg`, `--buzzer-armed`, `--score-positive`). Components reference _only_ semantic tokens.
- **Per-event theming is then trivial:** a theme = a CSS file (or DB-stored JSON rendered to a `<style>` block) that overrides semantic tokens: `[data-theme="envlaw-night"] { --board-cell-bg: #0b3d2e; --board-value-color: #d9f99d; --font-display: "Archivo"; }`. Store theme JSON on the game record; the host picks a theme per event (Board Game Club × Environmental Law Society could get a green/parchment variant in minutes). Also token-ize the category-header treatment and an optional per-event logo slot.
- **Scale tokens for surfaces:** the board must be readable across a room. Define type scale in `clamp()`/viewport units on the board surface only (`--board-value-size: clamp(2.5rem, 6.5vh, 8rem)` style) so the same components work on a 720p projector and a 4K TV. Distance legibility rule: x-height ≥ ~1/200 of viewing distance; practically, dollar values ≥ 8% of screen height, clue text ≥ 5vh with max ~24 characters/line.
- **Projector/dark-mode considerations:** projectors crush dark detail and wash out saturation. Keep the board theme _dark by design_ (TV trade dress anyway), but provide a "projector boost" toggle: bump lightness/contrast of text tokens, thicken gutters, kill subtle textures (they band on cheap projectors), avoid pure-black-on-blue distinctions. Never rely on hue alone at distance — pair color with weight/size. The editor gets normal light/dark via the same semantic layer.

## 4. Animation & game feel

**Capabilities (2026):**

- **Svelte 5 built-ins remain the workhorse:** `transition:`/`in:`/`out:` directives, `animate:flip` for list reordering, and class-based `Tween`/`Spring` from [`svelte/motion`](https://svelte.dev/docs/svelte/svelte-motion) for interpolated values (score counters, timer bars). Compile to CSS/rAF; plenty for this project.
- **Motion (motion.dev)** still has no first-party Svelte adapter; community bridges exist but are **not needed** — pulling a community animation bridge adds risk for effects Svelte does natively.
- **View Transitions API:** SvelteKit's `onNavigate` + `document.startViewTransition` works, but as of mid-2026 remains effectively Chromium-only. Fine as progressive enhancement on host/editor; do **not** build the clue-reveal on it — in-app state changes aren't navigations anyway; use an element-level FLIP/scale transition you own.

**The moments that matter:**

| Moment                       | Technique                                                                                                                                          | Notes                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Board fill-in at round start | Staggered per-cell reveal: `in:` transition with `delay: i * 40ms`, randomized order like the show                                                 | Pure CSS transform/opacity; effortless at 30 cells         |
| Clue reveal (zoom from cell) | FLIP: measure cell rect, render full-screen clue layer, animate `transform` from cell rect to full screen (~15 lines with `getBoundingClientRect`) | The signature Jeopardy move. GPU-composited transform only |
| Buzz-in flash                | Instant class toggle + brief outline/podium light bar; on phone, full-screen background flash                                                      | Must be < 1 frame; no transition delay on the _on_ state   |
| Score changes                | `Tween` a displayed number, color-pulse via CSS `@keyframes`; `animate:flip` if standings reorder                                                  |                                                            |
| Daily Double splash          | Full-screen takeover: scale-in lockup + background pulse; optional pre-baked SVG starburst                                                         | One indulgent 1.5s animation is _correct_ game feel here   |
| Timer bars                   | CSS `transform: scaleX()` driven by a single start timestamp, or Web Animations API; **never** JS-per-frame width updates                          | Sync via server timestamp, render locally — immune to jank |

**Cheap-phone performance rules:** animate only `transform`/`opacity`; `will-change` sparingly on the buzzer button and flash layer; drive feedback from `pointerdown` not `click`; keep the buzzer page's JS tiny (no component library) so mid-range Androids stay responsive; test with 6x CPU throttle. Respect `prefers-reduced-motion` globally (§7).

## 5. Component-driven workflow

- **Storybook**: Svelte 5 support solid since 8.4; Storybook 10 (Nov 2025) is ESM-only and lighter. Works — but still the heaviest option; its payoff targets teams/design systems.
- **Histoire**: effectively stalled; not recommended for new projects in 2026.
- **Recommendation — a plain `/dev` routes gallery:** lightest thing that works and idiomatic SvelteKit: `src/routes/(dev)/gallery/…` pages rendering each component in its key states (board cell: hidden/available/revealed/daily-double; buzzer: locked/armed/pressed/won/lost; score chip: +/-), guarded by `if (!dev) error(404)`. Zero config, uses the app's real tokens/theme switcher, doubles as a visual theming test page per event theme, costs nothing in CI. Add Storybook later only if collaborators need isolated docs. Garnish: `vitest-browser-svelte` for interaction tests on the buzzer state machine, and a Playwright screenshot test over the gallery route for cheap visual regression.

> NOTE (orchestrator): magna-carta does use Storybook for visual regression per theme×mode; the `/dev` gallery + Playwright screenshots achieves the same goal lighter. Flagged in decisions.

## 6. Phone buzzer UX specifics

- **Giant touch target:** buzzer ≥ 60% of viewport height, single `<button>`; everything else peripheral. Bind on `pointerdown` (saves 10s of ms vs `click`, matters competitively).
- **Kill browser gesture interference:**
  - `touch-action: manipulation` (or `none` on the button) — removes double-tap-zoom delay.
  - `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none` — no selection/long-press callout.
  - `-webkit-tap-highlight-color: transparent`.
  - Pull-to-refresh: `overscroll-behavior-y: none` works on Chrome/Android; **iOS Safari still doesn't support it for pull-to-refresh** — so make the buzzer page a fixed-position, non-scrolling layout (`position: fixed; inset: 0; overflow: hidden`), which sidesteps rubber-banding entirely. Set `viewport-fit=cover` + safe-area insets. Don't set `maximum-scale=1` (hurts a11y, unnecessary if `touch-action` is right).
  - Suggest "Add to Home Screen"/standalone display-mode for chrome-free experience, but don't require it.
- **Haptics:** `navigator.vibrate()` works on Android Chrome — use it (30–50ms pulse on buzz, distinct pattern on lockout). **iOS: no Vibration API**; the Safari `switch`-checkbox haptic hack was patched out (~iOS 26.5) — treat iOS haptics as unavailable, rely on visual+audio feedback. Feature-detect, never UA-sniff.
- **Wake Lock:** `navigator.wakeLock.request('screen')` supported across all modern browsers incl. iOS Safari 16.4+ (>94% global support). Request on join, re-request on `visibilitychange` (locks release when the tab hides).
- **Latency masking:** on `pointerdown`, _instantly_ flash the pressed state, play local click/haptic, optimistically show "Buzzed!" while the WebSocket round-trip resolves; server verdict transitions to "You're up!" (podium glow) or "Too late/locked out" (distinct color + countdown). Never wait for the server to acknowledge visually. Show lockout state (early-buzz penalty) unambiguously — it's core mechanics.
- **Orientation:** portrait-first; handle landscape gracefully with the same fixed layout. `screen.orientation.lock()` only works fullscreen on Android and not at all on iOS Safari — don't depend on it.

## 7. Accessibility

- **Contrast on the blue board:** white on `#060CE9` ≈ 9.4:1 (AAA); classic gold `#FFCC00` on that blue ≈ 6.2:1 (AA, and values are huge text anyway). Avoid mid-tone golds (`#D7A54A`-ish drops near 4:1) for small text; gold for giant numerals, white for anything small. Validate per-event theme tokens with an automated contrast check in the editor's theme UI (flag pairs below 4.5:1 / 3:1 large-text).
- **Reduced motion:** wrap signature animations in `@media (prefers-reduced-motion: reduce)` — board fill-in becomes instant, clue zoom becomes a fade, DD splash becomes a static card, timer bar remains (information, not decoration). Gate JS-driven transitions on Svelte's `prefersReducedMotion` helper from `svelte/motion`.
- **Screen-reader basics for the editor:** falls out nearly free from shadcn-svelte/Bits UI. Add: proper `<label>`s on every clue field, `aria-live="polite"` for save/validation status, visible focus rings, logical heading structure, arrow-key cell navigation in the board grid.
- **Player view:** announce state changes (`aria-live="assertive"` for "You're locked out"/"You're up"), don't convey buzz state by color alone (pair with text/icon), honor OS font scaling (`rem`, never disable zoom).
- The projector board is effectively a broadcast surface — its a11y story is the _host reading clues aloud_ plus high contrast/large type, which the art direction already delivers.

---

## Recommended UI approach

**Tooling:**

- Tailwind CSS v4 as the shared utility + token layer (CSS-first `@theme` bound to hand-written custom properties in a single `tokens.css`) — pending the owner's CSS-philosophy decision (see 04-style-guide.md divergences).
- **Editor/host panel:** shadcn-svelte (Svelte 5-native, vendored source, Bits UI underneath) rethemed with project tokens.
- **Game board & buzzer:** fully custom Svelte 5 components, vanilla CSS + tokens; no component library, no animation library. View Transitions API only as progressive enhancement.
- **Workflow:** `/dev` gallery routes (dev-guarded) instead of Storybook/Histoire; optional Playwright screenshots of the gallery for visual regression.

**Art direction:** Option A, "faithful-retro TV look," implemented entirely through semantic tokens so B and per-event themes (e.g., an environmental green/gold variant for the first event) are pure token overrides. Type: **Anton or Six Caps** (dollar values), **Oswald Bold** all-caps (categories), **Bitter SemiBold** all-caps (clues) — all open-license, self-hosted. Palette: `#060CE9`-family blue, one tuned gold, white, near-black gutters; zero Tailwind default colors; subtle cell vignette/bevel + gold glow; signature motion = randomized board fill-in stagger + FLIP clue zoom.

**Build order for UI foundations:**

1. **Tokens:** `tokens.css` (primitive + semantic tiers), theme-override mechanism (`data-theme` + per-event JSON), fonts self-hosted with `font-display: swap`, reduced-motion and projector-boost hooks.
2. **Primitives:** board cell, category header, clue full-screen layer (FLIP zoom), score chip/Tween counter, timer bar, buzzer button (pointerdown state machine + feedback states), Daily Double splash, plus the `/dev` gallery rendering every state.
3. **Surfaces:** board screen (grid + reveal choreography, projector boost), buzzer page (fixed non-scrolling layout, wake lock, gesture suppression, optimistic buzz feedback), then editor/host panel on shadcn-svelte (retheme pass first so nothing ships in stock shadcn look).

Sources: [shadcn-svelte migration docs](https://shadcn-svelte.com/docs/migration/svelte-5) · [shadcn-svelte Tailwind v4](https://shadcn-svelte.com/docs/migration/tailwind-v4) · [Bits UI](https://www.bits-ui.com/) · [Melt UI](https://www.melt-ui.com/) · [Headless Svelte libs 2025](https://www.ytyng.com/en/blog/svelte-headless-ui-library-2025) · [shadcn-svelte vs daisyUI vs Skeleton (2026)](https://sveltestarters.com/blog/shadcn-svelte-vs-daisyui-vs-skeleton/) · [Skeleton Tailwind v4 RFC](https://github.com/skeletonlabs/skeleton/discussions/3192) · [Fonts In Use: Jeopardy!](https://fontsinuse.com/uses/5507/jeopardy-game-show) · [designyourway Jeopardy fonts](https://www.designyourway.net/blog/what-font-does-jeopardy-use/) · [ITC Korinna similar fonts](https://typetype.org/fonts/itc-korinna-similar-fonts/) · [famfonts Jeopardy/Gyparody](https://famfonts.com/jeopardy/) · [Storybook Svelte 5 issue](https://github.com/storybookjs/storybook/issues/25178) · [svelte/motion docs](https://svelte.dev/docs/svelte/svelte-motion) · [SvelteKit view transitions](https://svelte.dev/blog/view-transitions) · [caniuse wake-lock](https://caniuse.com/wake-lock) · [web.dev wake lock](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers) · [ios-haptics](https://github.com/tijnjh/ios-haptics) · [overscroll-behavior](https://css-tricks.com/almanac/properties/o/overscroll-behavior/)
