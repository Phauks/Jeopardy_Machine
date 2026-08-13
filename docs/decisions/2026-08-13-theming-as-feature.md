# 2026-08-13 - Theming is the feature, not a decision

## Context
The "Three Boards" artifact pitched three art directions (A faithful-retro TV, B modern flat, C event-poster) expecting the owner to pick a base. The owner's verdict: all three look good, and **the game screen should be highly customizable** - hosts choose fonts, colors, and background.

## Decision
There is no single winning art direction. Instead:

1. **All three directions ship as built-in theme presets** (`retro-tv`, `modern-flat`, `event-poster`), plus the Terra Verde event variant. Building three real presets on one token contract is also the proof that the theming system covers genuine visual range - not just hue swaps.
2. **The theme document becomes a portable artifact** in `packages/protocol` (M1), alongside content packs and game definitions:
   - **Token values**: board/cell/category backgrounds (solid or gradient), value color, clue text color, accent, used-cell treatment.
   - **Font slots**: display / money values / clue text / UI chrome, each chosen from a **curated, self-hosted, OFL-licensed set** (starting set: Anton, Oswald, Bitter, Six Caps, Alfa Slab One; grow to ~10-12 faces). Curated-only keeps licensing clean, bundles small, and quality floors high - arbitrary font upload is explicitly out of scope for now.
   - **Background spec**: solid / gradient / tiled pattern / uploaded image (R2, with automatic dim-overlay slider so clue text stays readable).
   - **Effects level**: `flat` vs `dimensional` (bevels, glows, vignettes) - this is the real structural difference between directions A and B.
3. **Guardrails**: the customizer computes WCAG contrast for clue-text-on-cell and value-on-cell combinations and warns (not blocks); projector-boost mode remains a separate runtime override that flattens any theme toward maximum legibility.
4. **Phasing**: M4 ships the token mechanism + presets (enough for the club night, which uses a preset). M7 ships the visual customizer UI (owner priority - may be pulled earlier). Per-player cosmetics (buzzer sounds, avatars/colors) remain the separate cosmetics module.

## Why this is strategically right
Competitors paywall theming (JeopardyLabs customization is a paid feature). "Your game night, your look" - free - is a differentiator, and it lands exactly on the owner's stated pillars: modularity (theme = document over a token contract, zero game-logic coupling) and personalization as a feature pillar.
