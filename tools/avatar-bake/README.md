# @jeopardy/avatar-bake

The avatar asset pipeline: takes Kenney's **Cube Pets** (15 animals) and **Mini Characters** (12 humans) packs - one visual universe, CC0 - and produces the three representations the product uses, each for a different surface (docs/decisions/2026-08-14-avatars-in-motion.md):

| Output            | Where it lands                                                         | Who renders it                                      |
| ----------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| **Still sprites** | `apps/web/static/avatars/{avatar}--{accent}.webp` (216)                | Every chip: roster rows, score strips, the picker   |
| **Walk sheets**   | `apps/web/static/avatars/{avatar}--walk.webp` (27)                     | The join preview and the lobby "you're in" card     |
| **Models**        | `apps/web/static/avatars/models/*.glb` + colormaps (30)                | The display diorama, and nothing else               |
| **Manifests**     | `apps/web/src/lib/avatars/avatar-manifest.json` + `avatar-models.json` | Typed access via the two loader modules beside them |

This package is tooling, not shipped code: plain Node scripts driving three.js in headless Chromium via playwright. It has no build/test/check scripts, so recursive workspace commands skip it.

## Re-baking

```sh
pnpm -F @jeopardy/avatar-bake download   # fetch + sha256-verify + unzip both packs (gitignored)
pnpm -F @jeopardy/avatar-bake bake       # sprites + sheets + models + both manifests
```

`bake` needs a Chromium: it uses playwright's managed browser (`npx playwright install chromium` once), or set `AVATAR_BAKE_BROWSER=/path/to/chromium` to use a system one (sandboxes: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Rendering is software-GL (swiftshader), no GPU needed. `download` needs `unzip` on PATH. A full run is about 30 seconds.

Commit the resulting asset + manifest changes together with whatever prompted the re-bake.

### Determinism

Re-baking without a real change produces **byte-identical files** on the same Chromium build, and that is checked by re-running rather than assumed - the 2026-08-14 pass that added sheets and models left all 216 committed stills untouched, which is what proved the shared-recolor refactor had not shifted a pixel. The properties that make it hold:

- Pinned pack zips (`src/packs.mjs`, url + sha256), so every run starts from the same bytes.
- Committed recolor targets and clip roles (`src/roster.mjs`) - explicit hexes, never recomputed at bake time.
- A fixed render recipe (`src/render-page.html`): fixed camera, fixed lights, framing computed once per subject, animation sampled by absolute time (`mixer.setTime`) rather than accumulated deltas.
- Model trimming that is structural only (`src/glb-repack.mjs`): nothing re-encoded, quantized, or resampled; output layout is a pure function of the input; the generator string carries no timestamp.
- Stable filenames, stable key order, stale-file sweeps on every run.

A different Chromium or three.js version may shift pixels harmlessly, which shows up honestly as a large-but-visually-identical diff.

**When to re-bake:**

- **Adding/changing a player accent** - edit `src/accent-palette.mjs` (THE single definition of the player-accent palette; the manifest copies it, shipped code reads only the manifest).
- **Adding a theme preset whose `accentColor` is new** - the bake fails until the palette contains every preset accent from `apps/web/src/lib/theme/theme-presets.ts` (exact-hex coverage check in `bake.mjs`).
- **Changing the roster** - avatars, display names, recolor targets, or clip roles in `src/roster.mjs`.
- **A pack update on kenney.nl** - new versioned zip URL + sha256 in `src/packs.mjs` (re-verify its `License.txt` still says CC0), then re-curate recolor targets with `pnpm -F @jeopardy/avatar-bake analyze`.

## How it works

- `src/packs.mjs` - pack URLs + pinned sha256 + in-pack paths. kenney.nl asset pages embed these direct, versioned `media/pages/assets/...zip` URLs in their HTML.
- `src/accent-palette.mjs` - the 8-color player-accent palette (must contain all theme preset accents; trade-offs documented inline).
- `src/roster.mjs` - the 27 avatars: id, kind (`pet`/`human`), display name, per-avatar `recolorTargets`, and the **clip roles** (`idle` / `walk` / `celebrate`) mapped to each pack's own animation names. Shipped code names roles, never Kenney clip names. `female-a` composites the pack's wheelchair model and uses its wheelchair locomotion; she and glasses-wearing `male-a` are the pack's integrated-mobility-aid/assistive-device characters, included on purpose.
- `src/render-page.html` - the browser side: proof lighting (ambient + key/fill/rim), fixed 3/4 hero camera, idle-pose sampling at 5% clip duration for the skinned humans, and both render modes.
- `src/glb-repack.mjs` - the model trimmer (below).
- `src/bake.mjs` - the Node side: preset-accent coverage check, static file server, model shipping, playwright drive, asset + manifest writes, stale sweeps, and a hard failure if any tier exceeds its budget.

`pnpm -F @jeopardy/avatar-bake analyze` renders every avatar in original colors into `analysis/` (gitignored) plus `analysis.json` with each model's UV-area-weighted dominant colormap cells - the data you curate `recolorTargets` from.

### The shared recolor

There is exactly ONE implementation of "tint an avatar to a player accent", and it lives in the app: `apps/web/src/lib/avatars/palette-recolor.ts`. The bake's HTTP server serves that very file to the render page at `/shared/palette-recolor.js`, with its type annotations erased by node's `stripTypeScriptTypes`. The display's diorama imports the same module directly. No copy, no port, no drift - a baked sprite and a live model cannot disagree about color, because they run the same function over the same committed targets.

It is pure and DOM-free (it takes RGBA bytes and mutates them), which is what lets it be unit tested in node and loaded in a browser page at once.

### Sheet mode

For each avatar, the walk clip is rendered as a **horizontal filmstrip**: `SHEET_FRAMES` square frames, left to right, in one webp. Phones animate it with a stepped CSS transform and no JavaScript at all (`apps/web/src/lib/avatars/avatar-animated.svelte`).

- **10 frames.** The Kenney walk cycles are ~0.75-1.0 s loops, so 10 frames is about 12 fps of cycle: past the ~8-frame floor where a walk reads as a stutter, short of the 12-16 where extra bytes buy nothing visible at 96-140 px. Frames are sampled at `t = i/10 * duration`, so frame 10 would be frame 0 - the loop is seamless with no duplicate frame in the strip.
- **Same camera and lighting as the stills**, structurally: both modes call the same `stageModel` + renderer, so the recipe cannot drift. Framing is computed ONCE from the clip's first frame and reused for every frame; a per-frame bounding box would breathe the subject in and out as limbs swing.
- **Rendered from the SHIPPED models**, not the raw pack files - a botched repack shows up here as a broken walk cycle during the bake instead of on a projector.
- **No walk clip -> idle fallback**, and the manifest records which clip actually got rendered so the substitution is visible rather than silent.
- **One sheet per avatar, in the pack's own colors** - not one per accent, per the decision doc. Both were baked and weighed:

  | Option                                   | Files | Committed                                                      |
  | ---------------------------------------- | ----- | -------------------------------------------------------------- |
  | Accent-neutral, 10 frames @ 128px, q0.82 | 27    | 568 KB (shipped)                                               |
  | Per-accent, 10 frames @ 128px, q0.82     | 216   | 4648 KB                                                        |
  | Per-accent, 8 frames @ 112px, q0.72      | 216   | ~2370 KB, and visibly soft at the 120px the join preview shows |

  Per-accent only fits a sane budget by degrading the one surface whose entire job is looking good. The accent is carried by the backing chip instead - the same split the 24px chip has always used. The visible consequence, worth knowing before someone files it as a bug: on the join screen the natural-colored preview sits above an accent-tinted picker grid, so the same avatar appears in two colors at once. Flipping the choice is one constant in `bake.mjs` plus a re-bake.

### Model shipping and the GLB repack

The 27 GLBs (plus the wheelchair prop and each pack's shared colormap PNG) are committed so the display can build a live scene. Kenney's source files are generous - every character carries 32 animation clips, and every mesh carries `TANGENT` + `TEXCOORD_1` that nothing in our render path reads (one texture, on texCoord 0, no normal map). Raw, the set is **4.97 MB**.

`src/glb-repack.mjs` trims each one to the three clips its roles name and drops the unread attributes, then rebuilds the accessor and bufferView tables around only what survives - which collapses the glTF JSON chunk too (105 KB of a 263 KB character was bufferView bookkeeping). Result: **2.33 MB**, structural only, byte-identical on re-run. Both drops are guarded: a UV set is only removed when no material samples it, and a normal map anywhere fails the repack rather than shipping an untextured avatar.

Each model's texture URI is rewritten to its pack's flat colormap filename, so the shipped GLBs stay correct in any glTF viewer and the diorama recolors by replacing the texture image rather than reconstructing material state.

## Size budget

Enforced by `bake.mjs` (fails the run) and re-checked against the files on disk by `apps/web/src/lib/avatars/avatar-manifest.gate.test.ts`:

| Tier   | Current | Budget |
| ------ | ------- | ------ |
| Stills | 931 KB  | 2 MB   |
| Sheets | 568 KB  | 1 MB   |
| Models | 2326 KB | 3 MB   |

Only the models tier is ever fetched by more than the display, and it is fetched by nothing else at all.

## Licensing

Both packs are CC0 1.0, verified against each zip's `License.txt` by `download` on every run. Provenance and the shipped-derivative story: `apps/web/static/avatars/LICENSES.md`.
