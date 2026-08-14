# Avatar assets

Everything under this directory comes from two Kenney 3D packs, through the repo-committed pipeline in `tools/avatar-bake/` (how to re-bake, and when: its README). Three tiers, three surfaces (docs/decisions/2026-08-14-avatars-in-motion.md):

| Files                                   | What                                                                                       | Index                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| `{avatarId}--{accentId}.webp`           | Still sprites, 192px, transparent, fixed 3/4 hero angle, recolored per player accent (216) | `src/lib/avatars/avatar-manifest.json` |
| `{avatarId}--walk.webp`                 | Walk-cycle filmstrips, 10 frames of 128px, the pack's own colors (27)                      | same manifest, `sheet` field           |
| `models/*.glb`, `models/*-colormap.png` | The source models themselves, trimmed (see below), plus each pack's shared palette texture | `src/lib/avatars/avatar-models.json`   |

Both source packs are **CC0 1.0** (Creative Commons Zero - no attribution required; we credit Kenney anyway, as the pack readmes invite). License verified on the `License.txt` inside each downloaded zip, not on marketing pages; the download script re-verifies the CC0 line and a pinned sha256 of each zip on every fetch.

| Source pack            | Version | Author                       | License | Verified                                                              | Source                                     |
| ---------------------- | ------- | ---------------------------- | ------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Kenney Cube Pets       | 1.0     | Kenney (<https://kenney.nl>) | CC0 1.0 | zip `License.txt`, sha256 pinned in `tools/avatar-bake/src/packs.mjs` | <https://kenney.nl/assets/cube-pets>       |
| Kenney Mini Characters | 1.0     | Kenney (<https://kenney.nl>) | CC0 1.0 | zip `License.txt`, sha256 pinned in `tools/avatar-bake/src/packs.mjs` | <https://kenney.nl/assets/mini-characters> |

## What is committed, and how it differs from the source

The raw pack downloads are **not** committed - `tools/avatar-bake/downloads/` is gitignored. What ships is:

**Sprites and sheets** - rendered derivatives. The recolor step edits only palette cells of each pack's shared colormap texture (a player-accent garment/body tint); everything else is Kenney's art as shipped.

**Models** (`models/`) - the pack GLBs themselves, structurally trimmed by `tools/avatar-bake/src/glb-repack.mjs` and otherwise untouched. Every avatar's model is the Kenney mesh, skeleton, materials, and animation data byte-for-byte; the trim removes animation clips the product never plays and two vertex attributes nothing in the render path reads (`TANGENT`, `TEXCOORD_1`), then re-packs the buffer. Nothing is re-encoded, quantized, or resampled. One edit is made to the glTF JSON: each model's texture URI is repointed from the pack-relative `Textures/colormap.png` to its pack's flat filename here (`cube-pets-colormap.png` / `mini-characters-colormap.png`), because both packs share this one directory. The two colormap PNGs are Kenney's originals, unmodified.

| Committed model files                    | Source pack            | Source path in the zip                    |
| ---------------------------------------- | ---------------------- | ----------------------------------------- |
| 15 animal models (`bunny.glb` ...)       | Kenney Cube Pets       | `Models/GLB format/animal-{id}.glb`       |
| `cube-pets-colormap.png`                 | Kenney Cube Pets       | `Models/GLB format/Textures/colormap.png` |
| 12 character models (`female-a.glb` ...) | Kenney Mini Characters | `Models/GLB format/character-{id}.glb`    |
| `wheelchair.glb`                         | Kenney Mini Characters | `Models/GLB format/wheelchair.glb`        |
| `mini-characters-colormap.png`           | Kenney Mini Characters | `Models/GLB format/Textures/colormap.png` |

All of it is CC0-derived work distributed under this repository's terms. CC0 imposes no obligations, but Kenney is credited here anyway, as the pack readmes invite.
