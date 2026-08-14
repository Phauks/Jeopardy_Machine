# 2026-08-14 - Avatars in motion: sprites are for chips, live 3D is for the room

## Context

Owner: "why are we baking the webp 3d files, I want them to be able to move around in a 3d environment a little bit."

Fair challenge. The bake decision (docs/research/00-user-directives.md, avatar sections) was made for the **chip** problem: a roster row, a buzz-winner banner, and a score strip need a 24-48 px avatar on possibly 100 phones. Static sprites are unambiguously right there - no WebGL, no model loading, no battery burn, ~6 KB each. But that reasoning was silently generalized into "avatars are images," which quietly dropped the 3D-environments direction (docs/research/00-user-directives.md, "worlds where the players live"). Both things should exist; they serve different surfaces.

## Decision - three tiers, by surface

| Surface                                                                      | Representation                                                                           | Why                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chips** (roster rows, buzz banner, score strip, player lists, phones)      | Baked static webp sprite (exists: 216 sprites)                                           | Dozens on screen at once, 24-48 px, must render on a 5-year-old phone with no WebGL cost                                                                                       |
| **Your own avatar on your own phone** (join preview, lobby "you're in" card) | **Animated sprite sheet** of the walk/idle cycle (webp animation or a strip + CSS steps) | It moves - the identity moment - but costs no three.js payload on a device that exists to buzz. ~8-12 frames per avatar, one avatar shown                                      |
| **The room diorama** (big-screen lobby, interstitials, winner scene)         | **Live three.js with the real GLB models**, walk/run clips, in a Kenney world kit        | One device (the display), plugged in, driving a projector. This is where "players live in a world" actually happens - pets wandering a forest/pirate deck while the room fills |

The GLB models therefore **ship as static assets** (they were only downloaded for baking before, never committed - that was the actual mistake). Cube Pets are ~700-900 tris and a shared 8.7 KB palette texture; 27 models is a trivial payload for a display device that loads once.

## What this changes

1. `apps/web/static/avatars/models/` gains the GLBs (Cube Pets + Mini Characters, CC0, provenance in the existing LICENSES.md). The bake pipeline keeps producing sprites - it is not replaced, it is joined.
2. The bake tool gains a **sprite-sheet mode**: render the walk (and idle) clip at N frames per avatar per accent-neutral base, packed as an animated webp (or a strip with a documented frame count). Phones animate with zero JavaScript.
3. A **diorama module** for the display (`apps/web/src/lib/diorama/`): three.js scene, environment slot (starting with a simple ground/backdrop until a Kenney world kit is wired), one instance per joined player using their avatar + accent recolor (the palette-canvas mechanism already proven), wandering with the walk clip, reacting to room events (buzz winner hops/dances, winner podium). Loaded **only on the display route**, code-split so no other surface pays for three.js.
4. Recolor at runtime uses the same palette-cell edit the bake tool does - one shared module so sprites and live models can never drift in color.

## Guardrails

- **Never on the buzzer's critical path.** The phone's buzz screen stays 2D and instant; animation lives on the join/lobby screens only, and pauses when the clue is armed.
- `prefers-reduced-motion` disables wandering (models stand idle) and freezes sprite-sheet animation.
- The diorama degrades to the existing 2D lobby if WebGL is unavailable - it is decoration, never a dependency of play.
- Frame budget: the display also renders the board; the diorama only runs on lobby/interstitial/winner screens, never behind a live clue.

## Milestone placement

Sprite-sheet mode and the GLB commit land now (they are small and unblock the identity moment). The diorama lands as the M4-follow-on delight pass; the Kenney world kits (forest for the club night) attach to it via the theme document's environment slot per the earlier environments direction.
