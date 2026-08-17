# 2026-08-16 - Persistent layout, and the pre-game rework

## The principle that outranks the rest

> "In general, I do not like different screens or disappearing stuff. So if something appears, like who selects, I would prefer it stays that way."

**Adopt as a standing UI law: state changes in place; it does not swap screens.** A thing that has appeared keeps its position and stays visible, changing only its own state (highlight, dim, badge). Corollaries:

- **No wizard chains.** The pre-game is ONE surface whose regions fill in, not character -> team -> lobby as three separate pages.
- **Nothing that has been shown gets hidden by a later step.** Who is picking, the roster, your own identity - all stay put once drawn.
- **Reserve the space up front** so nothing reflows when content arrives (a spinner or an empty slot occupies the final size).
- Exceptions are the genuinely modal moments the game itself defines: a clue card taking the display, the Final round. Those are the game changing state, not navigation.

This reverses part of the pre-game build: the four-stage `playerRouteStageFor` becomes one screen with regions.

## The batch (owner, from using the deployed site)

### Landing and lobby - one front door

- **Join AND browse on the same screen.** `/lobby` as a separate destination was the wrong split; browsing and joining are the same act. `/lobby` folds back into `/` (no redirect kept - no-legacy directive).
- **Two primary buttons: Join room and Create room.** Creating a room from the front page is a first-class path, not a developer-only affordance buried in `/dev/rooms`.
- **Rejoin memory.** If this browser was in a room that is still live, the front page offers rejoining it by name before anything else. Session-scoped, no account (guiding principle 3): the code + session token already live in sessionStorage; the front page just has to look.
- **The hero sentence must not reflow in a narrow column.** Its current single long sentence wraps into a ragged block on a laptop. Shorten and structure it.
- **The front page reads AI-made and bland.** Rebuild it with real art direction on the token system - the theme presets exist precisely so this page can look like something. It is the first thing anyone sees.
- **Home button everywhere.** Every surface gets a way back.

### Copy

- The password field's helper prose ("shouted across the hall...") becomes simply **"Password"**.
- The name field's "Up to 24 characters. You can change it later." becomes a **live character counter** (`17/24`), which says the same thing while you type.

### Character and team - one screen, and real team management

- **Unify look + team into a single surface.** Fewer places, less navigation, easier to adjust - and it follows the principle above.
- **BUG: the "Look" control recolours the character's backdrop, not the character.** The accent must tint the model/sprite itself. (The recolor mechanism exists and is proven - `palette-recolor.ts`; this is a wiring error, not a missing capability.)
- **Team management belongs to players**: create a team, **move between teams after joining**, and **rename** (leader). All in place, on the same screen.
- **Skin tones for the human models.** The Mini Characters need a skin-tone axis alongside the accent, recoloured through the same palette mechanism. Curated set, offered as an explicit choice - never inferred, never defaulted from anything but a neutral.
- **Laptops and desktops are first-class play devices.** "Phone as buzzer" is the headline, not the constraint: the same surfaces must be comfortable with a mouse on a 1440px-wide window. The current layouts are tall thin columns that look wrong on a laptop - they need a wide layout, not a stretched phone.

### The staged lobby

- **Boats overlap each other.** The placement math needs real collision spacing at every team count.
- **"Still in the water" does not read.** Being unassigned must be legible as a state, with words, not just a position - the metaphor needs a label ("Choose a team to board" / "Waiting to board"), and the water needs to look like a place people are waiting rather than a gap.
- **Names beneath the boats** on the display, so the room can see who is aboard which.

### Hosting

- **Verify the host system end to end** - it has had the least real use of any surface.
- **A settings cog on the host console**, and this is the interesting part: **display text and host text are different things.** The projector is read from across a room; the console is read at arm's length. So text settings are per-surface, not global: display type scale, host type scale, and the ability to bump one without the other. Identify what else genuinely helps mid-game (timer visibility, sound toggles, auto-arm, mirror, streamer mode, roster density) and put them behind that cog - one place, everything live, nothing that requires leaving the game.

## Sequencing

The principle first (it changes the shape of the pre-game), then the front door, then the staged-lobby fixes, then the host cog. Nothing here needs new protocol beyond team-move/rename messages and a skin-tone field on player identity.

## Landed 2026-08-16: the front door, rebuilt

The first item of the batch, implemented. What it is now, and the reasoning that is not obvious from the diff:

**One screen, four regions.** `/` carries the rejoin offer, the code box + password, the create form, and the live public list at once; `/lobby` and its screen component are deleted with no redirect (docs/decisions/2026-08-14-room-visibility-and-lobby.md, amended there). On a laptop it is two columns - a control column (join, create) beside a full-height list - and on a phone it is the same regions stacked in priority order. That is the layout answer to the crowding problem the 2026-08-15 split tried to solve with navigation.

**Create is real, and it ends in the game.** The form posts to `POST /api/rooms` with the built-in sample game (dynamically imported at the moment of the tap, so the front door carries none of the engine's weight for the visitors who only came to type a code), stashes the returned host token in sessionStorage under a per-code key, remembers the room, and navigates to `/room/<CODE>/host`. It hands off IMMEDIATELY in every case but one: a room that asked to be PUBLIC and could not be listed stops here and says so with its code and the fix, because navigating away would replace that sentence with a host console that looks perfectly normal (owner report 2026-08-14). The rules are pure and tested (`src/lib/landing/create-room-request.ts`); the room's own refusals remain the server's.

**Rejoin is a note this tab wrote to itself.** `src/lib/lobby/room-memory.ts` records `{code, title, role, at}` in sessionStorage whenever this browser enters a room; the front door reads it synchronously on mount, draws the offer, and asks `/api/rooms/<CODE>/live` per room. `gone` deletes the entry silently; `unknown` (no D1 binding, unapplied migration, offline) keeps the offer, because the room itself refuses on connect and a probe that cannot answer must not be allowed to delete anything. No token, no player id and no password is ever stored in that list - the two secrets keep their own keys, for one hop, in `join-hand-off.ts`.

**Art direction: the page is built from the board's own materials.** The masthead is a full-bleed category-colored band with a gold wordmark; panels are ink blocks separated by the same thick gutters that separate board cells; listed rooms are drawn as cells; every number is in the theme's value face and value color; corners are square and nothing floats on a soft shadow. Two consequences worth keeping: the palette is guaranteed rather than hand-picked (`--board-cell-bg`, `--board-category-bg`, `--board-value-color` and `--clue-text-color` are pairs the theme contract already guarantees legible, so all four presets render this page correctly - including the light paper one, where the DERIVED chrome tokens converge toward each other), and one type scale plus one spacing rhythm are declared at the top of the screen rather than re-guessed per element.

**The hero no longer reflows.** A short lead ("Quiz night, on everyone's phone.", `text-wrap: balance`, 22ch) plus a supporting line (44ch, `text-wrap: pretty`) replaces the single long sentence. Held by a source gate alongside the reserved blocks - the join note, the create form's verdict line and the room list all declare a minimum height, so an arriving answer changes words rather than positions.

**Copy.** The password field is labelled `Password` and says nothing else. The create form's name field carries the live counter the batch asks for.

**The way back is a component.** `src/lib/chrome/home-button.svelte` - an anchor (never `history.back()`: a QR arrival has nothing behind it), `inline` or `floating`, tokenized, with an optional confirm for a surface that is mid-game. The `/dev` layout adopted it; the play surfaces adopt it in their own passes.

## Landed 2026-08-17: the front door, simplified

The owner read the version above on the deployed site and returned a second, sharper batch. The rebuild had been right about the layout and wrong about the words: it was nominally one screen, and it read as three stacked things, because every region opened with a sentence explaining itself and the page closed with a three-pillar marketing block.

**The rule that replaced the copy.** Trust the reader: the page explains itself by being obvious, not by narrating. A box labelled "Room code" needs no paragraph about codes; two radio buttons labelled Private/Public need no paragraph about listing; a form does not narrate its own settings back at the person filling it in. Deleted outright, and gated as deleted by exact string in `front-door.states.test.ts`: the hero's eyebrow, lead, supporting line and statistics rail (the wordmark is now **just a header**); the browse panel's "Hosts opt in to being listed..."; the create panel's preamble and all three of its listing hints ("Anyone can see this room in the list and walk in", "Only people you give the code to can join", "Everyone joining will be asked for this password"); the "A public room needs a name" refusal; the whole three-pillar closing band. The reserved blocks the layout law asks for still exist and still hold their height - they are simply silent when there is nothing to say.

**One compact surface, not three panels.** The section numbers ("01/02/03") went with the prose: numbering three regions is what made them read as three things. What is left is a masthead, a rejoin slot, join, create and the list - same two-column arrangement on a laptop, same priority order on a phone, with the vertical rhythm tightened now that nothing between the controls is a paragraph.

**The dev index is a header control.** It moved out of the drawer at the foot of the page into a gear menu in the masthead (`src/lib/landing/dev-menu.svelte`, a `<details>` so it works with no JavaScript and server-renders closed). The owner rule is unchanged - every meaningful surface gets an entry, in the same PR that ships it, still one line in `surface-cards.ts`. Only the place moved, and the drawer is gone rather than duplicated: the last thing a visitor scrolls past should not be a list of engineering routes.

**The public list is searchable.** Instant and local to the fetched rows (`src/lib/lobby/room-search.ts`): the listing is already capped at `limits.lobby.listingMax`, so asking a server to re-filter forty rows a keystroke at a time would be slower, would show a stale answer while it flew, and would turn a browse surface into a query endpoint. Terms are AND-ed against one haystack of title + host label, because someone searching "board game club" does not know which of the two strings carries the words. A query that matches nothing says so and offers the whole list back, rather than borrowing the "nobody is hosting" state.

**Freshness is a clock, not a phrase.** "Updated just now" became `Updated 20:14:32` (`formatClockTime`, 24-hour, zero-padded, built from local Date parts so it does not vary by locale). A relative phrase is the worse answer to the only question that line exists to settle - is this stale? - because it is honest only while a timer re-renders it. The route dropped its `now` ticker with it.

**Two create-form corrections.** Room name and "hosted by" are required **unconditionally**, not for public rooms only: the console, the display's title card and this tab's rejoin offer all render them for a private room too, and a conditional requirement means the field a host skipped becomes mandatory later, when they flip the room public mid-game. And the player cap is bounded by the **soft** cap with its bound printed beside the field - it accepted 128 because the hard cap (refusal headroom, so a team rebalance never bounces player 101) was the only ceiling the control knew.

**The no-reflow gate is general now.** The owner quoted two sentences that reflowed; a test naming those two would only ever catch those two. `front-door.layout.gate.test.ts` instead parses every component under `lib/landing` and `lib/lobby` and requires: a `max-inline-size` in `ch` on any rule with a wrapping line-height (above 1.25); `text-wrap: balance` on every heading it finds in the markup; a reserved `min-height` on every `role="status"` block. A new component in either directory is covered by existing. Each of the three rules was verified by breaking it.

**The create-settings report was not a create bug.** Owner: "I made a public room but settings said it was private. Also didn't carry title or host name." The chain from the form through `POST /api/rooms` to the DO's `initialize` and back is intact, and is now gated as a round trip in `src/routes/api/rooms/rooms-endpoint.test.ts` (a stub DO that parses the forwarded body with the real protocol schema, plus the D1 bind values, so a dropped field fails loudly). The symptom is the far end: the host console the front door hands off to still runs the MOCK store - `create-room-store.ts` returns `LocalSimRoomStore` unconditionally until the M3 reconcile, and its settings are `defaultRoomSettings` + empty strings, so **every** room reads private, untitled and unattributed there regardless of what it is. That fix belongs to the reconcile (or to passing the created room's real settings into the store), not to the front door.
