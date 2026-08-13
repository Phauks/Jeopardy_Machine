# Landscape Survey: Jeopardy/Trivia-Board Game Tools (August 2026)

> Research round 1 · Agent: Competitive Landscape · 2026-08-13
> Purpose: establish the feature bar for a free, self-hosted alternative and learn from competitors' weaknesses. Prices and tier details verified as of Aug 2026 via vendor pages and third-party reviews.

---

## 1. Commercial / Freemium Board Tools

### JeopardyLabs (jeopardylabs.com)
- **Pricing**: Freemium; one-time **$20 lifetime** membership (no subscription — notable outlier).
- **Free tier**: Unlimited game creation, no registration required, 5x5 board, host-clicks-tile presentation, built-in team scoreboard (host manually adds/subtracts points), public/hidden/private sharing, play others' public templates.
- **Paywalled**: Images and audio/video embeds (YouTube/Vimeo/SoundCloud), math equations, extra rows/columns beyond 5x5, more questions per game, template management page/vanity URL.
- **No buzzers at all** — even paid. The creator's answer is a *separate*, free general-purpose buzzer site, **Buzzonk** (buzzonk.com), that isn't integrated with the board. Players "buzz" by shouting/raising hands.
- **UX strengths**: Radically simple; a game exists in ~5 minutes; no account needed; games are permanent URLs; huge searchable library of public boards.
- **UX weaknesses**: Dated visuals; no phone-as-buzzer; no wager/Daily Double mechanics beyond manual scoring; media locked behind pay; export is unofficial (a third-party ["Jeopardy Labs to CSV" Chrome extension](https://chromewebstore.google.com/detail/jeopardy-labs-to-csv/biijijhfghhckhlkjbonjedmgnkmenlk) exists — evidence of unmet demand for data portability).

### Factile / PlayFactile (playfactile.com) — same product
- **Pricing**: Free plan; **Home/School Basic $48/yr**; **Home/School Plus $7.50/mo or $72/yr**; **Business Pro $9.50/mo or $90/yr**.
- **Free tier**: Only **3 saved games**, 5 teams, classic host-scored Factile mode, share/play public games, flashcard view. No ads.
- **Paywalled — the core complaint case study**: **Buzzer Mode is entirely paid** ($48/yr minimum). Also paid: Multiple Choice mode, Memory game, full Flashcards, Question Banks, AutoGen AI generation (from topics or PDFs), collaboration, customizations (board colors, etc.), more than 3 games.
- **Phone-as-buzzer (paid)**: Best-in-class flow — players go to `playfactile.com/join`, enter a PIN **or scan a QR code**; choice of "board + buzzer" layout (1:1 device classrooms) or "buzzer only" (shared big screen); works over the internet, not just LAN.
- **UX strengths**: Real Jeopardy structure (Daily Doubles, Final-round wagers), polished editor, remote/hybrid support.
- **UX weaknesses**: The 3-game cap plus buzzer paywall makes the free tier a demo; recurring subscription for what is functionally a static feature set.

### Baamboozle (baamboozle.com)
- **Pricing**: Free Basic; **Baamboozle+ $59.88/yr ($4.99/mo eq.) or $7.99/mo**.
- **Free tier**: Unlimited game creation, public library (millions of games), **max 24 questions/game, 4 teams, 1MB image storage**, ads shown.
- **Paywalled**: 8 teams, 20MB images, premium game modes (Memory, Four in a Row, Tic Tac Toe, Story Dice), slideshows, multiple-choice questions, private games, editing all games, no ads, unlimited folders.
- **Not really Jeopardy**: turn-based team play with random "power-ups" (steal/swap points) on a single shared screen; **no buzzers, no student devices, no board-of-dollar-values**. Luck-based scoring is loved by ESL/elementary teachers, disliked for serious review.
- **Strength to note**: zero-friction single-screen play — no devices needed at all.

### SuperTeacherTools (superteachertools.us)
- **Pricing**: 100% free, ad-supported.
- Jeopardy Review Game creator (its most popular tool) + Millionaire clone + classroom utilities. Supports images in questions. No accounts; games saved via links/IDs.
- **Weaknesses**: Very dated UI (Flash-era heritage), ads, no phone buzzers, no real team/device features, fragile game persistence. Proof there's appetite for free — and proof "free" alone doesn't win without modern UX.

### Flippity (flippity.net)
- **Pricing**: 100% free (donation-supported). Google Sheets → game templates, including a Quiz Show (Jeopardy-style) template.
- **Strengths**: The **spreadsheet-as-source-of-truth** model — teachers already know Sheets; content is inherently portable, copyable, and versionable. Many other templates (flashcards, randomizer, board games).
- **Weaknesses**: No real-time features, no buzzers, no progress tracking or student accounts, ~30-item limits on some templates, wholly dependent on Google Sheets publishing (setup friction: publish-to-web steps confuse novices; broken when Google changes things).

### Newer entrants (2024–2026)
- **TriviaMaker** (triviamaker.com): 7 game styles including Jeopardy-style "Grid"; AI generator. **Free: 20 participants, 3 styles**; Premium $19/yr promo ($6.99/mo), Premium Plus $39.99/yr (200 players), Enterprise to 2,000 players. Player-count tiering is its monetization lever.
- **AI-first generators**: [SoonLab](https://www.soonlab.ai/blog/top-jeopardy-game-maker/) (prompt → playable browser game), Factile AutoGen (topic/PDF → board), Knowt, Musely, Easy-Peasy.AI, TeachQuill. Table stakes in 2026: *"paste a topic or document, get a filled board."* None of these are self-hostable; most gate output volume behind credits/subscriptions.

**Pattern across the category**: the editor and solo/host-clicked play are free everywhere; the moment multiple devices connect (buzzers, player limits) or media enters a clue, you pay. Recurring subscriptions ($36–$90/yr) dominate; JeopardyLabs' $20-lifetime is the only non-subscription holdout.

## 2. Buzzer-Focused Apps

| App | Cost | Join flow | Notes |
|---|---|---|---|
| **BuzzIn.Live** | Free tier capped at **8 players**; paid tiers above | 6-digit room code or direct URL; host "Create" → code | Teams, points, timer, lock/unlock/reset buzzers, buzzer sounds, **explicit latency correction** (used by NAQT for online quiz bowl — the credibility bar for fairness) |
| **CosmoBuzz** (cosmobuzz.net) | Free | Room code or custom link + nickname, no registration | Buzz order numbered by response time; text-answer field alongside buzzer; host can lock/reset, first-buzz-only mode |
| **Buzzonk** | Free (built by JeopardyLabs' creator) | Room code | General-purpose buzzer explicitly marketed as JeopardyLabs' companion — i.e., the market leader ships buzzers as a *disconnected side app* |
| **Buzzman.live**, **JustBuzz.in** | Free/low cost | Code-based, iOS/Android browser | Commodity space |

**Takeaways**: (a) join flow is always *code → nickname → buzz*, zero accounts; (b) latency fairness is the differentiator serious users check (NAQT documents BuzzIn.Live's latency handling); (c) buzzers are commoditized and free — charging for them (Factile) is exactly the resented paywall; (d) none integrate the buzzer with a *board you authored* for free — that integration is the gap.

## 3. Open-Source Projects (GitHub)

Most relevant repos:

- **[howardchung/jeopardy](https://github.com/howardchung/jeopardy)** (Jeopardy.app, ~70 stars, MIT, TypeScript) — the strongest prior art. React front end, Node backend, WebSockets, optional Redis for room persistence. Plays real J-Archive episodes (pre-parsed to gzipped JSON) **and custom games via CSV import**. Features: full round structure with Daily Doubles, TTS clue reading, **buzzer unlock timed by clue syllable count** (anti-host-lag fairness), multi-room, chat, experimental ChatGPT answer judging. Weaknesses: desktop-first UI, player-judged answers by default, no visual board editor.
- **[theGrue/jeopardy](https://github.com/theGrue/jeopardy)** (~68 stars, Angular/Socket.io/Express) — J-Archive playback for up to 3 players, "bring your own buzzer." Aging stack.
- **[jfargus/jeoparty](https://github.com/jfargus/jeoparty)** (jeoparty.io) — couch co-op: board on TV, phones join via session ID at same URL, players pick nickname + hand-drawn signature (charming lobby touch worth copying). Socket.io.
- **[stuartthomas25/JParty](https://github.com/stuartthomas25/JParty)** — desktop (Python/Qt) J-Archive simulator, phones as buzzers.
- **[EricKarschner37/Jeopardy](https://github.com/EricKarschner37/Jeopardy)** — self-hosted, Docker, React board + join page (Rust backend).
- **[bufferapp/buzzer](https://github.com/bufferapp/buzzer)**, **[danielthepope/buzzer](https://github.com/danielthepope/buzzer)**, **[YnotCode/buzzer.io](https://github.com/YnotCode/buzzer.io)** — standalone Node/Socket.io phone-buzzer apps; simple reference implementations.
- **[stegro/jeopardyML](https://github.com/stegro/jeopardyML)** — interesting outlier: single-HTML-file offline game, data separated from rendering (YAML-ish markup). Validates an "open one file in a browser, no server" mode.
- **[the-snesler/buckys-buzzer-beater](https://github.com/the-snesler/buckys-buzzer-beater)** (2025, Rust) — "Jeopardy, but Kahoot!" — evidence others see the same synthesis opportunity.
- Data: **[jwolle1/jeopardy_clue_dataset](https://github.com/jwolle1/jeopardy_clue_dataset)** (554k clues, 1984–2026, TSV), **[whymarrh/jeopardy-parser](https://github.com/whymarrh/jeopardy-parser)** and successors for J-Archive scraping.

**Architecture observations**: Universally Node + Socket.io (or equivalent WS) with in-memory room state; Redis only for restart persistence. **No significant project found using Cloudflare Durable Objects** — but the DO pattern (one object per room = authoritative lobby state + WebSocket fan-out) is well documented for game lobbies ([Brian Gershon's writeup](https://www.briangershon.com/blog/developing-real-time-games-with-cloudflare-durable-objects-and-websockets/), [game-lobby posts](https://eliseygusev.com/why/game-lobbies/)) and is a genuinely open lane for a modern serverless/self-hostable hybrid. Common OSS gaps: no board *editor* (JSON/CSV hand-editing), desktop-only UI, player-judged scoring, abandoned maintenance, and almost none combine **editor + board + phone buzzers + wagers** in one package. Licenses are permissive (MIT) where stated.

## 4. Kahoot-Style Join UX (what to borrow)

What Kahoot/Blooket/Gimkit nail:
- **kahoot.it pattern**: one short URL + 6–7 digit PIN + nickname → in. No accounts for players, ever. (~85% of joins go through the bare join page.)
- **Lobby screen on the host display** showing nicknames popping in with a live player counter — this *is* the pre-game ritual and confirms everyone's in before start.
- **Nickname generator** (spin for a safe name) to kill inappropriate-name delays; host can kick players from the lobby.
- **2-Step Join** (tap a refreshing pattern shown on the host screen) to block remote gate-crashers — clever proof-of-presence.
- QR code alongside the PIN (Factile also does this).
- Pricing warning from this category: Gimkit free caps Pro modes at 5 players; Blooket free allows 60 and is the "most usable free tier" — generous player counts are the loudest goodwill generator.

**How Jeopardy-style differs (design implication)**: Kahoot is *question-broadcast* — every phone shows the answer options and the game auto-paces. Jeopardy is **host-paced and stage-focused**: the shared board is the center, phones are mostly dumb buzzers (plus wager entry and Final-round text answers), the host adjudicates and controls flow (reveal, judge right/wrong, score, return to board). So borrow the *join/lobby* UX wholesale, but not the gameplay loop: phone UI needs only ~4 states — waiting / buzz-armed / buzzed-locked / input (wager or text answer).

## 5. Import/Export Ecosystem

- **JeopardyLabs**: no official export; third-party Chrome extension scrapes to CSV. Games are HTML you can download and hand-edit. Effectively a walled garden — its huge public library is *not* portable.
- **J-Archive**: the de-facto real-episode corpus. No API; scraped by many tools. Canonical scraped schema (from the widely-used 216k-question Reddit/trexmatt dump and [jwolle1's 554k-clue TSV dataset](https://github.com/jwolle1/jeopardy_clue_dataset)): `category, value, question(clue), answer, round ("Jeopardy!" | "Double Jeopardy!" | "Final Jeopardy!" | "Tiebreaker"), show_number, air_date`. Supporting J-Archive-shaped JSON/TSV import unlocks half a million real clues instantly.
- **CSV/spreadsheet**: the lingua franca. Flippity proves teachers will maintain content in Sheets; howardchung/jeopardy already imports custom games via CSV. Kahoot's xlsx template (question, 4 answers, correct index, time limit) is the most familiar quiz-spreadsheet shape but is multiple-choice-oriented, not board-oriented.
- **Quizlet**: exports tab-delimited term/definition text — trivially importable as Q/A pairs (needs category/value assignment on import). **Anki**: TSV/CSV import-friendly; .apkg is SQLite (import feasible, export low value).
- **Nothing standard exists for "a Jeopardy board" as a document.** No tool has established an open interchange format for a 6x5 board with categories, values, media, Daily Doubles, and Final round.

**Recommendation**: import from (1) CSV/Google-Sheets template (category, value, clue, response, media-URL, daily-double flag), (2) J-Archive-style JSON/TSV, (3) Quizlet/Anki TSV pairs; export to (1) a documented open JSON board format (position it as the interchange standard the space lacks), (2) CSV, (3) printable/static single-file HTML (steal jeopardyML's offline trick).

## 6. Feature Synthesis

Legend: **F** = free tier, **P** = paid only, **—** = absent.

| Feature | JeopardyLabs | Factile | Baamboozle | SuperTeacherTools | Flippity | TriviaMaker | BuzzIn.Live | OSS (typical) |
|---|---|---|---|---|---|---|---|---|
| Board editor | F | F (3 games) | F (24 q max) | F | F (Sheets) | F (3 styles) | — | — (JSON/CSV by hand) |
| Saved games | F (unlimited) | P beyond 3 | F | F | F | F (limited) | n/a | F |
| Phone buzzers | — | **P ($48/yr)** | — | — | — | P (crowd mode limits) | F (≤8 players) | F |
| QR/PIN join | — | P | — | — | — | F/P | F (code) | some |
| Teams/scoreboard | F (manual) | F (5 teams) | F (4) / P (8) | F | F | F | F | F |
| Image clues | **P** | F/P mix | F (1MB) / P (20MB) | F | F (via Sheets) | F | n/a | some |
| Audio/video clues | **P** | P | — | — | limited | P | n/a | rare |
| Daily Double / wagers | — (manual) | F | — | — | F (basic) | partial | n/a | F (J-Archive players) |
| Final round + wagers | — | F | — | — | — | partial | n/a | F |
| Player limit | n/a (one screen) | tiered | 4 teams free | n/a | n/a | **20 free / 2,000 paid** | **8 free** | unlimited |
| AI generation | — | P (AutoGen) | — | — | — | F/P | n/a | rare (howardchung: AI judging) |
| Ad-free | F | F | **P** | — (ads) | F | F/P | F | F |
| Offline/self-host | — | — | — | — | — (needs Google) | — | — | **F** |
| Import (CSV etc.) | — (3rd-party hack) | limited | — | — | F (Sheets native) | some | n/a | F (CSV/J-Archive) |
| Export/portability | — | — | — | — | F (it's your Sheet) | — | n/a | F |
| Print | F | limited | — | — | some templates | — | n/a | rare |

### Gaps a free self-hosted tool can exploit
1. **Integrated free buzzers + authored board** — no one offers this combination free: JeopardyLabs has no buzzers, Factile charges $48/yr, buzzer apps have no board. This is the headline feature.
2. **No player-count paywall** (the tiering lever of TriviaMaker/Gimkit/BuzzIn.Live).
3. **Free media clues** (JeopardyLabs' paywall) — images/audio/video in the free product.
4. **Data portability** — open documented board JSON + CSV round-trip; nobody offers real export.
5. **Real Jeopardy mechanics free**: Daily Doubles, wager entry on the phone, Final round with simultaneous secret wagers/answers — only Factile does this well, behind pay.
6. **Self-host/offline** — zero commercial tools offer it; OSS offers it without an editor or polish.
7. **A visual editor for OSS-quality engines** — the single biggest OSS gap.
8. **J-Archive-scale content import** (554k clues) as an instant library.

## Lessons for Our Build

1. **The monetization map is the feature spec.** Everything competitors gate — buzzers, media clues, >3 saved games, >5x5 boards, team counts, player counts, ad removal — must be unconditionally free. That list is: buzzer mode, image/audio/video clues, unlimited saved games, arbitrary board dimensions, unlimited teams/players, no ads.
2. **Copy the Kahoot join ritual exactly**: short join URL + big PIN + QR on the host screen, nickname (with generator), lobby showing avatars/names as they arrive, host kick control. This is solved UX; don't innovate here.
3. **But keep the Jeopardy loop host-paced**: board is the stage; phones are thin clients with four states (idle → armed → buzzed/locked → input for wagers/Final answers). Don't broadcast questions to phones by default (offer Factile's "board+buzzer" split layout as an option for 1:1 device settings).
4. **Buzzer fairness is a credibility feature**: timestamp buzzes client-side and reconcile server-side (BuzzIn.Live's latency correction is why NAQT endorses it); consider howardchung's trick of arming the buzzer after a reading delay derived from clue length, plus early-buzz lockout penalty like the real show.
5. **Architecture**: the proven pattern is one authoritative room object with WebSocket fan-out (Socket.io in every OSS repo; Cloudflare Durable Objects is the modern serverless equivalent with no notable jeopardy project occupying that niche yet). Room state must survive refresh/reconnect — phone browsers lock/sleep constantly; every OSS project that ignored reconnection feels broken in practice. Redis-or-equivalent persistence only needed for restart survival.
6. **Editor is the moat over OSS**: hand-edited JSON is why 100+ GitHub clones have no users. A visual board editor with drag-fill, media upload, and Daily Double placement beats every OSS project; being free beats every commercial one.
7. **Spreadsheet in, open format out**: Flippity proves Sheets/CSV is how teachers actually author; ship a CSV template importer, J-Archive JSON/TSV import, Quizlet/Anki TSV import, and export to a documented open board-JSON — position it as the interchange format the category lacks. The existence of a scraper extension for JeopardyLabs proves users want their content back.
8. **Ship a no-server fallback**: single-file HTML export / fully local play (jeopardyML pattern) covers the "school WiFi is down / no devices" case and doubles as print support — a mode no commercial tool has.
9. **Keep JeopardyLabs' virtues**: instant creation without an account, permanent shareable game URLs, and (optionally) a public gallery — its simplicity, not its feature list, is why it still dominates.
10. **AI generation is now table stakes but keep it optional/pluggable** (BYO API key for topic→board and answer-judging à la howardchung) — don't make the core product depend on it, since self-hosters won't want a required cloud dependency.
11. **License**: MIT/Apache-2 matches ecosystem norms; avoid trademark trouble — don't use "Jeopardy" in the product name (every commercial tool says "Jeopardy-style"; JeopardyLabs predates enforcement attention).

## Sources
[JeopardyLabs](https://jeopardylabs.com/) · [JeopardyLabs review](https://www.educationalappstore.com/app/jeopardylabs) · [Factile plans](https://www.playfactile.com/plans/) · [Factile buzzer docs](https://www.manula.com/manuals/factile/factile-user-doc/1/en/topic/buzzer-mode) · [Factile remote join](https://www.playfactile.com/remotejoin/) · [Baamboozle review](https://rigorousthemes.com/blog/bamboozle-review/) · [SuperTeacherTools](https://www.superteachertools.us/) · [Flippity comparison](https://slashdot.org/software/comparison/Flippity-vs-SuperTeacherTools/) · [NAQT on BuzzIn.Live](https://www.naqt.com/online/buzzin.jsp) · [edtechpicks buzzer roundup](https://edtechpicks.org/2021/06/online-buzzers-classroom-games/) · [Buzzonk](https://buzzonk.com/) · [howardchung/jeopardy](https://github.com/howardchung/jeopardy) · [theGrue/jeopardy](https://github.com/theGrue/jeopardy) · [jfargus/jeoparty](https://github.com/jfargus/jeoparty) · [stegro/jeopardyML](https://github.com/stegro/jeopardyML) · [jwolle1/jeopardy_clue_dataset](https://github.com/jwolle1/jeopardy_clue_dataset) · [Kahoot join docs](https://support.kahoot.com/hc/en-us/articles/360039890713-Kahoot-join-How-to-join-a-Kahoot-game) · [Kahoot 2-Step Join](https://support.kahoot.com/hc/en-us/articles/35342050693789-How-to-use-the-2-step-Join-option-to-secure-your-game) · [Kahoot spreadsheet import](https://support.kahoot.com/hc/en-us/articles/115002812547-How-to-import-questions-from-a-spreadsheet-to-your-kahoot) · [Kahoot vs Blooket vs Gimkit](https://learnclash.com/blog/kahoot-vs-blooket-vs-gimkit) · [TriviaMaker pricing](https://triviamaker.com/pricing/) · [DO game lobbies](https://eliseygusev.com/why/game-lobbies/) · [DO real-time games](https://www.briangershon.com/blog/developing-real-time-games-with-cloudflare-durable-objects-and-websockets/) · [SoonLab jeopardy makers roundup](https://www.soonlab.ai/blog/top-jeopardy-game-maker/) · [JeopardyLabs-to-CSV extension](https://chromewebstore.google.com/detail/jeopardy-labs-to-csv/biijijhfghhckhlkjbonjedmgnkmenlk)
