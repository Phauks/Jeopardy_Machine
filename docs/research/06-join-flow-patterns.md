# Join-flow patterns: how comparable products get someone into a session

> 2026-08-18 · research for the front-door rebuild. Companion decision: docs/decisions/2026-08-18-front-door-architecture.md.

## Why this document exists

Two front doors have been rejected by the owner. The second attempt answered "reorganise how public rooms, joining a room and private rooms combine" by deleting copy and shrinking the masthead, which is a styling answer to an information-architecture question. This document collects how other products solve the same problem before any markup is written, and - the part that matters - separates the patterns that transfer to us from the ones that do not.

Our problem is specific, and it is what makes most of the borrowed answers partial: **three audiences arrive at the same URL**.

| Audience        | Arrives with                               | Wants                                      | Frequency                             |
| --------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------- |
| **The player**  | A 5-character code on a projector, or a QR | To be in the room in one action            | ~30 people per game night, the mass   |
| **The browser** | Nothing but curiosity                      | To see whether anything is on, and walk in | Rare, and usually finds an empty list |
| **The host**    | An intention to run a game                 | A room, and to land in the host console    | One person per game night             |

The listing default is `private` (docs/decisions/2026-08-14-room-visibility-and-lobby.md), so the honest expectation is that **the public list is empty most of the time**. Any layout that spends its best real estate on the list is spending it on the emptiest region of the page.

## The products, and the pattern each one actually uses

### Party games: the code IS the screen

| Product          | Entry screen                                                                                         | Primary actions on screen             |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Kahoot**       | kahoot.it is one centred field ("Game PIN") and one button. No hero, no marketing, no list.          | 1                                     |
| **Jackbox**      | jackbox.tv is a four-letter room-code field plus a name field, then PLAY. Nothing else exists.       | 1                                     |
| **Gartic Phone** | Landing page is a nickname plus **Start** / **Enter room**; private rooms are joined by shared link. | 1 (+1 subordinate)                    |
| **skribbl.io**   | Name + avatar, then **Play** (public matchmaking) with **Create private room** as a smaller button.  | 1 (+1 subordinate)                    |
| **Among Us**     | The online screen splits **Host**, **Find Game** (public browser with filters) and **Enter Code**.   | 3 - and it is the busiest of the five |

The lesson is not "copy Kahoot's minimalism" - Kahoot has one audience and we have three. It is that in every one of these, the code entry is **one real input at the visual centre of the screen**, and everything else on the page is smaller than it. None of them puts a marketing hero above the field. Among Us is the closest analogue to our problem, having the same three audiences, and it is also the one people complain about navigating; its saving grace is that the three doors are three big slabs rather than three forms.

Code-entry mechanics are consistent across all of them and worth copying exactly: a single input rather than per-character boxes (paste and autofill survive), input normalised to the code alphabet as it is typed, the action arming itself the moment the code reaches its length, and **no autofocus** on a page people also read - a soft keyboard covering the page is the cost.

### The server-browser lineage

| Product                | Shape                                                                                                             | Private / password treatment                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Minecraft**          | A saved-servers list, with **Direct Connection** as a peer button for an address that is in no list.              | No list entry at all - direct connect IS the private path                           |
| **Steam / TF2**        | A dense filterable table (map, players, ping, "has password", "not full"), tabs for Internet/Favorites/History.   | A lock column plus a "hide password-protected servers" filter                       |
| **Tabletop Simulator** | A server browser whose **search field filters the list by name**; picking a locked server prompts for a password. | Checkboxes: hide password-required, hide full, friends only                         |
| **Among Us**           | "Find Game" with filters (map, impostor count, chat type, language) over public lobbies.                          | Private lobbies are simply absent from the browser and joined by six-character code |
| **Board Game Arena**   | Table lists per game; "see all available tables" is pushed to the bottom of the lobby.                            | Private tables are invite-only and never listed                                     |

Two facts from this lineage matter more than the widgets.

**The browsable list lost its primacy across the industry, for reasons that apply to us.** Where server browsers were once the front screen, they are now "buried below a suite of matchmaking options" ([PC Gamer](https://www.pcgamer.com/custom-servers-arent-dead-but-this-decade-put-them-on-life-support/)); the shift is documented on [Matchmaking (video games)](<https://en.wikipedia.org/wiki/Matchmaking_(video_games)>). The usability half of that story is the half we should take: browsing is slower than being told where to go, and most people arrive already told.

**Filter chrome is priced by list length.** Steam's filter panel earns its height against thousands of rows and Tabletop Simulator's three checkboxes earn theirs against hundreds. Against the 0-5 rooms we will realistically list, a filter panel costs more than it returns - a lock **badge** on the row plus one small toggle is the whole of what scales down.

**A search field that filters a list is the standard control**, not an invention: Tabletop Simulator's browser is driven by typing a name into the search box and picking from what remains. That is the same gesture as typing a code.

### Meetings: the join / host pair

| Product         | Home screen                                                                                        | Note                                                                |
| --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Google Meet** | One row: **New meeting** button beside an **"Enter a code or link"** field with a Join action.     | Two actions, one row, and the code field is the wider of the two    |
| **Zoom**        | A 2x2 slab of Join / New Meeting / Schedule / Share Screen.                                        | Four equal slabs; the price is that nothing is primary              |
| **Jitsi**       | A single field that both **starts** a room and **joins** one - typing a name that exists joins it. | The most consolidated version of the idea, at the cost of ambiguity |

Google Meet is the cleanest published answer to "join or host on one line", and its code format (`abc-defg-hjk`, chunked for reading aloud) is a reminder that a code exists to be read off a screen by a stranger and typed once.

Jitsi is the extreme case of the consolidation the owner is asking for - one field, two outcomes - and its weakness is instructive: the field cannot tell "join the room called X" from "create the room called X", so it guesses. Our codes are a fixed length over a restricted alphabet, so **our field can tell the difference without guessing**, which is exactly the property that makes the unified control safe for us and unsafe for Jitsi.

### Communities and documents

**Discord** separates the two jobs completely: an **invite link** is how roughly 40% of members arrive and is the only way into a private community, while **Server Discovery** is an opt-in, criteria-gated browse surface that most servers never appear in ([Discord: clarifying server types](https://support.discord.com/hc/en-us/articles/14078261239831-Clarifying-Server-Types)). That is our listing model exactly: private by default, code as the real entry, listing as an opt-in extra. The server rail itself is an accounts feature and is unavailable to us by guiding principle 3.

**Figma / Notion** open onto recents rather than onto a create button, on the theory that returning to work in progress outnumbers starting new work. Our analogue is the rejoin memory - the same insight, one tab wide instead of one account wide.

### The omnibox, since that is one of the shapes under consideration

Browsers collapsed two fields into one because the input itself disambiguates: something that parses as a URL navigates, everything else searches ([SigmaOS glossary](https://sigmaos.com/tips/glossary/browser-terms-explained-omniboxaddresssearch-bar)). The pattern is safe **only** when the disambiguation is mechanical rather than a guess, and when the label says both jobs out loud ("Search Google or type a URL").

### The CTA literature, for the part that is not games

The conversion literature says by argument what the party games say by construction: one primary action per screenful, secondary options visually subordinate, and multiple equal-weight buttons in one view fragment attention and add decision friction. Our current front door presents four numbered panels of near-equal weight, which is precisely the failure mode named.

## The patterns, extracted

1. **One primary action per screen.** Everything that is not it must be visibly smaller, quieter, or later.
2. **The code field is a single real input**, normalised as it is typed, arming its action at the exact length, never autofocused on a page that is also read, never split into per-character boxes.
3. **The browsable list is the minority path** and gets minority space. It is not deleted - it is not allowed to set the page's proportions.
4. **One field can do two jobs when the input disambiguates itself**, and the label must name both jobs.
5. **Private is not a second door.** Discord, Among Us and BGA all make the private case the _same_ entry control with the listing simply absent. A lock badge on a listed room plus a code field for an unlisted one is the whole of the private/password story at our scale.
6. **Create is a peer button, not a peer form.** skribbl, Gartic Phone, Minecraft ("Add Server") and Meet all give hosting a button and open the form only when it is wanted.
7. **An entry screen's masthead is a wordmark.** None of Kahoot, Jackbox, Meet or Among Us spends vertical space on a hero above the entry control; the product pitch lives after the fold, or not at all.

## What applies to us - and what does not

| Pattern                                  | Applies here?                  | Why / why not                                                                                                         |
| ---------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| One dominant code field (Kahoot/Jackbox) | **Yes, as the page's spine**   | The player audience outnumbers the others roughly 30:1 per event and arrives with the code already in hand            |
| Single input, arms at length             | **Yes**                        | Already true of the code field; keep the mechanics, and stop making it share a row with anything                      |
| Omnibox (one field, two jobs)            | **Yes, and safely**            | 5 characters of `[A-Z0-9]` is a decidable test; a shorter or longer string is unambiguously a search                  |
| Search filtering the list (TTS)          | **Yes**                        | It costs no extra control once the field exists, and it makes a long list navigable without a second box              |
| Lock badge on listed rooms               | **Yes** (already built)        | The `public + password` combination has to be visible before the tap                                                  |
| One small "open rooms only" toggle       | **Yes - one toggle, no panel** | Serves the fourth combination without Steam's filter furniture                                                        |
| Host as a peer button + in-place form    | **Yes**                        | One host per event; a six-field form permanently on screen is the single biggest competitor to the code box today     |
| Recents-first (Figma) / rejoin           | **Yes, as a slim strip**       | Already decided (2026-08-16); it deserves to be _first_, not to be _big_                                              |
| Marketing hero above the field           | **No - delete**                | Four of our five party-game references have no hero at all; ours pushes the code box below the fold on a laptop       |
| Matchmaking / "Quick play" (skribbl)     | **No**                         | There is no pool of strangers to match into, and dropping someone into a stranger's quiz night is not a use case      |
| Steam-style filter panel                 | **No**                         | Chrome priced for thousands of rows, applied to a list that is usually empty                                          |
| Discord's server rail                    | **No**                         | An accounts feature; guiding principle 3 forbids the account it implies                                               |
| Lobby chat (Among Us)                    | **No**                         | Explicitly out of scope (2026-08-14 abuse posture: no free-text chat anywhere)                                        |
| A separate browse page (BGA, `/lobby`)   | **No - already reversed**      | Browsing and joining are the same act (2026-08-16); the answer to crowding is layout, not navigation                  |
| Jitsi's ambiguous single field           | **No, not in its pure form**   | Our field must never _create_ a room by accident; creation is deliberate and carries settings                         |
| Per-character code boxes                 | **No**                         | Breaks paste and autofill, announces five unlabelled fields, and loses characters to autocorrect                      |
| Auto-submit on the fifth character       | **No**                         | A mistyped fifth character would navigate away from the page; arm the button loudly instead and let the person commit |

## The one thing none of them has to solve

Every product above serves one audience per screen: Kahoot's join page never shows a host anything, and Steam's browser never has to be usable by someone holding a code. Our page serves all three at once, which means the answer cannot be "pick the best single-audience pattern". It has to be an ordering: **one control that the player's path runs straight through, that the browser's path can also use, with the host's path attached to it as a button rather than laid out beside it.** That ordering is the subject of the decision record.

## Sources

- [Kahoot: how to find the game PIN](https://support.kahoot.com/hc/en-us/articles/360000109048-How-to-find-Kahoot-PIN)
- [Jackbox: how do I join a game?](https://support.jackboxgames.com/hc/en-us/articles/15794759479959-How-do-I-join-a-game)
- [Among Us Wiki: filtering system](https://among-us.fandom.com/wiki/Filtering_system) and [private games](https://among-us.fandom.com/wiki/Private)
- [Minecraft Forum: Add Server vs Direct Connect](https://www.minecraftforum.net/forums/support/server-support-and/2106454-add-server-vs-direct-connect)
- [TF2 Wiki: Server Browser](https://wiki.teamfortress.com/wiki/Server_Browser)
- [Tabletop Simulator: joining a password-protected server](https://steamcommunity.com/app/286160/discussions/0/2860219962096012217/)
- [PC Gamer: custom servers aren't dead, but this decade put them on life support](https://www.pcgamer.com/custom-servers-arent-dead-but-this-decade-put-them-on-life-support/) and [Matchmaking (video games)](<https://en.wikipedia.org/wiki/Matchmaking_(video_games)>)
- [Board Game Arena forum: list of open tables](https://forum.boardgamearena.com/viewtopic.php?t=31184)
- [Google Meet: join a meeting](https://support.google.com/meet/answer/9303069)
- [Discord: clarifying server types](https://support.discord.com/hc/en-us/articles/14078261239831-Clarifying-Server-Types)
- [SigmaOS glossary: the omnibox](https://sigmaos.com/tips/glossary/browser-terms-explained-omniboxaddresssearch-bar)
- [Twilio: best practices for OTP input forms](https://www.twilio.com/en-us/blog/developers/best-practices/otp-input-forms-html) and [Baymard: input fields](https://baymard.com/learn/input-fields)
- [Brand Vision: landing-page layout principles (one primary CTA per screenful)](https://www.brandvm.com/post/landing-page-design-principles)
