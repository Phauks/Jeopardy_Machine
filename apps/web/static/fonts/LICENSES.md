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

**The app's own face, which is not a theme slot** (added 2026-08-20):

| File                                              | Family                     | Weight             | Designer / Foundry                       | License | Source                                                         |
| ------------------------------------------------- | -------------------------- | ------------------ | ---------------------------------------- | ------- | -------------------------------------------------------------- |
| `atkinson-hyperlegible-next-latin-variable.woff2` | Atkinson Hyperlegible Next | 400-700 (variable) | Applied Design Works / Braille Institute | OFL 1.1 | <https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next> |

This one is bound to `--font-legible` rather than to a `fontSlot`, and no theme can override it: it renders the strings a person has to TRANSCRIBE - the room code on the front door, the console's join panel and the display, plus the field they type it into. It is a **variable** build covering 400-700 in one file (Google serves the identical URL for its 400 and 700 declarations), which is why `fonts.css` declares a weight range and there is no second file. At 34 KB it is the largest file here.

Growth path: the theme document's `fontFace` enum (docs/proposals/m1-protocol.md section 5) grows toward ~10-12 faces; each addition lands here (file + license row) and in `fonts.css` in the same commit as the enum bump.
