# 2026-08-18 - The front door: one counter, one list, one host button

> Research behind it: docs/research/06-join-flow-patterns.md. Supersedes the LAYOUT half of docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md ("Landing and lobby"); everything that decision says about behavior - one screen, rejoin memory, create ending in the host console, the code box winning - is kept and re-expressed here.

## The verdict this answers

> "I still dislike the home page. I asked you to reorganize and reidentify how to combine public rooms, joining a room, and private rooms into a more consolidated space. you just reduced the header. and the header is still too large."

Two attempts failed the same way. The 2026-08-16 build put four near-equal panels on one screen - rejoin, join, create, browse - and called it consolidation; the follow-up cut copy and shrank the masthead, which changes nothing about which regions compete. **Consolidation means fewer controls doing more, not the same controls drawn smaller.**

## The page's jobs, ranked

1. **PRIMARY - get the person holding a code into their room.** One control, no reading, no scrolling, on a phone in a loud hall. Roughly thirty people per event take this path.
2. **SECONDARY - answer "is anything on?" and let someone walk in.** One person in ten takes it, and the honest default answer is "nothing is listed", because rooms are private unless the host opts in (2026-08-14).
3. **TERTIARY - start a room and land in the host console.** Exactly one person per event, who is not in a hurry and who is willing to press a button first.

Nothing else is a job. The product pitch, the developer index and the operational facts are not jobs; they are things that may occupy space left over after the three above are served.

## The decision

**One entry control ("the counter") is the spine of the page, the room list hangs beneath it as the same control's results, and hosting is a button attached to the counter rather than a panel beside it.**

### 1. The counter is one field, and it does both jobs

A single input, code-first. What is typed is normalised to the code alphabet for the code reading and kept verbatim for the search reading, and the two are told apart mechanically rather than by guessing (research pattern 4; the property Jitsi lacks and we have):

| What is in the field                        | What the page does                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Empty                                       | The list is the full public listing; the verdict line says what the field is for                         |
| 1-4 characters, or anything not code-shaped | The list **filters** live over title, host label and code; Join stays disarmed                           |
| Exactly 5 characters of `[A-Z0-9]`          | **Join arms and wins.** The list steps back and says so. The verdict line names the room if it is listed |

This is the consolidation the owner asked for, stated exactly: **the code box and the room list are the same control**, so "public rooms", "joining a room" and "private rooms" stop being three regions. A code that matches nothing in the list is not an error state - it is the ordinary private-room case, and the verdict line says so in words ("not in the public list - that is normal, most rooms are private").

Deliberately NOT adopted from the omnibox: auto-submit at the fifth character (a mistyped character would navigate away), and creation-by-typing (Jitsi's ambiguity - creating a room is a deliberate act with settings behind it).

### 2. The password is a state of the counter, not a field beside it

Today a password input sits permanently beside the code box, which is noise for the default room (private + open, no password) and the second-loudest control on the page. It becomes part of the counter's own reserved verdict block, revealed by the code rather than by a toggle:

| Situation                                | What appears in the reserved block                                 |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Code complete, room not listed (unknown) | Password field, labelled as optional - the private + password case |
| Code complete, listed room with a lock   | Password field, and the line says the room needs one               |
| Code complete, listed open room          | No field - the line names the room, its host and its phase         |

It is still not behind a "my room has a password" toggle (the thing the 2026-08-16 test forbade); it is behind having a code, which is strictly more informative and costs no tap.

The reserve is honest about what it covers. The block's height holds every state the PAGE reaches on its own - the sentence swapping between the hint, a match count, a named room and a listing warning as fetches land - which is what the layout law is about: nothing reflows when content arrives. On a narrow screen the password box itself still adds a field, and that is accepted rather than papered over: it appears on the person's own fifth keystroke, it sits BELOW the Join button they are reaching for, and reserving for it would cost a phone roughly 90px of permanent emptiness above the room list to avoid a shift the person caused.

For a listed locked room the per-card password prompt stays exactly where it was - the secret belongs to the room it was asked for (2026-08-14).

### 3. Hosting is a button, and its form opens in place

"Host a game" sits in the counter's action row as a visibly secondary button. Pressing it expands the create form inside the counter, below the entry row, with the entry row still on screen and the list still beneath it. Nothing is hidden, nothing navigates, and the form's own states (creating, refused, created-but-not-listed) still happen inside it. Create still ends in the host console.

This is research pattern 6, and it is what removes the largest competitor to the code box: a six-field form that one person per event needs and everyone else has to read past.

### 4. The list is compact, filtered, and priced as the minority path

One header row carries everything the region used to spend three elements on: the label, the live count, an **open-rooms-only** toggle (the one filter our list size can justify - a lock badge carries the rest), the real "updated Xm ago" stamp, and Refresh. Rooms are compact cards in a responsive grid, so a laptop fills its width instead of running one tall thin column, and a phone gets one column. The listing's states keep their single reserved block, and gain a fifth: "nothing here matches" is a different sentence from "nobody is hosting", because the field that emptied the list is the one the person is holding.

### 5. The masthead is a wordmark strip

A single row: the wordmark in the chrome face at `1.15rem`, one short tagline that hides below 34rem (a phone spends its whole width on the wordmark and the gear), and the developer-surfaces gear at the right. **Target height: one line of text plus padding - `3rem` (48px), `3.5rem` at the widest** against the ~340px the previous band occupied at 1440px. The pitch, the three "pillars" and the eyebrow are deleted outright. **Amended on merge, 2026-08-19:** this pass first kept the pitch as one line in a page footer, with the three operational facts (2-100 players, 5-character code, no accounts) beside it. That footer is deleted too - the owner's 2026-08-17 call was to remove the closing marketing band, and a quieter band in its place is the same band. The page now ends after the room list, and `front-door.states.test.ts` holds it there by string.

The gear opens the developer index as a menu anchored under it, which is the same content the bottom drawer held, in chrome that costs nothing when closed.

## Why this shape and not the others

| Alternative                                                                                | Why not                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Keep two columns, restyle** (the 2026-08-16 deck)                                        | It is the rejected page. Four panels of near-equal weight is the failure the CTA literature names and the party games avoid by construction; shrinking one of them does not change which regions compete.                                                                                                                                        |
| **Dominant code box + a quiet list, as two separate controls**                             | Better than today, but it needs a code box AND a list search box - two inputs for one gesture, which is the opposite of the consolidation asked for. Merging them costs nothing because our codes are decidable.                                                                                                                                 |
| **Mode switch (Join / Host) that swaps one region**                                        | It hides a region that had been shown, which the persistent-layout law forbids, and it makes 29 of 30 visitors read a control whose other half is never for them. Zoom's four equal slabs are what mode-parity looks like when it is taken seriously. The good half of the idea - hosting is disclosed, not laid out - is adopted as the button. |
| **A compact list with search and filters as the page's spine** (the server-browser answer) | It makes browsing the primary act. Our list is empty by default, and the industry moved browsing off the front screen for the same usability reason. The list earns a region, not the spine.                                                                                                                                                     |
| **Jitsi's pure single field** (type a name to create or join)                              | Creating a room has settings - listing, password, cap, title - and a field cannot ask for them. Ambiguity is affordable for Jitsi because a wrong guess makes an empty meeting; for us it would silently publish a room.                                                                                                                         |
| **Per-character code boxes, autofocus, auto-submit**                                       | Each breaks something concrete: paste and autofill, the page for anyone who came to read, and the person whose fifth keystroke was a typo.                                                                                                                                                                                                       |

## What this keeps, unchanged

- **The code box wins** when a complete code is typed - now stated by the list stepping back and by the verdict line naming what will happen.
- **Rejoin memory** leads the page, as a slim strip above the counter: first in reading order, small in weight, gone entirely when this tab remembers nothing.
- **Create is first class** and ends in the host console, with the "created but not listed" hold intact.
- **No accounts anywhere** (guiding principle 3): the counter asks for a code, never for an identity.
- **Tokens only**, board materials, all four presets, and both laptop and phone as first-class layouts.
- **All four listing x entry combinations**: listed open (card, one tap), listed locked (lock badge, in-card prompt), unlisted open (code, no password), unlisted locked (code, password revealed by the code).

## What is deleted

The masthead hero (eyebrow, display-size wordmark, lead, supporting line, and the three-fact strip), the three "pillars" marketing band, the bottom developer drawer (its content moves into the gear menu), the numbered panel headings ("01 Join a room", "02 Create a room", "03 Public rooms"), the standing password field beside the code box, the separate rejoin panel heading block, and the per-panel ledes that explained regions that no longer exist. Nothing is redirected or kept behind a flag - the no-legacy directive applies (docs/research/00-user-directives.md).

## Consequences

- `front-door.svelte` becomes a composition of a masthead strip, the counter and the list region; the create form and the room list keep their own components, and the rejoin panel becomes a strip rather than a panel.
- Filtering is a pure function over the listing (`room-filter.ts`), tested independently of the screen, so "what a typed string does" is a data question rather than a template question.
- The reflow gate (`front-door.layout.gate.test.ts`) grows to cover the counter's reserved verdict block and the masthead's height ceiling; the deletion assertions (no `/lobby`, no removed copy) stay and gain the copy deleted here.
