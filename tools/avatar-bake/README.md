# @jeopardy/avatar-bake

The avatar sprite pipeline: renders every avatar in Kenney's **Cube Pets** (15 animals) and **Mini Characters** (12 humans) packs - one visual universe, CC0 - to accent-recolored webp sprites, committed under `apps/web/static/avatars/` together with the generated manifest `apps/web/src/lib/avatars/avatar-manifest.json`. Phones only ever see these sprites; live 3D is a display-device concern for later milestones (docs/research/00-user-directives.md, avatar sections).

This package is tooling, not shipped code: plain Node scripts driving three.js in headless Chromium via playwright. It has no build/test/check scripts, so recursive workspace commands skip it.

## Re-baking

```sh
pnpm -F @jeopardy/avatar-bake download   # fetch + sha256-verify + unzip both packs (gitignored)
pnpm -F @jeopardy/avatar-bake bake       # render 27 avatars x 8 accents -> sprites + manifest
```

`bake` needs a Chromium: it uses playwright's managed browser (`npx playwright install chromium` once), or set `AVATAR_BAKE_BROWSER=/path/to/chromium` to use a system one (sandboxes: `/opt/pw-browsers/chromium`). Rendering is software-GL (swiftshader), no GPU needed. `download` needs `unzip` on PATH.

Commit the resulting sprite + manifest changes together with whatever prompted the re-bake. The output is deterministic (pinned pack zips, committed recolor targets, fixed render recipe, stable filenames, no timestamps) - re-baking without a real change produces byte-identical files on the same Chromium build; a different Chromium/three.js version may shift pixels harmlessly, which shows up honestly as a large-but-visually-identical diff.

**When to re-bake:**

- **Adding/changing a player accent** - edit `src/accent-palette.mjs` (THE single definition of the player-accent palette; the manifest copies it, shipped code reads only the manifest).
- **Adding a theme preset whose `accentColor` is new** - the bake fails until the palette contains every preset accent from `apps/web/src/lib/theme/theme-presets.ts` (exact-hex coverage check in `bake.mjs`), so a new preset accent = palette addition = re-bake.
- **Changing the roster** - avatars, display names, or recolor targets in `src/roster.mjs`.
- **A pack update on kenney.nl** - new versioned zip URL + sha256 in `src/packs.mjs` (re-verify the zip's `License.txt` still says CC0), then re-curate recolor targets with `pnpm -F @jeopardy/avatar-bake analyze` (below).

## How it works

- `src/packs.mjs` - pack URLs + pinned sha256 + in-pack paths. kenney.nl asset pages embed these direct, versioned `media/pages/assets/...zip` URLs in their HTML.
- `src/accent-palette.mjs` - the 8-color player-accent palette (must contain all theme preset accents; trade-offs documented inline).
- `src/roster.mjs` - the 27 avatars: id, kind (`pet`/`human`), display name, and per-avatar `recolorTargets` (colormap cells the accent replaces - pets recolor their body, humans a signature garment so skin/hair/faces never change). `female-a` composites the pack's wheelchair model; she and glasses-wearing `male-a` are the pack's integrated-mobility-aid/assistive-device characters, included on purpose.
- `src/render-page.html` - the browser side: proof lighting (ambient + key/fill/rim), fixed 3/4 hero camera, idle-pose sampling at 5% clip duration for the skinned humans (bind pose is arms-out; mid-clip catches gestures), palette recolor with per-pixel luminance preservation, 2x supersampled render downscaled to 192px, webp at quality 0.85.
- `src/bake.mjs` - the Node side: preset-accent coverage check, static file server, playwright drive, sprite + manifest write, stale-sprite sweep, and a hard failure if the sprite set exceeds its 2 MB budget (current: ~0.9 MB for 216 sprites).

`pnpm -F @jeopardy/avatar-bake analyze` renders every avatar in original colors into `analysis/` (gitignored) plus `analysis.json` with each model's UV-area-weighted dominant colormap cells - the data you curate `recolorTargets` from.

## Licensing

Both packs are CC0 1.0, verified against each zip's `License.txt` by `download` on every run. Provenance and the shipped-derivative story: `apps/web/static/avatars/LICENSES.md`.
