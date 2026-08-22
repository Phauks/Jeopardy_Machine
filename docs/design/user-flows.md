# User Flows

> 2026-08-13 · Pre-M0 design audit.
> Honest status: research round 1 covered _fragments_ (join-flow UX patterns in 05-ui-design.md, the host's moment-to-moment loop in 01-game-anatomy.md §8). This document is the first complete end-to-end design of the three journeys. Screens named here are the canonical route/screen vocabulary for the codebase and all future docs.

Two fundamentally different populations, one hard rule between them:

- **Guests (players)**: phone, zero friction, zero accounts, zero reading-the-manual. They scan a code and play. The app must be _boring_ to them in the best way - it never asks for anything.
- **Creators/hosts**: desktop-first, invest time days before the event, run the room on the night. They get the depth (editor, settings, themes, host console) - organized so the first game requires none of it.

---

## Flow A - Guest player (phone)

### A1. Arrive

Big screen shows QR + short URL + room code (e.g. `play.<domain>/BQKX7`, code `BQKX7`).

- Scan QR -> lands directly in the room's join screen. Typing the URL manually is equivalent.
- **No app install, no account, no cookie banner** (no tracking, session-scoped storage only).
- Room full / game over / bad code -> clear friendly error, not a spinner.

**Alternative arrival: browsing the lobby** (added 2026-08-14, docs/decisions/2026-08-14-room-visibility-and-lobby.md; split across two routes 2026-08-15). The site root `/` carries the room-code box and a link to `/lobby`, which lists live **public** rooms (title, host label, players/capacity, phase badge, age). Rooms are **private** by default, so this path exists only for hosts who opted in; the QR/code flow above is untouched and remains the primary one.

- **The code box always wins**: a complete typed code bypasses the list entirely (someone holding a code came to use it, not to browse). The list dims while a code is typed.
  **ALL SCORING IS MANUAL** (owner, 2026-08-20). A host with a microphone judges every answer in this room, and the only verdicts the engine ever applied on its own were the ones a clock produced - so it produces none. An expired answer window is information ("over time") and nothing else: no score moves, nobody is locked out, the same buzz winner still holds the floor. The answer clock may also be turned **off entirely** (`buzzing.answerWindowMs: null`), which draws no countdown anywhere. Matrix row 18 ("deduct on answer timeout") left the registry with this change, since it asked what a timeout costs and a timeout now costs nothing by construction.

**A room may start with nobody in it** (owner, same day). The engine's `nobody-joined` refusal was guarding a shape it turns out not to need, and it cost a host rehearsing before the doors open, or running the board while people arrive. The console warns once and starts; people arrive into the running game by late join (#43).

- **There is no second door.** A room carries no password (docs/decisions/2026-08-20-no-room-passwords.md, 2026-08-20): the code is what admits people, and a room that should not admit strangers is private rather than locked. A phone that reaches a room is in it.
- **A room in progress** shows "Playing" and is dimmed - whether it actually accepts an arrival is the late-join setting's business, answered by the room itself, not by the list.
- The list is a **browse surface, not a live room**: it polls, it is briefly cached, and it is capped (pagination deliberately deferred). A stale row can never open a dead room - the room refuses.

### A2/A3. The pre-game screen (ONE surface, still <15 seconds to play)

**Amended 2026-08-16, and this reverses the 2026-08-15 amendment above it.** The journey was specified as one screen, split into two (character, then team) because the identity half was being squeezed, and then had the A3 lobby behind it as a third. That chain is what the standing UI law now forbids outright (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md): _"state changes in place; it does not swap screens ... No wizard chains ... Nothing that has been shown gets hidden by a later step."_ Splitting the screen was the right diagnosis of a real problem and the wrong cure - the identity half needed ROOM, not its own page, and on anything wider than a phone there was room for all of it side by side the whole time.

So A2 and A3 are one surface with three regions, all present from the first paint, none of which can hide another. The old stage function is gone; `playerSurfaceFor` (apps/web/src/lib/room/pre-game.ts) now answers only pre-game or buzzer.

**The character region.** The animated walk-cycle preview (it moves - the identity moment), name with a live `17/24` counter, the avatar grid with accent swatches, the skin-tone row for the human models, and pick-your-buzzer-sound (tap to preview locally). Validation inline: length, profanity filter (host-toggleable), duplicate names get an auto-suffix. The accent tints the CHARACTER, not the backdrop behind it.

The region does not change when you take a seat; only what its controls mean changes. Before joining they edit a local draft that travels with the join. After joining the identical controls write straight through to the room, which is what replaced the old post-join "identity sheet" modal - a modal being, precisely, a surface that appears and then takes itself away.

**THREE SEATING MODES, not two** (owner, 2026-08-19; rules matrix row 34). `individuals` - no teams exist. `teams` - everyone plays for a shared team score, and anyone still teamless at start-game is seated as a team of one. `mixed` - teams exist AND playing solo is a legitimate final answer, so a room can hold three couples and two people who came alone without inventing a team for either of them. Every surface asks one of two questions rather than comparing the mode: `teamsAreOffered` (draw the team machinery at all) and `teamsAreRequired` (is a teamless player unfinished, or a soloist). Mixed is the only mode where those two disagree, which is exactly why the old boolean could not express it.

**The teams region** (teams and mixed rooms; individuals-mode rooms get the region saying so, never a hole). Live before you have a seat, so you can see who is on which team while you are still picking a name - only the actions wait for the seat. It holds the staged lobby with the holding area, the team cards, and real team management for players:

- **Join** a host-premade or already-created team: tap its station in the staged view, or its card. You walk across and board it, visibly.
- **Move** to a different team after joining: every other card keeps its button, reading "Move here". One message, so the room never sees you briefly teamless.
- **Create**: "start a new team", offered whether or not you already have one (creating a team makes you its **leader** - see "Teams & leadership" below).
- **Rename** (leader) and **leave**, both in place, both behind the team's "..." with lock, per the overflow rule.
- An unteamed player is still seated as a solo team of one at start-game. There is no longer a "play on my own instead" button, because there is no team screen left to escape from - staying in the holding area IS the choice, and the region says so.

**The room region.** Who is here, the live roster with still chips, the explicit waiting state ("Waiting for the host to start"), and buzzer practice - a disarmed demo button whose press plays _local_ feedback only, never room sound. Host may run an official sound check (see C3).

On join: session token minted and kept in `sessionStorage`; wake-lock requested; phone registered in lobby.

**On a laptop** the three regions are three columns and the whole thing is visible at once; on a phone they are one scrolling column in that order. Every region reserves its space, so a roster arriving or a refusal appearing moves nothing else (held by apps/web/src/lib/room/pre-game-layout.gate.test.ts).

A mid-game arrival sees the same surface - they pick a character exactly like everyone else did - and lands on the buzzer once seated, since their engine seat is created on join.

### A4. In game - the phone mirrors room state

The buzzer screen is a single fixed layout (no scrolling, no zoom, no pull-to-refresh) with a status strip, the buzz area, and a score strip. States:

| Room state                 | Phone shows                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Board (someone picking)    | Scoreboard + "**Maya** is picking..."                                                                          |
| Clue being read            | The buzz button, visually _cold_ + "wait for it..." (buzz text NOT shown by default - listening beats reading) |
| **Armed**                  | Button goes hot (theme accent, subtle pulse). Tap -> instant local flash + haptic, server confirms             |
| Buzzed, room deciding      | The same button, held: "BUZZED", pulse dropped. The room ranks the field for up to a quarter second            |
| You won the buzz           | Full-screen "**YOU!** Answer out loud" + 5s ring timer                                                         |
| Someone else won           | "**Maya** buzzed" dimmed screen                                                                                |
| You buzzed early           | "Too soon" + 0.25s lockout ring (the penalty made visible = teachable)                                         |
| Judged                     | Score delta flash (+$400 green / -$400 red) then back to board state                                           |
| Daily-Double (yours)       | Wager pad: slider + numeric entry, min/max computed and shown, "true DD" shortcut button                       |
| Daily-Double (not yours)   | "**Maya** found the Double Down! Wager: hidden"                                                                |
| Final round                | Category -> wager pad (deadline bar) -> clue + typed answer field + 30s bar -> "locked in"                     |
| Between rounds / game over | Scoreboard; game over adds placement + "thanks for playing"                                                    |

### A5. The unglamorous 80% - failure & edge handling

- **Phone sleeps / app backgrounds** (constant at real events): on visibility regain, WS reconnects with session token, state snapshot restores the exact screen - including its CLOCKS, since the snapshot carries every running countdown as remaining ms (M6): a phone that slept mid-answer comes back to a bar that is still draining, not a frozen one, and one that slept through the arm is sent the open `arm-window` so it can still race. Target: invisible within 2s.
- **Accidental refresh / tab close+reopen**: same token in `sessionStorage` -> seamless resume (live since 2026-08-17: `rememberSessionToken`/`recallSessionToken` in `src/lib/lobby/join-hand-off.ts`, and the browser suite reloads a mid-lobby phone to prove the room still counts one of them, not two). New tab on same phone: token is per-tab; joining again as a new player is prevented by a room-side device hint (best effort, host can merge/kick regardless).
- **Wi-Fi blip**: thin "reconnecting..." banner; buzzing disabled while stale (never let a player _think_ they buzzed); auto-recover. Wired 2026-08-17 (`ws-room-store.svelte.ts`): a drop that is not a 44xx walks a fixed backoff ladder (0.5s to 15s, last rung repeating - a phone in a pocket over a coffee break must still come back) and re-presents the session token, so the room hands back the same seat and the snapshot restores the screen. The pre-game screen carries the banner; a 44xx never retries, because the room already said no.
- **Late joiner**: allowed by default (setting), enters at current state with score 0; host can gift a starting score (score override exists anyway).
- **Player leaves / phone dies**: roster marks them away after missed heartbeats; game NEVER blocks on an absent phone (Final round: missing wager = auto 0 at deadline; host sees who's outstanding).
- **The host kicks/renames**: takes effect immediately, phone shows a polite screen. The wire says which polite screen: `room-closed` carries `kicked` (this phone only), `host-closed` (the host ended the room for everyone), or `expired` (the room aged out) - the client shows copy per reason, never a generic disconnect.
- **The host pauses**: `set-pause` freezes the room; every running timer keeps the time it had left and resumes with it, so a break never expires the clue somebody was mid-answer on. The display shows "one moment", phones show the same.

### A6. After

Final standings stay on the phone. Nothing to uninstall, nothing retained beyond the session. "Same room again next week" = same flow, 15 seconds.

---

## Flow B - Creator (desktop, days before)

### B1. First contact

Landing = **Library** (localStorage-backed in phase 1): Games · Content packs · Themes, plus "New game" and "Import". Empty state carries a 60-second sample game to poke at ("play it solo right now" -> rehearse mode) - the product demos itself.

### B2. Author (the editor)

"New game" -> mode: Jeopardy (only, for now) -> board editor.
Two authoring paths, same result (owner's content-portability directive):

1. **Type straight into the grid** (fast path): click a cell, type clue + answer, tab onward. Content items are created implicitly in the game's own pack.
2. **Compose from library**: side panel lists existing content items (search by tag/difficulty); drag onto cells. The event's 105-clue pool enters here via one import.
   Media: drag image/audio onto a cell -> uploads (R2) with size caps validated client-side; preview inline. _(Local-only editing keeps media as pending-upload references; see Open Questions #3.)_
   Board-level tools: category rename inline, value-scheme picker, DD placement (auto-weighted / uniform / manual), Final clue slot, round tabs (R1/R2/Final).

### B3. Configure

Settings panel is **progressive disclosure**: preset first (TV rules / Casual party / Custom), the full 42-setting matrix behind "Customize" with the defaults column pre-filled. Team mode + join options here. Theme: preset picker with live board thumbnail (customizer in M7).

### B4. Validate & rehearse

- **Lint panel** (always visible count, click to expand): empty cells, missing answers, unused media, DD on empty cell, Final missing, contrast warning if themed oddly.
- **Rehearse mode**: play the full game solo, keyboard-driven, engine-real (this is M2's hotseat page productized). The creator discovers pacing problems Tuesday, not live on Friday.
- **Print pack**: host cards (clues + answers ordered), answer key.

### B5. Keep

Autosave to library on every change. Export = versioned JSON (game definition + embedded pack) or zip-with-media bundle. Import accepts both + CSV. This is also the backup story ("I lost my work once" - never again: export nag on first completed board).

---

## Flow C - Host (game night)

### C1. Setup (arrive 15 min early)

Laptop -> Library -> game card -> **"Host this game"** -> room created (DO spun up, code allocated).

**The console asks one question, once: how does the room see this game?** It is a per-device choice (`screenSetup`, src/lib/host-settings/device-preferences.ts) with two answers and a first-class action attached to each - not two unrelated features, which is what it was until 2026-08-19 (owner: "mirror mode only works when it is the display, but when not in mirror mode, we need a way to generate the screen that will be used for the gameplay").

- **Second screen** (the default, and the common venue): the projector or TV is another output of this laptop. The console's **"Open game screen"** opens `/room/BQKX7/display` as its own popup window - 16:9, named per room so a second press reuses it rather than littering the projector - which the host drags across and fullscreens. The console then SAYS what it knows: game screen open / was closed / none open, in the lobby panel and as a chip in the header in every phase after it. A pop-up blocker is reported, with the URL to open by hand. Console and display remain independent clients of the same room - a display crash never touches the game, reopening restores it instantly, and closing the console never closes the display. (Casting the display window via Chromecast/AirPlay works the same way.)
- **Mirror this screen** (C1b below): this laptop IS the projector, so there is nothing to open.

**Starting without a game screen warns once, and never blocks.** A room whose projector shows a desktop starts perfectly well and nobody sees it (found by the 2026-08-16 host-loop walk); pressing **Start game** in that state says so and offers "Start anyway", because a small room run off a single laptop is a legitimate setup. An EMPTY room is the different failure: the engine has nobody to seat, so Start is refused with the reason on the button.

### C1b. Mirrored single-screen setups (owner-specified 2026-08-13)

Not every venue gives the host an extended desktop - sometimes the laptop screen IS the projector (mirrored), so whatever the host sees, the room sees. This is the second answer to C1's question, chosen in the same control (and forced for one render by the `?mirror` link):

- Toggling mirror mode reshapes the console into a display-first layout: the board/clue fills the screen exactly like the public display, with host controls reduced to a slim, unobtrusive dock (arm / correct / wrong / no-takers / undo) that is acceptable for the room to see.
- **Answers never render on a mirrored screen.** The private layer (per-clue correct responses, DD locations, wager amounts in progress) moves to one of: (a) the **host companion view** - a phone-sized route the host opens on their own phone, joined with a host token, showing exactly the private layer synced to the current clue; or (b) the **print pack** (flow B4) as the low-tech fallback.
- Keyboard shortcuts still work in mirror mode (the dock is for visibility, not the only input).
- Mirror mode is a per-device choice (like audio routing), not a room setting - a co-host on a second laptop can run the full private console simultaneously.
- **It is entered from the console's own chrome** (owner-specified 2026-08-17): a labelled toggle in the header showing its state, the same switch as the cog's and the dock's. It began as a URL query, which is not a control anybody can reach at the moment they discover the projector is mirroring their laptop. `?mirror` survives as a way to OPEN a console already mirrored - it seeds the device preference rather than overriding it, so leaving works from any of the three. Since 2026-08-19 it is one half of `screenSetup`, the single question C1 asks about how the room sees the game.

### C1c. The cog (owner-specified 2026-08-16, shipped)

One settings panel on the console, opened **in place** - a rail beside the console, never a screen, so the board, the clue and the judge row stay live and keyboard shortcuts keep working while it is open (the persistent-layout law).

It has two halves and says which is which, because the difference is not cosmetic:

- **This device** - local, instant, stored on this laptop, invisible to everyone else: **display text size** and **console text size** as independent controls (a projector is read across a room, a console at arm's length - the same slider for both is the wrong control), room audio here plus master volume, **how the room sees this game** (second screen / mirror - C1's one question, also asked on the console's game-screen panel where the action lives), manual mode, timer visibility, roster density, and stage motion (moving / still / no 3D).
- **This room** - server state, broadcast to every connection: streamer mode (with the code reveal, which lives here and nowhere else), listing + title, the two caps, spectators allowed.

The display type scale reaches the projector window of the same browser live, because both windows read one device-preferences document (C1's laptop-plus-projector setup is two tabs of one origin). A projector driven by a different machine has its own, which the panel says.

**The panel is not themed, and that is a rule** (owner-specified 2026-08-17: "settings show the theme assets, which makes them difficult to read"). A control panel is never painted by the thing it controls - the cog steers the type scale a theme renders at, so rendering the cog IN that theme put its labels in the board's poster faces at whatever contrast the theme chose. The panel's chrome is a fixed palette under every theme, present or future; only the type-scale PREVIEW is themed, because it is a picture of the display and is supposed to look like one.

**Room settings that are TYPED wait for an Apply, and say so.** Switches (streamer mode, listing, spectators allowed) reach the room the moment they move; a title or a cap being typed must not travel letter by letter, so those groups state the edit they are holding ("player cap 30 -> 24") beside a button that names its effect and is dead until there is one. "Save caps" - a button named after itself - was the version the owner could not read.

### C2. Doors open

Game screen shows the themed title screen + giant QR + code. The console has its own **join panel**, open in the lobby by default and reachable from "Join info" in any phase - a rail beside the console, never a page (the persistent-layout law), so the roster keeps filling behind it:

- the **room code**, set in the board's value face at a size a room can read off a laptop screen;
- the **QR**, drawn large enough to scan from a few feet, and again at `min(46vh, 46vw)` in the **"Show fullscreen"** state - the same panel growing to fill the screen (plus a best-effort Fullscreen API request) for holding the laptop up to a room;
- the **join link**, with **Share link** (the Web Share API first - the phone-to-phone path into a group chat, and the only one that reaches somebody who is not in the room) and **Copy link**, falling back to the clipboard and finally to "read the code out instead". The shared text carries the link AND the code, because the two fail differently.

**Streamer mode's boundary is the opposite here, deliberately.** `hideJoinCode` means "stop broadcasting the code on SHARED surfaces": the game screen drops the code, the QR and the join URL from its markup entirely. The console is the host's own private screen - it already shows every answer - so it KEEPS all three and says out loud that they are not on the big screen. Hiding them there would protect nothing and would leave a streaming host unable to admit a latecomer.

**The roster panel** (owner-specified 2026-08-17: "show all player data, so host can force renaming of teams, names, kicking, etc. Also show spectators") is a section of the left host dock, open by default in the lobby and collapsed once a game is running with its count still on the header - never a screen the host leaves the game for (the persistent-layout law). It carries:

- **Every player**: avatar, name, team, the score they are playing for once the game is running, and two facts added 2026-08-20 - a connection SYMBOL (a dot that is hollow when away and filled when here; colour and shape together, with the sentence in the title and for screen readers, because a colour alone is never the whole answer) and **phone or computer**, reported by that client from its own coarse-pointer query rather than sniffed from a user-agent string. A device nobody reported renders as nothing; a disconnected seat reports none, because nobody knows what they will come back on.
- **Every team**: members with the leader marked, colour, lock state, and the team's room-audible buzz sound.
- **The audience, counted AND named** (owner, 2026-08-20: "spectators still should have a name"). Watching used to be strictly anonymous, and the reasoning behind that was about the LOBBY, where a browsable list must never become a directory of people - a rule that has not changed. Inside a room the calculus is different: these are colleagues who chose to watch, the host is the only person who sees the list, and "12 watching" cannot answer whether the person the host is waiting for has arrived. A name stays optional, so the COUNT remains the authority on how many and the list can legitimately be shorter than it. A console that has not been told the count says so rather than printing zero.
- **Host powers, behind each row's "..."** (the same overflow rule the team cards follow): rename a player, move them between teams or off one, hand a team's leadership over, rename or lock a team, and remove somebody from the room - which asks a second time, because it ends their evening. Host supremacy holds throughout: a locked team still admits the host's seating, and a host rename is neither rate-limited nor blocked by the armed-window lock.

The console's lobby is then two panels, each owning its own facts: **Game screen** (the setup choice, the window state, the room's display census) and **Roster** (who is here by name, connection health, teams, spectators - detailed below). The old "Pre-flight" checklist was deleted 2026-08-19 (owner: "pre-flight and roster look the exact same, what was the benefit?") - it restated counts the roster already showed and printed the display URL as a hint. One place per fact; **Start game** moved into the console's chrome as an action with its readiness attached. Team drag-to-rebalance and rename/kick from the console remain to do.

### C3. Sound check (optional, 60 seconds, worth it)

Console button: "Buzzer check" - arms all buzzers in a no-score dry run; each first press plays that player's buzz sound through the display and lights their name. Confirms audio, teaches the arm rhythm, burns off the first-buzz jitters.

### C4. The loop (per clue - each step is one tap/keypress)

Console is keyboard-first (spacebar = arm, ←/→ = wrong/correct, U = undo) with giant touch targets as equals.

1. Board on both screens; console highlights **who has control**. Tap the cell the controlling player calls.
2. Clue fills both screens (console also shows **the answer**, host-only). Host reads aloud.
3. **ARM** (spacebar) - the one sacred button.
4. Winner announced on display + their sound; console starts the 5s ring automatically.
5. **Correct** (score, control passes, clue closes) / **Wrong** (deduct, lockout, auto re-arm for the rest) / **No penalty**. Rebound continues until correct or **No takers** (reveals answer on display, control unchanged).
6. DD path: splash + sting -> wager arrives from the player's phone (console can type it on their behalf) -> reveal -> judge once.
   Always available: undo stack, score override, reopen clue, skip, pause (freezes all timers + display shows "one moment").

### C5. Round transitions & Final

- End of R1 -> interstitial scoreboard -> R2 board (selection auto-passes to lowest score).
- **Final wizard** (linear, cannot be done wrong): eligibility list (auto, with host override to include the excluded) -> category on display -> wager collection (progress bar per player, deadline, missing = 0) -> clue + 30s music + typed answers -> reveal one by one, lowest-first, host judging each -> winner screen. Batch-reveal mode kicks in above the size threshold (rules matrix #33).
- Tie -> configured resolution (co-champions default / sudden-death clue).

### C6. When it goes wrong (it will)

- **Host laptop dies**: room state lives in the DO, not the laptop. Reopen console URL on any device -> full resume. (Hardening in M6; the architecture guarantees it from M3.)
- **Venue Wi-Fi dies**: phones auto-rejoin on recovery (A5); if it's truly dead, the host falls back to hands-up - and the console still works as scoreboard via phone hotspot. Degrade gracefully, never brick the night.
- **Projector/display loss**: the console notices ("Game screen was closed") and offers **Reopen game screen** - it restores from room state, since the display holds nothing of its own; meanwhile the console alone can carry a small room.
- **Disputes**: undo + override + reopen-clue are the escape hatches for every judging argument.

### C7. After

Winner screen (podium + per-team totals). Console: export results (JSON/CSV: final scores, per-clue log). Room expires via DO alarm (default 2h idle); code becomes reusable.

**Two endings, and they are not the same one** (owner, 2026-08-20: "there is no end game button for the host"). The console's **End** control shows both together, with what each leaves behind written beside it, because the mistake to prevent is picking the wrong one:

- **End the game** stops the GAME where it stands and puts the scores up. The room stays open, nobody is disconnected, and the display shows final standings. It is the ending a quiz night that has run long actually needs, and until 2026-08-20 it did not exist - the only route to `game-over` was playing the board out, since `end-round` finishes a round and leaves whatever comes after it still ahead. It does not run the tie rules: a host who is stopping is not asking for one more clue, so a tie for first stays a shared first (engine `handleEndGame`).
- **Close the room** stops the ROOM: the polite screen everywhere, the lobby row delisted, the code spent until the expiry alarm frees it. It computes nothing and saves nothing, so taking it mid-game leaves the night with no scores on any screen. It existed as `DELETE /api/rooms/<CODE>` and a button on the developer harness; now it is where a host can reach it.

Each takes a second press, and the second press names the ending it commits to rather than saying "Confirm".

---

## Teams & leadership (owner-specified 2026-08-13)

Two customization tiers that never collide:

| Tier         | Who controls | What it covers                                                                                                                                                                                                                                                                |
| ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Team**     | Team leader  | Team name, team color (picked from the player-accent palette - docs/design/theming.md "Player accents and avatars"), **the team's room-audible buzz sound**, team lock (no new joiners), future team-level options (e.g. designated-buzzer rotation)                          |
| **Personal** | Each player  | Own nickname, personal avatar/accent, **skin tone** for the human models, personal buzzer sound - always visible _within_ the team display, so every player keeps an identity marker showing where they are (e.g. team-color card bearing each member's personal avatar chip) |

**Skin tone (owner-specified 2026-08-16).** The Mini Characters carry a curated tone axis alongside the accent, recoloured through the same palette mechanism. Three rules, all load-bearing: it is an **explicit choice**, never inferred from a name, an avatar, or anything else; the default is **neutral**, meaning the pack's own colors and not a tone the product picked; and it is offered **only for the human avatars**, because the pets have no skin cells and a control that silently does nothing would be a lie. The set and the reasoning behind its numeric labels live in tools/avatar-bake/src/skin-tone-palette.mjs.

**Buzz sounds are team-scoped in team mode (owner-specified 2026-08-13).** The room-audible buzz-in sound belongs to the team tier: the leader picks it, and when any member wins the buzz the room hears the _team's_ sound while the display shows the team name/color - a **double confirmation** (audio + visual) of who has been selected. One sound per team is learnable by the host and crowd; per-player sounds at 20 teams x 5 members would be noise. Personal buzzer sounds still exist: in individuals mode they ARE the room sound; on a team they play **locally on the buzzing player's own phone only** as private feedback. In MIXED mode both are true at once, per player: a soloist's own sound is the room sound, a team member's is private and the team's is heard. The display may additionally show _which member_ buzzed, small, under the team name - identification without audio clutter.

**Post-join customization (owner-specified 2026-08-13; how it is reached amended 2026-08-16).** Joining is not a one-shot identity commitment. There is nothing to reopen any more: the character region is simply still there after you join, with the same controls, now writing straight through to the room. The "tap your own chip to open a sheet" affordance and the sheet itself are gone - a modal that appears and takes itself away is the thing the persistent-layout law exists to stop. Leaders edit team name and lock in place on their own team card, behind its "...". Changes apply immediately and sync everywhere. Guardrails unchanged: name changes are rate-limited (anti-confusion, not anti-fun), and identity edits are locked during the brief armed/answering window so the display never relabels mid-adjudication.

**Leadership mechanics:**

- Creating a team makes you its leader (crown affordance on your card). Host-premade teams: leader = first joiner, until changed.
- Leader powers, all from the pre-game screen's teams region: rename team, pick team color + team buzz sound, **kick** members who don't belong, **hand off leadership** to any teammate (explicit tap -> confirm; role moves instantly), and **lock** the team. **Kick and hand-off live behind a per-member "..." overflow menu, and rename, lock and leave behind the team's own "..."** (owner-specified) - destructive/administrative actions are one deliberate tap away, never exposed as always-visible buttons next to a teammate's name or as a switch on the card. Rename opens an inline field on the card itself, keeping the card where it was.
- Kicked players return to the holding area (they may join another team; rejoin of the same team is possible unless the leader locks the team - lock is the anti-nuisance tool, not a ban list). This needs no code path of its own and no longer moves them to a different screen: their `teamId` goes null in a region that never went away.
- **Leader disconnect**: after a grace period (missed heartbeats), leadership auto-passes to the longest-tenured connected member; if the original leader returns they rejoin as a regular member.
- **Host supremacy is unchanged** (guiding principle 4): the host console can rename/kick/merge/reassign leaders over any team decision, and sees a feed entry for kicks (abuse visibility). Team self-governance reduces host workload; it never gates the host.
- Personal customization is never leader-editable; team customization is never member-editable. The tiers are separate protocol fields (team doc vs player doc in room state, modeled in M3, surfaced in M5 team mode).

## Cross-flow notes

- **Same person, two hats**: the creator IS the host at our events. The seam is "Host this game" - everything before it is calm desk work, everything after is showtime. Design vocabulary keeps them distinct: _editor_ vs _console_.
- **Roles are explicit in the protocol** (M3): `host | display | player | spectator` - multiple displays allowed, co-host consoles possible later (a second judging phone is a real event request we get for free from this).
- **The 100-player question**: buzz-race with 100 solo players is legal but socially poor; the flows above assume teams at that scale (20 teams x 5). Everyone-answers mode (M7) is the true 100-solo answer. Host guidance in docs, not a hard gate (boundary 2.7 caps the room, not the fun).

## Open UX questions (tracked here on purpose)

Resolved by owner 2026-08-13:

1. ~~No-phones fallback~~ -> **Ship it (M4)**: "manual mode" - no buzzers, host awards points from the console ("award to..." on each clue). Also doubles as the total-Wi-Fi-failure fallback in C6 and makes the suite usable for classrooms/pubs with zero player devices. Board + engine + console only; the room simply has no player connections.
2. ~~Late-join score policy~~ -> **Flexible (a setting)**: `late-join score` = start at 0 (default) / match lowest current score / host is prompted per joiner. Host score override remains the universal escape hatch. Joins the rules matrix as setting #43.
3. ~~Audio routing~~ -> **Selectable**: every connected room client (display, console, future spectator) has a local "play room audio here" toggle; default on for the display, off elsewhere. Multiple devices may opt in (e.g. console near the host + display speakers). Client-side toggle, no server routing logic - cheap, as suspected.

Still open:

4. **Clue text on phones**: default off in-room (listening > reading ahead); the setting exists for remote/accessibility. Confirm default with first playtest.
5. **Media in local-first editing**: boards edited offline reference media that hasn't uploaded. Proposal: media pends locally (IndexedDB) and uploads on first "Host this game" with connectivity. Decide in M1.
