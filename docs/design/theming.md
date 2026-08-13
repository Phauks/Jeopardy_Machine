# Theming: the token contract

> 2026-08-13 · M4 phase 1 (pulled forward by owner approval). This is the reference the M7 visual customizer implements against.
> Decision: docs/decisions/2026-08-13-theming-as-feature.md. Document schema: docs/proposals/m1-protocol.md §5. Live proof: the `/dev/theme` gallery route.

## The model in one paragraph

A theme is a **document**, never a code path (docs/design/expansion-and-boundaries.md). The document's fields map to a fixed set of **semantic CSS custom properties** - the token contract - declared once in `apps/web/src/lib/theme/tokens.css` and rendered from a theme by exactly one function, `themeToTokens()` in `apps/web/src/lib/theme/theme-to-css.ts`. Components consume only semantic tokens; they never reference raw colors, preset names, or effects levels. Applying a theme = setting the token record on a subtree (inline `style` attribute today, a generated `<style>` block for the display surface later) plus a `data-effects` attribute. Switching themes live is therefore a style-attribute swap - which is exactly what the gallery's preset switcher does and why it proves the contract.

## The token contract

Every token below is declared with a retro-tv default in `tokens.css` (so unthemed fragments fail soft into the house look) and emitted for every theme by `themeToTokens()` (gated by `theme-contract.gate.test.ts`: a preset that misses one token fails CI).

### Theme document tokens

| Token                       | Document field                   | Role - which surfaces consume it                                                                                                                                               |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--page-bg`                 | `body.background`                | Full-bleed page fill behind and around the board; title/lobby/interstitial screens. Solid or gradient today; pattern/image kinds land with the M7 customizer + media pipeline. |
| `--board-bg`                | `body.tokens.boardBackground`    | The board's own background - and therefore the **gutter color**: gutters are the board background showing through the grid's gaps. Thick gutters are trade dress.              |
| `--board-cell-bg`           | `body.tokens.cellBackground`     | Value-cell fill. Also the clue card's fill (the clue is a cell blown up to full screen - one fewer field for the customizer, faithful to the show).                            |
| `--board-category-bg`       | `body.tokens.categoryBackground` | Category header cell fill.                                                                                                                                                     |
| `--board-value-color`       | `body.tokens.valueColor`         | Dollar/point numeral color; the dimensional glow tints itself from it.                                                                                                         |
| `--clue-text-color`         | `body.tokens.clueTextColor`      | Clue text on the clue card; category text; the color chrome text derives from.                                                                                                 |
| `--accent`                  | `body.tokens.accentColor`        | Interactive/emphasis color everywhere: buzzer-armed state (M4 phase 2), focus rings, selected chips, used-cell outline treatment.                                              |
| `--board-cell-used-bg`      | derived: `usedCellTreatment`     | Used (played) cell fill. The enum maps to three tokens - see below.                                                                                                            |
| `--board-cell-used-outline` | derived: `usedCellTreatment`     | `box-shadow` value for the `outline` treatment (`none` otherwise).                                                                                                             |
| `--board-cell-used-opacity` | derived: `usedCellTreatment`     | Whole-cell opacity for the `dimmed` treatment (`1` otherwise).                                                                                                                 |
| `--font-display`            | `body.fontSlots.display`         | Wordmark/title moments: game title card, Daily Double splash, winner screen.                                                                                                   |
| `--font-values`             | `body.fontSlots.values`          | Board numerals and score readouts.                                                                                                                                             |
| `--font-clue`               | `body.fontSlots.clue`            | Clue text (all-caps serif is the TV register; the face is the theme's choice).                                                                                                 |
| `--font-chrome`             | `body.fontSlots.chrome`          | Category headers and all UI chrome (buttons, labels, rosters).                                                                                                                 |

`usedCellTreatment` mapping (in `theme-to-css.ts`): `blank-dark` -> cell base color mixed 26% into black, no outline, opacity 1 · `dimmed` -> normal cell fill at opacity 0.3 · `outline` -> transparent fill with a 2px inset accent-tinted ring.

Font slots carry **family stacks** (curated face first, metric-adjacent system fallback behind `font-display: swap`), never bare face ids. Faces: `apps/web/src/lib/theme/fonts.css`, licensing `apps/web/static/fonts/LICENSES.md`.

### Derived chrome surfaces (app-computed, not document fields)

The M7 customizer exposes only document fields; chrome follows automatically. `themeToTokens()` derives these from `background` + `clueTextColor` via `color-mix`, so one formula restyles chrome for dark (retro-tv) and light (event-poster) themes alike:

| Token                  | Derivation                      | Role                                                                                                                                   |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--surface-page`       | background fill's base color    | Chrome page background. Always a plain color (Tailwind reflects it into `background-color`); gradient-capable screens use `--page-bg`. |
| `--surface-raised`     | page base mixed 10% toward text | Cards, panels, docks - lightens dark themes, darkens light ones.                                                                       |
| `--surface-text`       | `clueTextColor`                 | Chrome body text.                                                                                                                      |
| `--surface-text-muted` | text at 62% alpha               | Secondary text.                                                                                                                        |
| `--surface-border`     | text at 20% alpha               | Hairlines, input borders.                                                                                                              |
| `--surface-scrim`      | constant `rgb(0 0 0 / 0.55)`    | Overlay backdrop (clue layer, dialogs).                                                                                                |

### Effects tokens (the flat/dimensional switch)

`body.effectsLevel` maps to a **`data-effects="flat|dimensional"` attribute** on the themed subtree, not to a custom property and _never_ to per-preset CSS forks. `tokens.css` derives the effect tokens under `[data-effects="..."]` selectors from the _active theme's color tokens_ (e.g. the value glow tints from `var(--board-value-color)`), so every theme - including every future custom document - gets both levels for free. Components consume only:

| Token                           | flat   | dimensional                                                    |
| ------------------------------- | ------ | -------------------------------------------------------------- |
| `--effect-cell-overlay`         | `none` | radial hotspot + vertical falloff background layers (vignette) |
| `--effect-cell-shadow`          | `none` | inset bevel (light top edge, dark lower inset, inner shade)    |
| `--effect-value-glow`           | `none` | value-color-tinted text glow + drop shadow                     |
| `--effect-category-text-shadow` | `none` | small dark text shadow                                         |
| `--effect-clue-card-shadow`     | `none` | deep drop + inner vignette on the clue card                    |

Layering rule for consumers: `background: var(--effect-cell-overlay), var(--board-cell-bg);` - the overlay is always a valid (possibly `none`) image-layer list and the theme fill is always a valid final layer, whether solid or gradient.

### App layout constants (in `tokens.css`, deliberately not themeable)

`--board-gutter` (clamped viewport-relative gutter width - the thickness is trade dress, the color is `--board-bg`), `--board-radius`, and the board type scale (`--board-category-size`, `--board-value-size`, `--clue-text-size` - `clamp()` against viewport height per the distance-legibility rules in docs/research/05-ui-design.md §3). Projector-boost mode (a runtime legibility override, not a theme) will adjust these plus text tokens when it lands.

## How presets work

`apps/web/src/lib/theme/theme-presets.ts` holds the four built-ins as theme-document-shaped objects: `retro-tv` (dimensional), `modern-flat` (flat), `event-poster` (flat, light/paper), and `terra-verde` - authored as a literal spread-override of retro-tv, which is the pattern the customizer will produce ("theme = small diff over a base"). When M1's `theme` schema lands in packages/protocol, these objects become validated documents and the local types in that file are replaced by protocol imports; field names are already identical to §5 to make that swap mechanical.

**Divergences from the §5 schema, and why** (also recorded in the tokens.css SYNC BLOCK - if code and these notes disagree, that is a bug):

1. `background` pattern/image kinds are typed out for now - rendering them needs the pattern library and the R2 media pipeline (M7/M1 respectively). Solid + gradient cover all four built-ins.
2. `soundSet` has no CSS mapping (audio, ships with the cosmetics/audio work).
3. `meta`/document envelope fields are absent until M1 provides the real envelope; presets carry only `id` + `label`.
4. There is no `clueBackground` field or token: the clue card reuses `--board-cell-bg` by design (see table). If a future theme needs them to differ, that is a schema addition (minor bump), not a CSS hack.

## Applying a theme (and adding a preset)

Apply: `style={themeToStyleAttribute(preset)}` + `data-effects={preset.effectsLevel}` on the subtree root (the `/dev/theme` gallery does exactly this; the M5 display surface will do the same at the page root). Everything inside re-themes instantly - custom properties cascade, `var()` in effect tokens resolves against the surrounding theme scope.

Add a preset: add the object to `theme-presets.ts` and to `themePresets`; the contract gate then enforces token completeness automatically. Add it to the settings preset enum (docs/proposals/m1-protocol.md §3) in the same change. No CSS edits - if a new preset seems to need component CSS, the contract is missing a token and _that_ is the change to make (token + serializer + gate + this doc, same commit).

Contrast guardrails (WCAG warn-not-block on clue-text/cell and value/cell pairs) are the M7 customizer's job per the decision; presets are hand-checked today (gold-on-blue and white-on-blue pairs clear AA large-text comfortably in all four).
