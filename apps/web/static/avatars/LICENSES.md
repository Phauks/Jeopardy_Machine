# Avatar sprites

Pre-rendered player-avatar sprites (webp, 192px, transparent background): every avatar in two Kenney 3D packs, recolored per player-accent color and rendered at a fixed 3/4 hero angle by the repo-committed pipeline in `tools/avatar-bake/` (how to re-bake, and when: its README). The generated index lives at `apps/web/src/lib/avatars/avatar-manifest.json`; filenames are `{avatarId}--{accentId}.webp`.

Both source packs are **CC0 1.0** (Creative Commons Zero - no attribution required; we credit Kenney anyway, as the pack readmes invite). License verified on the `License.txt` inside each downloaded zip, not on marketing pages; the download script re-verifies the CC0 line and a pinned sha256 of each zip on every fetch.

| Source pack            | Version | Author                       | License | Verified                                                              | Source                                     |
| ---------------------- | ------- | ---------------------------- | ------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Kenney Cube Pets       | 1.0     | Kenney (<https://kenney.nl>) | CC0 1.0 | zip `License.txt`, sha256 pinned in `tools/avatar-bake/src/packs.mjs` | <https://kenney.nl/assets/cube-pets>       |
| Kenney Mini Characters | 1.0     | Kenney (<https://kenney.nl>) | CC0 1.0 | zip `License.txt`, sha256 pinned in `tools/avatar-bake/src/packs.mjs` | <https://kenney.nl/assets/mini-characters> |

The raw packs (GLB models + shared colormap textures) are **not** committed - `tools/avatar-bake/downloads/` is gitignored; only these baked derivative sprites ship. The derivatives are themselves CC0-derived work distributed under this repository's terms; the recolor step edits only palette cells of each pack's shared colormap texture (player-accent garment/body tint), everything else is Kenney's art as shipped.
