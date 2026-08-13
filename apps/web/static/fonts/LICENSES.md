# Self-hosted fonts

The curated, self-hosted font set for theme font slots (docs/decisions/2026-08-13-theming-as-feature.md: curated-only keeps licensing clean, bundles small, and quality floors high; arbitrary font upload is out of scope). Every face is licensed under the SIL Open Font License 1.1 (<https://openfontlicense.org>), which permits bundling, self-hosting, and redistribution with attribution.

Files are the **latin-subset woff2** builds served by the Google Fonts css2 API (fetched 2026-08-13 with a Chrome user agent, which negotiates woff2 + unicode-range subsets). Each file's `unicode-range` is declared in `apps/web/src/lib/theme/fonts.css`; if a face ever needs more coverage (latin-ext, cyrillic), download the additional subset files and add matching `@font-face` blocks - never swap a subset file for a full build silently, the byte-size budget is part of the design.

| File                            | Family        | Weight | Designer / Foundry                  | License | Source                                            |
| ------------------------------- | ------------- | ------ | ----------------------------------- | ------- | ------------------------------------------------- |
| `anton-latin-400.woff2`         | Anton         | 400    | Vernon Adams                        | OFL 1.1 | <https://fonts.google.com/specimen/Anton>         |
| `oswald-latin-600.woff2`        | Oswald        | 600    | Vernon Adams, Kalapi Gajjar, Cyreal | OFL 1.1 | <https://fonts.google.com/specimen/Oswald>        |
| `bitter-latin-600.woff2`        | Bitter        | 600    | Sol Matas / Huerta Tipografica      | OFL 1.1 | <https://fonts.google.com/specimen/Bitter>        |
| `six-caps-latin-400.woff2`      | Six Caps      | 400    | Vernon Adams                        | OFL 1.1 | <https://fonts.google.com/specimen/Six+Caps>      |
| `alfa-slab-one-latin-400.woff2` | Alfa Slab One | 400    | JM Sole                             | OFL 1.1 | <https://fonts.google.com/specimen/Alfa+Slab+One> |

Growth path: the theme document's `fontFace` enum (docs/proposals/m1-protocol.md section 5) grows toward ~10-12 faces; each addition lands here (file + license row) and in `fonts.css` in the same commit as the enum bump.
