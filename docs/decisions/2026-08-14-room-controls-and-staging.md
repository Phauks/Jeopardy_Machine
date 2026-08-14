# 2026-08-14 - Room controls, streaming, and the staged lobby

## Owner batch (verbatim intent)

Listing values should read **public / private**. Wants: a Run-all button in the harness test area, modular panel layout, rooms that disappear when empty, streaming support (hide the join code), a maximum-participants setting that distinguishes players from spectators, a spectators-allowed toggle, the ability to change the password after creation, "special management tools once a room is created", a **staged lobby** (first theme: boats - players start in the water and board their team's boat when they pick a team, modular because it will not always be boats, and colour is the common retheme), a display screen that works on mobile, and the pre-game flow built end to end: **landing -> lobby selector -> character selector -> team joining**. No gameplay needed yet.

## Answers to the two questions

**"Listing is public or private."** Adopted - the axis values become `public` / `private`. `unlisted` was accurate jargon and bad vocabulary; a host choosing between "public" and "private" needs no explanation. The entry axis (`open` / `password`) is unchanged, and all four combinations still exist: a **private** room can still carry a password, and a **public** room can be open or locked.

**"What is the difference between title and host label?"** Title = what the *game* is called ("Environment vs Gaming Trivia Night"). Host label = who is running it ("Board Game Club"). In a server browser the pair reads as one line - *Environment vs Gaming Trivia Night - hosted by Board Game Club* - and they answer different questions for someone scanning the lobby: what am I playing, and do I know these people. Both stay, with the host label optional (empty = no byline) and the UI labelling them in those words rather than as schema names.

## Room settings (all live on the room, editable after creation)

| Setting | Values | Notes |
|---|---|---|
| `listing` | public / private | renamed axis; private rooms never appear in the lobby |
| `entry` | open / password | password changeable at any time; changing it never disconnects anyone already in |
| `maxPlayers` | int, capped by `limits.room` | **counts players only** |
| `maxSpectators` | int, capped separately | independent budget, so a stream audience cannot crowd out players |
| `spectatorsAllowed` | on / off | off = spectator joins refused with a clear reason |
| `hideJoinCode` | on / off | **streamer mode**: the display and any shared surface stop rendering the code and QR (with a "code hidden" affordance the host can reveal on demand). The code still exists and still works - this is about not broadcasting it to a stream where anyone can read it off the screen |
| `emptyRoomGraceMs` | duration | how long a room with **zero connected participants** survives before it closes itself |

**Empty-room expiry is separate from idle expiry.** Idle expiry (2 h, existing) protects against rooms that are occupied but dormant. Empty expiry answers "everyone left" and should be much shorter (default 15 min - long enough for the whole room to lose Wi-Fi and come back, short enough that abandoned rooms stop squatting on codes and lobby slots). Both are alarms; whichever fires first closes the room and marks the registry row ended.

## Management tools ("once a room is created")

The host console gains a **Room settings** panel (and the harness gets the same controls, since it is the developer's console): change listing, entry/password, caps, spectators, streamer mode; view and rotate the join code; see the live participant census split players/spectators; close the room. Every change broadcasts to connected clients so displays update immediately (a code that just became hidden must vanish from the projector at once).

## The staged lobby - "you are somewhere, with your team"

The lobby stops being a list and becomes a **place**. First theme: **boats**.

- Unassigned players are **in the water** (drifting, visibly unattached).
- Choosing a team **puts you on that team's boat** - the boat is the team, its colour is the team colour, its nameplate is the team name.
- Team changes are visible: you swim over, you climb aboard.

**Modularity is the requirement, not the boats.** The abstraction is a **staging environment** with two slot kinds - a *holding area* (water) and *team stations* (boats) - plus per-station colour. A staging theme supplies: the holding-area visual, the station model/visual, how a participant is placed on a station (seat offsets), and the transition. Boats is the first implementation; campfires, tables, islands, spaceships are later ones, and **recolour is the cheap variant** every theme must support. The theme document's reserved `environment` slot names the staging theme; `none` keeps the plain 2D lobby.

This builds on the diorama already shipped (display-only three.js, code-split, reduced-motion aware) - staging is the diorama gaining slots and a placement rule, not a new system.

## Build order (owner-directed)

1. **Landing screen** - the real front door (not the dev index): what this is, join by code, browse the lobby.
2. **Lobby selector** - the public room browser as a place worth looking at, with the private/password affordances.
3. **Character selector** - avatar + accent + name, with the animated walk sheets doing the work.
4. **Team joining** - team cards, leader controls, and the staged boats view reflecting membership live.

Gameplay is explicitly out of scope for this pass: everything up to the first clue.

## Also in scope

- **Display on mobile**: the display route currently assumes a projector. It must degrade gracefully on a phone (a host checking the room from their hand, or a small-screen spectator) - fluid type scale, no fixed pixel layouts, scrollable scores.
- **Harness**: Run-all button in the test area (sequential, with a summary line), and the panels become modular components so the layout can be rearranged without touching probe logic.
