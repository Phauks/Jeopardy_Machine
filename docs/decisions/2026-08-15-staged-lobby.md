# 2026-08-15 - The staged lobby: the diorama stops being scenery before the game starts

## Context

The diorama (docs/decisions/2026-08-14-avatars-in-motion.md) put the room's avatars in a 3D stage and had them wander it. Lovely, and completely uninformative: a projector showing twelve pets strolling tells nobody which team they are on, which is the only question the pre-game screens are actually asking.

Owner brief: extend the diorama into a **staging environment** - a holding area where unassigned players wait, and team stations they move to when they pick a team. First theme **boats**: unassigned players are in the water, choosing a team puts you on that team's boat, boat colour = team colour, nameplate = team name, and switching teams is a visible move. And the modularity requirement, stated as the requirement rather than a nice-to-have: a staging-theme interface with boats as the first implementation and at least the shape for others, with **recolour as the cheap variant**.

## Decision

### 1. A staging theme is data, not code

`apps/web/src/lib/staging/staging-theme.ts` defines what a theme answers - holding-area visual, station visual, per-part colour ROLE, seat placement, waiting behaviour - and every answer is a plain object. A station is a short list of primitives (`box | cylinder | plane`) with positions and colour roles. `diorama-scene.ts` remains the only module in `apps/web` that imports three, and it is what turns those primitives into geometry.

Three consequences, and they are the reason for the shape:

- **Themes are unit-testable.** `staging-layout.test.ts` runs the packing, the seating, and the walk in node with no GPU. A theme that seats nobody or paints nothing fails a gate instead of looking subtly wrong on a projector.
- **Recolour is genuinely cheap.** A theme never names a colour. It says which parts wear the team's colour (`team`, `team-shade`, `team-light`), which wear neutral structure, and which wear the room's accent. `#paintStation` derives shade and tint from the one team hex and writes two material colours per mesh. A red boat and a green boat are one geometry description.
- **The 2D degradation reads the same object.** `stationNoun`, `holdingAreaNoun`, and the colour roles are exactly what `staged-lobby-2d.svelte` needs, so the fallback cannot drift from the scene.

Adding a theme is a file next to `staging-themes/boats.ts` plus a line in `staging-theme-registry.ts`. Nothing in the scene, the layout, the fallback, or any screen changes. **Campfires ships alongside boats to prove that**, not to fill out a menu: it has a holding area with no drawn surface, a station you sit around rather than stand in, four inward-facing seats instead of six camera-facing ones, and milling instead of bobbing. It is also the Terra Verde forest lobby the first event wants.

### 2. Which staging theme a room uses is a theme-document field in waiting

`staging-theme-registry.ts` reserves the vocabulary and writes out the one-line `themeBodySchema` addition it needs, exactly the way `diorama-environment.ts` reserves `environment`. This milestone does not edit the protocol.

### 3. Placement is pure; the scene only copies it

Same division of labour `wander.ts` established. `staging-layout.ts` decides where stations and people go, `staging-motion.ts` decides how they get there, and `diorama-scene.ts` copies the numbers onto Object3Ds. The stage splits along Z: **holding area at the front, nearest the camera** (the people the screen is asking a question of), stations behind. Nothing crosses the divide.

Two anti-shuffle rules, both gate-tested, both learned from the same bug class the fixed spawn grid in `wander.ts` exists to prevent: a station keeps its spot when a new team is created, and a waiting player keeps their spot when somebody else boards.

### 4. The move is the point

`stepStagedAgent` walks an occupant to their seat at 1.15 units/second, facing the way they are travelling, and adopts the seat's own facing only on arrival. A team switch is therefore a visible crossing rather than a teleport - which is the owner's brief, and also the only way the change is legible from the back of a hall.

## The one place this differs from the diorama's guardrails

**The diorama may degrade to nothing. The staging may not.** Guardrail 3 of the avatars-in-motion decision says the diorama is decoration and a browser without WebGL simply loses it. That is right for wandering pets. It is wrong for staging, because "which boat am I on" is an ANSWER, not scenery - and the team screen is unusable without it.

So `staged-lobby.svelte` renders `staged-lobby-2d.svelte` - stations as cards in their team colours over a water band - until the renderer reports itself up, and keeps it forever on a device that has none. SSR renders it too, so a phone sees the staged layout before any JavaScript has decided what the device can do. Everything else the diorama guarantees is unchanged and still gate-tested: three stays behind the dynamic import, the whole staging layer is three-free, `prefers-reduced-motion` stands everyone still on their spot (the layout survives the freeze, the journey does not), and none of it renders behind a live clue.

## Consequences

- The display's lobby phase is staged; once play starts it returns to free wandering behind the interstitials, because by then everyone has chosen and there is nothing to stage.
- `DioramaPalette` grew `holding`, `structure`, `nameplateColor`, and `nameplateFont`, all read from PLAIN-COLOR theme tokens. The derived `--surface-*` tokens are deliberately not used: they are `color-mix()` with an alpha term, and three's parser drops alpha silently.
- Nameplates are canvas-texture sprites, redrawn only on a rename. One texture per team.
- `/dev/diorama` gained a staged mode with a per-player control that cycles someone through the stations, so the move is reviewable without a room and six phones.
