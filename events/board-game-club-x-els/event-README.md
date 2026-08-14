# Event: Board Game Club x Environmental Law Society Night

> Assembled 2026-08-14 from docs/content/event-board-draft.md (curation contract), docs/content/event-content-pool.md (verified clues + full source notes), and docs/content/media-and-sounds.md (image picks + license worklist).
> Constraint honored: environment + gaming ONLY, nothing law-related.

## What is in this directory

| File                   | Format            | What                                                                                                                                                              |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event-pack.pack.json` | `content-pack`    | Every clue for the night: 60 board cells, the final plus 2 alternates, 25 bench swaps, 4 drop-in alternate categories (21 more items), 8 picture-round media refs |
| `event-game.game.json` | `game-definition` | The playable game: both boards in draft order, 3 authored Double-Down cells, Final A, inline house rules (casual base + event overrides), Terra Verde theme       |

Both documents open through `parsePortableDocument` (the `@jeopardy/protocol` public entry point) and are gate-tested by `packages/protocol/src/event-documents.test.ts`: every cell resolves to a pack item, bench/alternate items are present-but-unreferenced, media refs resolve, and the external pack link's sha256 matches this directory's exact `event-pack.pack.json` bytes.

**After ANY edit to `event-pack.pack.json`** recompute the hash and paste it into `event-game.game.json` -> `body.content.sha256`, or the gate test will fail (by design): `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('events/board-game-club-x-els/event-pack.pack.json')).digest('hex'))"` - and run `pnpm fmt` BEFORE hashing, since the hash covers the formatted bytes.

## How swapping works (the one-line-edit contract)

Every clue the owner might swap in already lives in the pack, tagged and unreferenced. To swap a cell: replace that cell's `itemId` in `event-game.game.json` with the bench item's id below, then (discipline, enforced by the gate test) move the `board`/`bench` tags between the two items in the pack. Items are also tagged with their pool id (`pool-a-1` etc., matching docs/content/event-content-pool.md) so you can grep either file by pool key.

Difficulties: board items carry `difficulty` = row (1-5); bench items map the pool tiers E -> 1, M -> 3, H -> 5.

All items ship `provenance: "ai-draft"`: the pool facts were web-verified by the content agent, but the owner has not yet approved each clue (the draft expects ~half to be rejected). Flip an item to `"human"` as the owner signs it off.

### Round 1 bench mapping

| Category (column)       | Board cells (top to bottom)  | Bench alternates (swap-in ids)                                                                                                                                                       |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Birds, Meeples & Eggs   | a-1, a-5, a-2, a-3, a-4      | n-84 `01a00137-5a8e-7600-b97c-83f8004347e8` (H) - new-a1 `01a00137-5a8f-7d2a-9521-c45d7f78d0bb` (M)                                                                                  |
| Games Gone Wild         | b-6, b-7, b-8, b-10, b-12    | b-9 `01a00137-5a95-7632-8707-93f237b60785` (H) - b-11 `01a00137-5a96-76d7-b693-5f4ffa10b546` (H)                                                                                     |
| Park Rangers            | g-39, g-41, g-40, g-43, g-44 | g-42 `01a00137-5a9c-7d51-94fa-73bfe3740d2b` (M, CONFLICT: duplicates img-04's answer) - g-45 `01a00137-5a9d-76e8-8662-c8e9736ca000` (M, must say "officially recorded")              |
| Animal Record Holders   | h-46, h-48, h-47, h-49, h-50 | h-51 `01a00137-5aa3-7b7a-aae9-5b5053af2294` (H, the designated h-49 replacement if Final B is chosen) - borrow j-60 `01a00137-5ae8-73ad-922b-b6fc4e74b754` if Weird Nature is unused |
| Before It Was Cardboard | l-71, l-69, l-70, l-73, l-74 | l-72 `01a00137-5aa9-764c-8e09-46ce53892cba` (H) - r-104 `01a00137-5aaa-7265-bdfc-80abd6335098` (M). Keep at most two of {l-73, l-74, q-102} in one game                              |
| Meet the Makers         | m-76, m-78, m-75, m-79, m-80 | m-77 `01a00137-5ab0-7e52-8676-094d700364bd` (M, only if Birds, Meeples & Eggs is cut) - n-85 `01a00137-5ab1-71c5-af50-42ffd48a2ba9` (H)                                              |

### Round 2 bench mapping

| Category (column)              | Board cells (top to bottom)            | Bench alternates (swap-in ids)                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Games in Spaaace               | d-20, d-23, d-22, d-24, d-21           | d-25 `01a00137-5ab7-7c5e-9c83-3353c6fa8f52` (H) - o-90 `01a00137-5ab8-7cfe-bd3d-ae99f94e6a9a` (H). Whole category conflicts with Final C                                                                                 |
| Press Start to Save the Planet | c-18, c-13, c-15, c-16, c-14           | c-17 `01a00137-5abe-7ea4-a103-196d05130a9e` (H) - c-19 `01a00137-5abf-7cbb-9c62-1fe87dfc6b8a` (E) - r-105 `01a00137-5ac0-7202-9a19-da2715ec844d` (M, near-duplicate of c-13: use one or the other)                       |
| Tree-mendous                   | f-32, f-33, f-34, f-35, f-36           | r-103 `01a00137-5ac6-7df4-bb97-6376caacd276` (E) - f-37 `01a00137-5ac7-7262-b313-5461ac0c195e` (H) + f-38 `01a00137-5ac8-7f2b-b1f5-fa6c51301a12` (H): RESERVED, never board these while Final A (Pando) is the final     |
| Back from the Brink            | i-57, i-55, i-52, i-53, i-56           | i-54 `01a00137-5ace-722d-b01d-63542686df3d` (M) - j-63 `01a00137-5acf-79d6-b8b6-db91f3ec6586` (M, same answer as i-53: only as its replacement)                                                                          |
| Legends & Landfills            | q-97, q-101, q-99, q-100, q-98         | q-102 `01a00137-5ad5-727b-b0aa-f63fce5bb5cc` (M, same Magie/Darrow arc as l-73/l-74: swap in only if those are cut from Round 1)                                                                                         |
| Name That Park (picture)       | img-01, img-02, img-03, img-04, img-05 | img-06 `01a00137-5adb-7456-bc28-1ef40742608a` (swap for img-01, same answer, CC BY-SA) - img-07 `01a00137-5adc-7a26-9782-6b257beb9f84` (Denali) - img-08 `01a00137-5add-717a-a379-366a1cddfc60` (Bryce Canyon, CC BY-SA) |

### Final round

| Slot        | Item                                           | Notes                                                                                                                                                                                       |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAYED      | final-a `01a00137-5ade-72c1-b43f-cdc63d8dea64` | "Superlative Organisms" -> Pando. Clean with this board: f-37/f-38 are deliberately benched so nothing spoils it                                                                            |
| Alternate B | final-b `01a00137-5adf-70bf-a41e-f7f067385791` | "Animal Longevity" -> Greenland shark. REQUIRES swapping h-49 off the Round 1 board (use bench h-51); update `final.category` too                                                           |
| Alternate C | final-c `01a00137-5ae0-7c21-93d1-2c3381b03d61` | "Games in Space" -> Tetris (owner's sentimental favorite). REQUIRES replacing all of Games in Spaaace with Video Game Firsts minus its space clues (o-89/o-90; backfill from p-91 and n-85) |

### Alternate categories (category-level swaps)

Value ladders are authored for Round 2 placement (difficulty 1-5 top to bottom); the tv value scheme prices rows automatically for either round, so boarding one in Round 1 needs no value edits.

| Alternate category    | Rows 1-5 (ids in pack, tag `alternate-category`) | Own bench                                         |
| --------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Gotta Catch Real Ones | e-26, e-31, e-27, e-28, e-29                     | e-30 `01a00137-5ae6-76cf-9396-36bb2c8b68d0` (M)   |
| Weird Nature          | j-58, j-60, j-59, j-62, j-61                     | j-63 (shared with Back from the Brink bench)      |
| Video Game Firsts     | o-88, o-89, o-86, o-87, o-90                     | backfill from p-91 + n-85 if both space clues die |
| Gaming by the Numbers | p-91, p-92, p-93, p-94, p-95                     | p-96 `01a00137-5af5-71eb-8c3b-dc1535b53bc6` (H)   |

Backup Double-Down cells if an authored DD's category is cut: j-58 (move to a deeper row if boarded), q-98, f-36 (board draft section 5).

## Pre-event checklist (run within a week of event night)

Volatile facts (all carry the `recheck` tag in the pack - grep `"recheck"` to enumerate them mechanically):

| Item (pool id)     | What to re-check                                                | Why                                                         |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------- |
| g-41 (R1 $400)     | Most-visited park + 12.2M figure                                | NPS publishes new visitation data annually; 2025 likely out |
| g-43 (R1 $800)     | Mammoth Cave mapped miles (426)                                 | Survey teams add miles every year                           |
| g-44 (R1 $1000)    | Old Faithful interval / prediction accuracy                     | NPS occasionally revises                                    |
| a-4 (R1 $1000)     | eBird origin phrasing                                           | Confirm exact interview wording                             |
| b-12 (R1 $1000)    | Terraforming Mars "ocean tiles" wording                         | Confirm against rulebook                                    |
| f-35 / f-36 (R2)   | Hyperion height (381.3 ft?) and closure/fine still in force     | Measurement + policy both changeable                        |
| i-55 (R2 $800)     | Minecraft blue axolotl odds (1/1200) if cited aloud             | Game updates change spawn logic                             |
| i-52 (R2 $1200)    | Vaquita count (~7-10 in 2025 survey)                            | Annual survey; most volatile number on the board            |
| i-53 (R2 $1600)    | Kakapo population (200+ / ~230-240)                             | NZ DOC updates after breeding seasons                       |
| g-45 (bench)       | Death Valley wording - must say "officially recorded"           | 2026 BAMS dispute                                           |
| p-91 / p-93 / p-94 | Minecraft 300M "single game", Catan total, GDQ $60M + charities | All sales/fundraising totals move (ALT-4 only)              |
| img-01..05         | Image files still live + licenses unchanged                     | Checklist section 5 of docs/content/media-and-sounds.md     |

Also before the night: download the five board originals (and any bench image being swapped in), fill the real `sha256` values (see schema friction note 2), and run the full license checklist (screenshot license sections into docs/content/licenses/, credits rows, downscale img-01 - see the media table's notes).

## Media acquisition status (verified 2026-08-14)

License classes: **PD** = public domain (no attribution legally required; credit NPS/USGS as courtesy). **BY-SA** = CC BY-SA (attribution + ShareAlike; credits slide mandatory if shipped).

Verification method this session: every file's metadata (existence, byte size, mime, Commons sha1, license, author) was pulled live from the Commons API, and direct-original URLs were HEAD-checked (status only - no originals downloaded). The upload.wikimedia.org CDN rate-limits this session's shared egress IP (HTTP 429, retry-after 600s), so some HEADs took retries; a 429 is a throttle, not a missing file - there were zero 404s, and every returned content-length matched the API byte count exactly.

| ID     | Subject -> answer                    | License class | Bytes    | URL status                                                     | Acquisition status                                                                                                  |
| ------ | ------------------------------------ | ------------- | -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| img-01 | Old Faithful eruption -> Yellowstone | PD (NPS)      | 37209547 | File page + API verified; direct HEAD 200                      | Needs download + MANDATORY downscale: original is 37.2 MB, over the 10 MiB image cap in `@jeopardy/protocol/limits` |
| img-02 | Half Dome -> Yosemite                | PD (USFWS)    | 659961   | File page + API verified; direct HEAD 200                      | Needs download; portrait crop check on 16:9                                                                         |
| img-03 | Delicate Arch -> Arches              | PD (NPS)      | 1539033  | File page + API verified; direct HEAD 200                      | Needs download                                                                                                      |
| img-04 | Wizard Island caldera -> Crater Lake | PD (USGS)     | 1157505  | File page + API verified; direct HEAD 200                      | Needs download; confirm Wizard Island prominent in frame                                                            |
| img-05 | Gypsum dunefield -> White Sands      | PD (NPS)      | 3492675  | File page + API verified; direct HEAD 429-throttled (see note) | Needs download; confirm dunes dominate the frame                                                                    |
| img-06 | Grand Prismatic -> Yellowstone       | BY-SA 4.0     | 5422003  | File page + API verified; direct HEAD 429-throttled (see note) | Bench only; credits slide if swapped in                                                                             |
| img-07 | Denali massif -> Denali              | PD (NPS)      | 9657176  | File page + API verified; direct HEAD 429-throttled (see note) | Bench only; just under the 10 MiB cap - recompress anyway                                                           |
| img-08 | Bryce hoodoos -> Bryce Canyon        | BY-SA 3.0     | 5371554  | File page + API verified; direct HEAD 429-throttled (see note) | Bench only; credits slide if swapped in                                                                             |

Full per-file records (canonical file page, author, license, Commons sha1, verification date) ride in the pack's `ext["com.jeopardy-machine.event.media-verification"]`, keyed by media id.

## Credits slide

**No CC BY-SA image is on the played board.** All five Name That Park board picks are public domain (NPS/USFWS/USGS) - no credits slide is legally required for the game as committed. Courtesy credit recommended: "Photos: National Park Service, U.S. Fish and Wildlife Service, U.S. Geological Survey / Wikimedia Commons".

**Two bench images are CC BY-SA.** If either is swapped in, a credits slide becomes MANDATORY, with these TASL attributions:

- img-06: "Aerial image of Grand Prismatic Spring (view from the south)" by Carsten Steger, Wikimedia Commons, CC BY-SA 4.0 - https://commons.wikimedia.org/wiki/File:Aerial_image_of_Grand_Prismatic_Spring_(view_from_the_south).jpg
- img-08: "Bryce Canyon Amphitheater Hoodoos Panorama" by Jon Zander (Digon3), Wikimedia Commons, CC BY-SA 3.0 - https://commons.wikimedia.org/wiki/File:Bryce_Canyon_Amphitheater_Hoodoos_Panorama.jpg

## Rule-set decisions (the house rules and why)

The game embeds an inline `rule-set` document: `casual-party` base + four overrides. Everything not listed inherits the casual-party defaults (which are already party-leaning by design - see packages/protocol/src/settings/presets.ts).

| Decision                                       | Source                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teams.playerMode = "teams"`                   | Stated: the event is a two-club team night (docs/research/00-user-directives.md first-event target; team leadership + team-scoped buzz sound directives all assume teams)                                                                                                                                                    |
| `teams.teamBuzzer = "any-member"`              | Chosen (draft silent): every attendee keeps their phone in the game instead of one shared device per team; the owner's team-scoped buzz-sound directive assumes members buzz individually. The default team-wide early-buzz penalty stays on to stop multi-phone spam                                                        |
| `scoring.wrongAnswerPenalty = "floor-at-zero"` | Chosen (draft silent): party-friendly middle ground - wrong answers still cost (wagers keep their tension) but no team ends the night at -$2,400 in front of the room. `deductOnAnswerTimeout` stays on so buzz-squatting is not free                                                                                        |
| `final.eligibility = "everyone"`               | Chosen, forced by the previous row: with a zero floor, teams can sit at exactly 0, and the TV positive-score-only rule would bench them for the finale - unacceptable at a club night. Everyone wagers at least the minimum stake                                                                                            |
| Final A (Pando) played                         | Stated: the draft's top pick; alternates B and C ship in the pack ready to swap                                                                                                                                                                                                                                              |
| 3 manual Double-Down cells                     | Stated: draft section 5 placements (l-73 at R1 $800; d-22 and q-99 at R2 $1200). `wagerPlacement: "manual"` per round - authored cells win, the auto-placement settings are inert                                                                                                                                            |
| `valueScheme` tv preset, round 2 multiplier 2  | Stated: the draft's ladders are exactly $200-$1000 / $400-$2000                                                                                                                                                                                                                                                              |
| Wager label "Double Down" (default kept)       | Stated: the draft names the cells Double-Down; the default label already matches                                                                                                                                                                                                                                             |
| Kept defaults, recorded as deliberate          | `questionFormatRequired: off` (casual crowd, no phrasing police), `answerCapture: verbal` + `armMode: manual` (live host reads clues), `maximumWagerRule: tv` (trailing teams can still bet big - party drama), `tieForFirst: co-champions` + `allNonPositiveFinish: highest-wins` (casual base), all presentation sounds on |
| Theme: `terra-verde` preset reference          | The schema's preset vocabulary includes `terra-verde` (packages/protocol/src/theme/theme.ts), so the game references it instead of inlining tokens; the preset's green-forest values live in apps/web/src/lib/theme/theme-presets.ts                                                                                         |

## Schema friction (found while authoring; same pattern as the fixtures agent's pack-id workaround)

1. **A content pack has no intrinsic id, so `content.kind: "external"` has nothing in the pack file to point at.** `packId` is a required UUIDv7, but the pack document's envelope carries only format/version/meta. Workaround: the pack declares its own library id in `ext["com.jeopardy-machine.library-id"]` and the game's `packId` matches it; `content.sha256` is computed over the exact committed file bytes (post-formatter), so the pairing is verifiable offline. The gate test enforces both. Real fix candidate: an optional `id` field in the document envelope (minor bump).
2. **`mediaAssetSchema` requires `sha256` and `bytes`, which cannot be honestly filled in a verify-remote-but-do-not-download workflow - and the asset row has no `ext` bag to say so.** `bytes` came live from the Commons API; `sha256` is a zero-filled placeholder (unmistakably not a real digest - Commons only publishes sha1). The honest verification record (author, license, file page, Commons sha1, date) rides at pack level in `ext["com.jeopardy-machine.event.media-verification"]` keyed by media id, because `mediaAssetSchema` is a strictObject without `ext`. Fill the real sha256 values at download time. Real fix candidates: optional `ext` on media assets, or an explicit `pending-remote` verification state.
3. **No structured home for curation constraints between cells.** Ordering dependencies (b-7 must stay below b-6), answer-collision conflicts (g-42 vs img-04, j-63 vs i-53), and story-arc caps (at most two of l-73/l-74/q-102) are prose in each item's free-text `source` plus this README - nothing machine-checkable. Acceptable for a hand-curated event; an editor-lint vocabulary would need schema support.
4. **A game referencing an external pack cannot say where the pack file lives.** For this repository the two files are siblings; the game hints it in `ext["com.jeopardy-machine.event.pack-path"]`. The in-app library resolves by id, so this is repo-layout friction only.
5. **Not friction but a limits flag:** img-01's original is 37.2 MB, over `limits.media.imageMaxBytes` (10 MiB). The schema deliberately does not enforce byte caps (lint/upload do), so the document validates; acquisition must downscale before bundling.
6. **Category lane labels have no slot.** The draft's crossover/environment/gaming mix per column exists only as item tags (category slugs) - `categorySchema` is title + cells. Harmless for play; noted for the editor's category metadata thinking.
