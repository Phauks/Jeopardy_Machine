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

### 2. Which staging theme a room uses is a theme-document field

`staging-theme-registry.ts` reserved the vocabulary and wrote out the one-line `themeBodySchema` addition it needed, exactly the way `diorama-environment.ts` reserved `environment`. This milestone did not edit the protocol.

> **Wired 2026-08-16 (the reconcile).** Both reserved lines landed in one protocol change: `staging: z.enum(["boats", "campfires"]).optional()` beside `environment`. Optional, so no document migrated. The display and the phone now read `theme.staging` and pass it into `stagingThemeById()`; `?staging=` remains a dev override that wins over the document. The registry's ids and the protocol enum are held EQUAL by a test (`staged-lobby.states.test.ts`), so adding a theme is still a file, a line in the registry, and now a value in the enum - and forgetting the third reddens instead of making a document that names it unwritable. Unknown ids still fall back to boats: a projector must not go blank over a string from a newer build.

### 3. Placement is pure; the scene only copies it

Same division of labour `wander.ts` established. `staging-layout.ts` decides where stations and people go, `staging-motion.ts` decides how they get there, and `diorama-scene.ts` copies the numbers onto Object3Ds. The stage splits along Z: **holding area at the front, nearest the camera** (the people the screen is asking a question of), stations behind. Nothing crosses the divide.

Two anti-shuffle rules, both gate-tested, both learned from the same bug class the fixed spawn grid in `wander.ts` exists to prevent: a station keeps its spot when a new team is created, and a waiting player keeps their spot when somebody else boards.

> **Half of that reversed 2026-08-16 - see "What the deployed version got wrong" below.** A station can no longer keep its exact spot, because clearance at every team count and a fixed spot are not simultaneously satisfiable. The waiting-player rule stands unchanged.

### 4. The move is the point

`stepStagedAgent` walks an occupant to their seat at 1.15 units/second, facing the way they are travelling, and adopts the seat's own facing only on arrival. A team switch is therefore a visible crossing rather than a teleport - which is the owner's brief, and also the only way the change is legible from the back of a hall.

## The one place this differs from the diorama's guardrails

**The diorama may degrade to nothing. The staging may not.** Guardrail 3 of the avatars-in-motion decision says the diorama is decoration and a browser without WebGL simply loses it. That is right for wandering pets. It is wrong for staging, because "which boat am I on" is an ANSWER, not scenery - and the team screen is unusable without it.

So `staged-lobby.svelte` renders `staged-lobby-2d.svelte` - stations as cards in their team colours over a water band - until the renderer reports itself up, and keeps it forever on a device that has none. SSR renders it too, so a phone sees the staged layout before any JavaScript has decided what the device can do. Everything else the diorama guarantees is unchanged and still gate-tested: three stays behind the dynamic import, the whole staging layer is three-free, `prefers-reduced-motion` stands everyone still on their spot (the layout survives the freeze, the journey does not), and none of it renders behind a live clue.

## What the deployed version got wrong (owner, 2026-08-16, and the fixes)

Three reports from looking at the thing on a screen. All three were in the placement and the copy; none of them was in the theme system, which is the reassuring part.

### "Boats overlap each other"

**The bug.** The packing filled a row with as many stations as fit at the theme's authored size, wrapped, and then spread the rows over whatever depth the station band had left. Two and three teams looked right. From five teams up the row spacing was shorter than a boat is long, and the hulls sat inside each other; at twelve teams the whole harbour was a pile. The old test asserted "no overlap on the same row" - which was true, and useless, because the overlap was between rows.

**The fix.** `stationGrid` searches every column count and keeps the arrangement that lets the stations stay biggest, then every station wears a uniform **scale** so its footprint fits the cell it was given. Non-overlap becomes a property of the grid rather than of the count: six boats land as 3x2 at full size, twelve as 4x3 at 64%, and neither number is written down anywhere. The crew scales with its station (six people at authored spacing on a 60% boat would be standing through each other), and the seat-wrap nudge for an overcrowded team is bounded by the footprint so the twentieth member cannot drift onto the neighbouring boat.

**The holding area had the same class of bug, worse.** A fixed three rows of six gave eighteen slots for a crowd the diorama draws up to twenty-four of, and the slot index wraps - so the nineteenth waiting player stood _exactly_ on top of the first. Rows now come from `maxDioramaAvatars`, and the scatter jitter is bounded by whatever is left over once everybody has their personal space, so the guarantee survives the scatter.

**The reversal this forces.** A grid that guarantees clearance for N stations is not the grid for N+1, so creating a team re-packs the stage. That kills the "a station keeps its spot" rule above. What replaces it is a promise that is actually keepable: nothing JUMPS. `easeStationPosition` slides each station to its new anchor, so the harbour visibly makes room for the new boat. Same trade as everywhere else in this system - the pure module decides, the scene copies, and the motion is unit-tested.

**The test that would have caught it.** `staging-layout.test.ts` now asserts that no two station footprints intersect (a separating-axis check, not "the positions differ"), at fourteen team counts, on two canvas shapes, for both themes - plus that no two people in the holding area are closer than one avatar's width under the worst jitter the scatter can produce.

### "I don't understand still in the water"

Being unassigned was drawn as a POSITION and nothing else, and a position is not a state anybody can read from the back of a hall. Two causes, both fixed:

- **No words.** `staging-copy.ts` gives the holding area a sign: what it is ("Waiting to board"), what to do about it ("Choose a team to board"), and how many people are in it. In the theme's own verb, so the clearing says "Waiting to join" without a second string existing. One function, used by the 3D sprite over the water AND by the 2D card, so the answer cannot depend on whether the projector laptop has WebGL.
- **No boundary.** The water was a 60x40 plane running under the entire stage - which is to say, no edge anywhere, indistinguishable from the floor. It is now the holding band plus a margin, with a kerb around it; the 2D card gained a real border with the theme's noun on it. A place you can see the edges of.

### "Names beneath the boats"

Each station carries a crew plate under it: a sprite in 3D, a wrapped list in the 2D card, capped by the same rule in both (`crewPlate`, six names then "+4"). Overflow COUNTS rather than shrinking - a plate that stayed readable by getting smaller would be unreadable at exactly the moment it has the most to say - and long nicknames are cut rather than allowed to own the plate.

## Consequences

- The display's lobby phase is staged; once play starts it returns to free wandering behind the interstitials, because by then everyone has chosen and there is nothing to stage.
- `DioramaPalette` grew `holding`, `structure`, `nameplateColor`, and `nameplateFont`, all read from PLAIN-COLOR theme tokens. The derived `--surface-*` tokens are deliberately not used: they are `color-mix()` with an alpha term, and three's parser drops alpha silently.
- Nameplates are canvas-texture sprites, redrawn only on a rename. One texture per team.
- `/dev/diorama` gained a staged mode with a per-player control that cycles someone through the stations, so the move is reviewable without a room and six phones.
