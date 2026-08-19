# Event: Board Game Club x Environmental Law Society Night

> Assembled 2026-08-14 from docs/content/event-board-draft.md (curation contract), docs/content/event-content-pool.md (verified clues + full source notes), and docs/content/media-and-sounds.md (image picks + license worklist).
> Constraint honored: environment + gaming ONLY, nothing law-related.

## What is in this directory

| File                   | Format            | What                                                                                                                                                              |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event-pack.pack.json` | `content-pack`    | Every clue for the night: 60 board cells, the final plus 2 alternates, 25 bench swaps, 4 drop-in alternate categories (21 more items), 8 picture-round media refs |
| `event-game.game.json` | `game-definition` | The playable game: both boards in draft order, 3 authored Double-Down cells, Final A, inline house rules (casual base + event overrides), Terra Verde theme       |
| `media/img-0N.webp`    | WebP images       | The eight picture-round images themselves, acquired and downscaled by `tools/event-media-bake` - the pack's media refs point here                                 |

Both documents open through `parsePortableDocument` (the `@jeopardy/protocol` public entry point) and are gate-tested by `packages/protocol/src/event-documents.test.ts`: every cell resolves to a pack item, bench/alternate items are present-but-unreferenced, every media ref resolves to a committed file whose sha256 and dimensions still check out, and the external pack link's sha256 matches this directory's exact `event-pack.pack.json` bytes.

**After ANY edit to `event-pack.pack.json`** recompute the hash and paste it into `event-game.game.json` -> `body.content.sha256`, or the gate test will fail (by design): `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('events/board-game-club-x-els/event-pack.pack.json')).digest('hex'))"` - and run `pnpm fmt` BEFORE hashing, since the hash covers the formatted bytes. (`pnpm -F @jeopardy/event-media-bake bake` does that whole chain itself when it rewrites the media refs.)

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

| Item (pool id)     | What to re-check                                                | Why                                                                                                                                      |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| g-41 (R1 $400)     | Most-visited park + 12.2M figure                                | NPS publishes new visitation data annually; 2025 likely out                                                                              |
| g-43 (R1 $800)     | Mammoth Cave mapped miles (426)                                 | Survey teams add miles every year                                                                                                        |
| g-44 (R1 $1000)    | Old Faithful interval / prediction accuracy                     | NPS occasionally revises                                                                                                                 |
| a-4 (R1 $1000)     | eBird origin phrasing                                           | Confirm exact interview wording                                                                                                          |
| b-12 (R1 $1000)    | Terraforming Mars "ocean tiles" wording                         | Confirm against rulebook                                                                                                                 |
| f-35 / f-36 (R2)   | Hyperion height (381.3 ft?) and closure/fine still in force     | Measurement + policy both changeable                                                                                                     |
| i-55 (R2 $800)     | Minecraft blue axolotl odds (1/1200) if cited aloud             | Game updates change spawn logic                                                                                                          |
| i-52 (R2 $1200)    | Vaquita count (~7-10 in 2025 survey)                            | Annual survey; most volatile number on the board                                                                                         |
| i-53 (R2 $1600)    | Kakapo population (200+ / ~230-240)                             | NZ DOC updates after breeding seasons                                                                                                    |
| g-45 (bench)       | Death Valley wording - must say "officially recorded"           | 2026 BAMS dispute                                                                                                                        |
| p-91 / p-93 / p-94 | Minecraft 300M "single game", Catan total, GDQ $60M + charities | All sales/fundraising totals move (ALT-4 only)                                                                                           |
| img-01..05         | Image files still live + licenses unchanged                     | Run `pnpm -F @jeopardy/event-media-bake bake` - it re-verifies each Commons file page's license and sha1 and fails naming whatever moved |

The images themselves are already acquired and committed (see the next section), so nothing needs downloading before the night. What is still open there is the human look-at-the-picture checks listed at the end of that section.

## Media: acquired, downscaled, committed (2026-08-17)

The eight picture-round images are **in this directory** under `media/`, not remote URLs. They were fetched, license-re-verified, downscaled and encoded by `tools/event-media-bake` (that package's README covers verification, sizing, format choice, and re-running); the pack's media refs carry their real `sha256` and byte counts, `storage.state` is `bundled`, and `packages/protocol/src/event-documents.test.ts` re-hashes every file on every test run, so those numbers cannot quietly stop being true.

License classes: **PD** = public domain (no attribution legally required; credit NPS/USFWS/USGS as courtesy). **BY-SA** = CC BY-SA (attribution + ShareAlike; credits slide mandatory if shipped).

**Verification method:** each file page was re-read live through the Commons API at acquisition time, and both its license short name and its **Commons sha1** had to match what the curation pass recorded - the sha1 is the strong check, because an uploader replacing the bytes behind the same file name would change it and invalidate everything else in the record. The downloaded bytes' sha1 was then checked against the API's, so a rate-limited or truncated download could not pass as a valid image. All eight passed unchanged.

### Credits table (checklist section 5.5 - a row per file, PD included)

| ID     | File                | Subject -> answer                    | License   | Author                                        | Commons file page                                                                                                   |
| ------ | ------------------- | ------------------------------------ | --------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| img-01 | `media/img-01.webp` | Old Faithful eruption -> Yellowstone | PD        | Yellowstone National Park (NPS)               | <https://commons.wikimedia.org/wiki/File:Spring_Old_Faithful_eruption_from_Observation_Point.jpg>                   |
| img-02 | `media/img-02.webp` | Half Dome -> Yosemite                | PD        | Gentry George, U.S. Fish and Wildlife Service | <https://commons.wikimedia.org/wiki/File:Half_dome_in_Yosemite_national_park.jpg>                                   |
| img-03 | `media/img-03.webp` | Delicate Arch -> Arches              | PD        | NPS / Damon Joyce                             | <https://commons.wikimedia.org/wiki/File:Delicate_Arch_in_Arches_National_Park._NPS-Damon_Joyce_(18686376391).jpg>  |
| img-04 | `media/img-04.webp` | Wizard Island caldera -> Crater Lake | PD        | USGS / Lyn Topinka                            | <https://commons.wikimedia.org/wiki/File:Crater_Lake_from_rim-USGS.jpg>                                             |
| img-05 | `media/img-05.webp` | Gypsum dunefield -> White Sands      | PD        | NPS Photo                                     | <https://commons.wikimedia.org/wiki/File:Sunset_over_an_interdunal_area_(fc947575-155d-451f-67bd-cd7fbd10c9ce).JPG> |
| img-06 | `media/img-06.webp` | Grand Prismatic -> Yellowstone       | BY-SA 4.0 | Carsten Steger                                | <https://commons.wikimedia.org/wiki/File:Aerial_image_of_Grand_Prismatic_Spring_(view_from_the_south).jpg>          |
| img-07 | `media/img-07.webp` | Denali massif -> Denali              | PD        | NPS Photo / Emily Mesner                      | <https://commons.wikimedia.org/wiki/File:Denali,_Denali_National_Park_and_Preserve.jpg>                             |
| img-08 | `media/img-08.webp` | Bryce hoodoos -> Bryce Canyon        | BY-SA 3.0 | Jon Zander (Digon3)                           | <https://commons.wikimedia.org/wiki/File:Bryce_Canyon_Amphitheater_Hoodoos_Panorama.jpg>                            |

### What changed from the originals

Every file is the Commons original downscaled to at most 2560 px on the long edge (never upscaled) and re-encoded to WebP at quality 82, metadata stripped. No cropping, no color adjustment. Format rationale and the byte-cap arithmetic live in `tools/event-media-bake/README.md`.

| ID     | Commons original        | Committed      | Bytes                                                        |
| ------ | ----------------------- | -------------- | ------------------------------------------------------------ |
| img-01 | 8688x5792, 37,209,547 B | 2560x1707 webp | 1,144,730 B (32x smaller)                                    |
| img-02 | 3380x5048, 659,961 B    | 1714x2560 webp | 321,804 B                                                    |
| img-03 | 2000x1500, 1,539,033 B  | 2000x1500 webp | 142,062 B (already under the size cap - kept at native size) |
| img-04 | 3275x2160, 1,157,505 B  | 2560x1688 webp | 269,290 B                                                    |
| img-05 | 3648x2736, 3,492,675 B  | 2560x1920 webp | 147,662 B                                                    |
| img-06 | 4800x3400, 5,422,003 B  | 2560x1813 webp | 714,746 B                                                    |
| img-07 | 7222x4820, 9,657,176 B  | 2560x1709 webp | 178,248 B                                                    |
| img-08 | 3827x1570, 5,371,554 B  | 2560x1050 webp | 637,896 B                                                    |

**Total committed: 3,556,438 B (3,473 KiB)** across eight images, against a 10 MiB per-image cap and a 200 MiB per-game total (`@jeopardy/protocol/limits`). img-01 was the only file over a cap; it is now 3% of it.

### Still open on the images

- **img-04**: the worklist wanted a visual confirmation that Wizard Island is prominent in frame. Not done - nobody has looked at the picture.
- **img-05**: same, that dunes rather than sky dominate the frame.
- **img-02** is portrait (1714x2560 committed); the 16:9 crop check on a projector has not been done.
- These are taste checks a person has to make; the pipeline can only guarantee the file is the one that was vetted, the right size, and legally clear.

Full per-file records (file page, author, license, Commons sha1, source sha256 and pixels, committed pixels, verification date) ride in the pack ext, keyed by media id.

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
2. **`mediaAssetSchema` requires `sha256` and `bytes`, which could not be honestly filled in the verify-remote-but-do-not-download workflow the curation pass used - and the asset row has no `ext` bag to say so.** RESOLVED for this event on 2026-08-17 by doing the download: the assets are `bundled` with real digests over committed bytes, and the gate test re-hashes them. The friction itself stands for the next verify-before-acquire pass, and it is why those records spent three days carrying zero-filled placeholders. The provenance record still rides at pack level in `ext["com.jeopardy-machine.event.media-verification"]` keyed by media id, because `mediaAssetSchema` is a strictObject without `ext`. Real fix candidates unchanged: optional `ext` on media assets, or an explicit `pending-remote` verification state.
3. **No structured home for curation constraints between cells.** Ordering dependencies (b-7 must stay below b-6), answer-collision conflicts (g-42 vs img-04, j-63 vs i-53), and story-arc caps (at most two of l-73/l-74/q-102) are prose in each item's free-text `source` plus this README - nothing machine-checkable. Acceptable for a hand-curated event; an editor-lint vocabulary would need schema support.
4. **A game referencing an external pack cannot say where the pack file lives.** For this repository the two files are siblings; the game hints it in `ext["com.jeopardy-machine.event.pack-path"]`. The in-app library resolves by id, so this is repo-layout friction only.
5. **Not friction but a limits flag, now closed:** img-01's original was 37.2 MB, nearly four times over `limits.media.imageMaxBytes` (10 MiB). The schema deliberately does not enforce byte caps (lint/upload do), so the document validated anyway - which is exactly how an over-cap asset could sit in a valid document for three days. Acquisition downscaled it to 1.1 MiB, and the gate test now checks every asset against the cap so the next one cannot.
6. **Category lane labels have no slot.** The draft's crossover/environment/gaming mix per column exists only as item tags (category slugs) - `categorySchema` is title + cells. Harmless for play; noted for the editor's category metadata thinking.
