# Jeopardy Game Anatomy — Research Findings

> Research round 1 · Agent: Game Anatomy · 2026-08-13
> Purpose: everything a faithful-but-adaptable digital Jeopardy-style game needs, for live in-person events with phone-as-buzzer, 2–100 players (individual or teams).

---

## 1. Round structure

### 1.1 Jeopardy! round (Round 1)
- **Board**: 6 categories × 5 clues = 30 clues.
- **Dollar values (current TV, since Nov 2001 doubling)**: $200, $400, $600, $800, $1000 per column, top to bottom (increasing difficulty).
- **Pre-2001 values**: $100–$500 (still common in hobby/classroom versions; many house games also use plain points 100–500).
- **Flow**: Categories are revealed one at a time at the start of the round (host reads each aloud, sometimes with a comment). Returning champion / a designated player selects first. The player who answers a clue correctly (or who last answered correctly) selects the next clue ("Category for $X").
- **Round end**: When all 30 clues are exhausted **or** time runs out (on TV, uncalled clues are simply forfeited when the round's time expires — a digital version can make time limits optional and default to playing out the full board).

### 1.2 Double Jeopardy! round (Round 2)
- Same 6×5 structure with **new categories**.
- **Values doubled**: $400, $800, $1200, $1600, $2000.
- **Selection starts with the player in last place** (lowest score) at the start of Double Jeopardy.
- Two Daily Doubles instead of one (see §2).

### 1.3 Final Jeopardy! round
- Single category, single clue, all eligible players participate simultaneously via written wager + written response (see §3).

### 1.4 Clue/answer inversion
- Signature format: the board shows an **answer** ("This president appears on the $5 bill") and players respond with a **question** ("Who is Lincoln?"). See §5 for enforcement nuances.

---

## 2. Daily Doubles

- **Count**: 1 hidden Daily Double in the Jeopardy round; 2 in Double Jeopardy (never two in the same category).
- **Placement (statistical tendencies from J! Archive / FlowingData analysis of ~13,600 DDs across seasons 1–31)**:
  - Never in the top row (row 1). Extremely rare in row 2.
  - **Row 4 is the most common (~38%)**, then rows 3 and 5. Concentrated in the middle-bottom of the board.
  - Column skew is mild: first column slightly favored (row 4/column 1 is the single hottest cell); second and last columns slightly under-represented.
  - **Recommended placement algorithm for a clone**: random cell weighted roughly row1: 0%, row2: 9%, row3: 26%, row4: 39%, row5: 26%, with a constraint that two DDs in Double Jeopardy land in different categories. Offer "uniform random (rows 2–5)" and "manual placement by host" as alternatives.
- **Only the player who selected the clue answers** — no buzzing. Opponents cannot ring in even if the selector misses.
- **Wagering**:
  - **Minimum**: $5 (TV rule).
  - **Maximum**: the greater of (a) the player's current score, or (b) the highest clue value on the board in the current round ($1,000 in round 1, $2,000 in round 2). So a player with $200 — or even a negative score — can still wager up to $1,000/$2,000. Wagering one's entire score is a "**true Daily Double**."
  - Wager is committed before the clue is revealed.
- **Resolution**: Correct → wager added; incorrect or no answer → wager deducted (can push score negative). Either way, the same player selects the next clue.
- **Timing**: On TV there is no hard visible timer for the DD response, but ~the same 5-second answer convention applies after the clue is read; the host prompts for an answer.
- The Daily Double reveal has its own sound effect and full-screen splash ("DAILY DOUBLE!") before the wager is taken — worth replicating (genericized) for drama.

## 3. Final Jeopardy

Mechanics, in order:
1. **Eligibility check**: Any player/team with a score of **$0 or less is excluded** (on TV they leave the stage). House variant: let everyone play with a minimum wager of 0, or grant excluded players a token stake.
2. **Category reveal**: Category shown first, *before* wagers.
3. **Wagering**: Each eligible player secretly wagers **$0 up to their full current score** (integer dollars; TV allows any whole-dollar amount). Wagers lock before the clue is shown. Because the max wager equals current score, no one can finish Final Jeopardy below $0.
4. **Clue reveal + think music**: All players write their response simultaneously during a **30-second** timer (the length of the famous "think" music). On TV, responses are written on a light pen display; in our app, typed on the phone. TV rule trivia: writing must stop when time expires; partial/illegible responses are judged as-is.
5. **Reveal order**: Responses and wagers revealed **from lowest pre-Final score to highest** — this is critical for drama and should be automated. For each player: show response → judge → show wager → apply delta.
6. **Judging**: Same correctness rules as regular clues; phrasing-as-a-question is technically required on TV in Final Jeopardy (unlike round 1 where the host can prompt a rephrase) — in practice a written "What is X" prefix is expected, but hobby games usually waive this for typed answers.
7. **Winner**: Highest final total. See §5 for ties.

**Large-group adaptation note**: with up to 100 players, sequential reveal of every player is too slow. Sensible modes: (a) reveal only the top N contenders individually, then batch-reveal the rest; (b) full leaderboard animation from bottom to top; (c) host-paced reveal for teams (team counts are small enough).

## 4. Buzzer mechanics (critical)

How the TV system works (per Jeopardy.com's own behind-the-scenes explanations):

1. **Reading phase — buzzers dead.** While the host reads the clue, all signaling devices are inert. Presses during this phase do register — as penalties.
2. **Arming.** A staff member (on TV, a human watching the host's lips) presses a button the instant the host finishes the **last syllable** of the clue. This simultaneously (a) lights up white "enable lights" flanking the board (visible to contestants, not TV viewers) and (b) arms the lockout circuit. **It is manual, not automatic** — a key insight: our app should give the host/board-operator a big "ARM BUZZERS" button (with an optional auto-arm after text-to-speech or after a host-set reading timer).
3. **Early-buzz penalty.** Buzzing before arming locks that player's buzzer out for **0.25 seconds** (a quarter second). Each subsequent early press re-triggers the lockout (on the real hardware, mashing keeps you locked out). This penalty is the core skill element of the TV game and should be faithfully implemented and configurable (0 = off, 0.25s default, longer for casual play).
4. **First signal wins.** After arming, the system registers only the **first** signal; everyone else is locked out. The winner's podium light comes on. With phones over a network, latency fairness matters: register client-side timestamps relative to the arm broadcast (or measure per-device latency offsets) rather than server arrival order, and break exact ties randomly.
5. **Answer window.** The player who buzzed in has **5 seconds** to begin/complete a response (TV convention; the podium lights count down). No answer in time = treated as incorrect.
6. **Rebound.** Wrong answer (or timeout) → **clue value deducted** from that player, their buzzer is locked out for the remainder of the clue, and the buzzers **re-arm for everyone else** (on TV the host often re-reads/prompts). This repeats until someone is correct or nobody buzzes.
7. **No-buzz timeout.** If nobody buzzes within ~5 seconds of arming (TV: the "time's up" double-beep), the host reads the correct response, no scores change, and **the same player who chose the last clue chooses again** (control doesn't change on a triple-stumper or dead clue).
8. **Control**: The last player to give a correct response controls board selection. On a Daily Double, the selector retains control regardless of outcome.

**Timers that matter for the app** (all should be configurable):

| Timer | TV convention | Notes |
|---|---|---|
| Clue reading | variable (host-paced) | app: manual arm button, or TTS-then-arm |
| Early-buzz lockout | 0.25 s | per press, re-triggerable |
| Buzz-in window after arming | ~5 s, then time's-up beep | |
| Answer window after buzzing | 5 s | verbal on TV; app may use host judgment or typed answers |
| Daily Double / wager entry | host-paced (~15–30 s reasonable) | |
| Final Jeopardy writing | 30 s | matches think music length |
| Clue selection | host prods stallers; tournaments have used shot clocks | optional 10–15 s selection timer |

## 5. Scoring rules & edge cases

- **Negative scores** are normal and expected in rounds 1–2 (wrong buzz-ins and lost DD wagers deduct). Displayed in red / with a minus on TV.
- **Sub-zero at Final Jeopardy** → excluded (see §3).
- **"Answer in the form of a question"**:
  - Any interrogative phrasing counts ("What is…", "Who are…", even "Is it…?" or just "…Lincoln?" with rising inflection has been accepted).
  - **Jeopardy round**: forgetting the phrasing gets a gentle host reminder ("Can you phrase that as a question?") and a chance to rephrase.
  - **Double Jeopardy and Final Jeopardy**: phrasing is strictly required; an un-phrased response is ruled incorrect (TV rule, frequently waived in home play).
- **Judging leniency (TV norms worth encoding as host guidance, not automation)**:
  - Pronunciation/spelling errors accepted if they don't change the answer (Final Jeopardy written answers judged phonetically).
  - Last names alone usually suffice; first name needed only when ambiguous or wrong.
  - More-specific-than-needed answers accepted if correct; added incorrect info invalidates.
  - Judges can retroactively reverse rulings mid-game and adjust scores — our app must support **host score override at any time** (add/subtract arbitrary amounts, undo last adjudication).
- **Ties**:
  - **End-of-game tie for first (current TV rule, since Nov 2014)**: sudden-death **tiebreaker clue** — one clue, buzz-in, correct answer wins, wrong answer doesn't lose money but eliminates you from that clue; repeat with new clues until resolved. No wagering.
  - Pre-2014 rule: co-champions (both "win") — a fine casual default for parties.
  - **All players finish at $0 or below**: no winner (on TV, no returning champion). App should handle gracefully.
- **Wager legality**: wagers are whole dollars; TV bans certain offensive number strings — unnecessary for a clone but validate range (min ≤ wager ≤ max).
- **Score integrity**: everything is host-adjudicated; the app is a calculator + state machine, never the final judge (unless an auto-judge mode for typed answers is explicitly enabled).

## 6. Adaptations for live party/team play

### Team modes
- **One phone per team (shared buzzer)**: simplest and most robust; the phone-holder buzzes for the team; any teammate may answer aloud. TV analog: contestants may not confer — teams obviously do confer, so consider a "confer allowed" flag that just informs the host script.
- **Every member has a phone, team shares a score**:
  - *First-teammate-buzz mode*: first buzz from any member counts for the team; lockouts apply team-wide.
  - *Designated buzzer / rotating captain*: only one member's buzzer active per clue (rotation keeps everyone engaged).
  - Early-buzz penalty should apply team-wide to prevent teams "spamming" with multiple members.
- **Large crowds (50–100 players)**: buzz-in races stay fun, but consider "**everyone answers**" modes: all players type an answer within a timer; all correct answers score (full or speed-decayed points). This turns the game into a Kahoot-style hybrid and is essential for keeping 100 individuals engaged — should be a per-game (or even per-round) mode toggle.

### House rules worth making configurable
- **No negative scoring** (wrong answers deduct nothing, or floor at 0) — great for casual/kids.
- **Rebound on/off** — off means one attempt per clue; also configurable whether the *same* player can re-buzz after a wrong answer by someone else (TV: a player who missed is locked out for that clue).
- **Question-format requirement off** (default off for typed answers; toggle for verbal purists).
- **Timer lengths** — all timers in §4 table.
- **Board sizes** other than 6×5 (e.g., 5×5, 4×5, 6×4, 3×5 for short games).
- **Value schemes**: TV dollars (200–1000 / 400–2000), classic (100–500 / 200–1000), plain points (100–500), or custom per-row values; "dollars" vs "points" label toggle.
- **Single-round game** (one board only), **skip Final Jeopardy**, **skip Double Jeopardy**.
- **Daily Double count/placement**: 0–2 per round, weighted-realistic vs uniform vs manual; option to let everyone at 0-or-less still wager a house minimum.
- **Final Jeopardy eligibility**: TV rule (>$0) vs everyone plays.
- **Control of board**: TV rule (last correct answerer picks) vs rotate vs host-picks vs top-to-bottom auto-advance (some hobby versions just sweep categories, which removes strategy but speeds play).
- **Tie handling**: sudden death clue vs co-champions vs shared placement.
- **Clue timeout behavior**: reveal answer automatically vs host reads it.
- **Answer capture**: verbal (host judges, app only tracks buzz order/scores) vs typed (app can auto-judge with fuzzy matching + host override). Verbal is the faithful default for live events.

## 7. Presentation elements (and IP considerations)

### The look
- **Board**: grid of deep-blue cells with thick black/dark gutters; category names in white condensed sans caps (TV uses Swiss 911/Helvetica-condensed family for categories, Korinna for clue text); **dollar values in gold/yellow** (classic gold ≈ #D69F4C–#FFCC00 range) with a drop shadow.
- **Blue**: the commonly cited Jeopardy board blue is **#060CE9** (with darker gradients toward #0000AF/#00003C for depth). A clone should pick a *similar but not identical* palette — the vibe is "game-show blue," not a pixel-match.
- **Clue reveal flow**: click cell → value zooms/flips → full-screen blue card with the clue in white serif-ish caps → after adjudication, card dismisses and the cell goes permanently blank (dark/empty).
- **Category reveal**: at round start, category strip revealed one at a time (TV pans across them with a whoosh); worth an animated sequence + host reads each.
- **Daily Double**: full-screen splash with its own sting sound before the wager prompt.
- **Score displays**: contestant podium look — name (handwritten-style on TV) over a score readout; negative in red.

### Sounds (all should be re-created, not sampled)
- **Board-fill sound**: rapid ascending "boop-boop-boop" as cells populate at round start.
- **Daily Double sting**: dramatic swoosh/alarm.
- **Final Jeopardy "Think!" music**: 30-second lounge waltz — **copyrighted composition (Merv Griffin)**; a clone must use an original 30-second "thinking" track, not the real melody.
- **Time's-up signal**: distinctive double "beep-beep" when the buzz window or answer window expires.
- **Ring-in**: on TV there's no audible buzz to viewers (just the podium light); house versions usually add a buzz/ding per player — useful in a big room; consider distinct sounds or announcing the buzzer-winner's name on screen.

### Trademark / copyright — what a hobby clone must avoid
- **"Jeopardy!" name and logo**: registered trademarks of Jeopardy Productions, Inc. Do not use the name, the exclamation-point logotype, or confusingly similar names in the product name or marketing. Use a generic name ("Quiz Board," "Trivia Grid," etc.).
- **Theme music and "Think!"**: copyrighted — no sampling, no close melodic imitation.
- **Trade dress**: the exact combination of board look, fonts, set design, and catchphrases enjoys protection; a clone should evoke the genre (blue board, gold values, answer-and-question format — game *mechanics themselves are not copyrightable*) without replicating the precise logo fonts, exact colors, or on-screen graphics package.
- **Catchphrases**: avoid verbatim branded phrases in the UI ("This is Jeopardy!", "Daily Double" is heavily associated — many clones rename it "Double Down"/"Wild Wager"; low legal risk as a phrase but renaming plus generic styling is the safe pattern).
- Clue *content* the users write is theirs; do not bundle actual aired Jeopardy clues (J! Archive content is fan-transcribed but the clues are the show's copyrighted material).

## 8. Host workflow during a live game → host UI implications

Moment-to-moment loop for one clue (the host console must make each step one tap):

1. **See the board** (host mirror of the public display) → tap a cell on behalf of the controlling player, or confirm the player's spoken selection. UI: highlight who has control.
2. **Clue appears** → host **reads it aloud** (or triggers TTS). Buzzers dead; host UI shows "reading" state.
3. **Arm buzzers** — single big button (spacebar-sized). Optional auto-arm on TTS end.
4. **Buzz result** — UI announces who won the buzz (name big + sound), starts the 5-second answer timer automatically, shows the correct answer *privately to the host*.
5. **Adjudicate** — two huge buttons: **Correct** (adds value, gives control, closes clue) / **Wrong** (deducts value unless disabled, locks that player out, **re-arms remaining buzzers automatically**). Optional third: **No penalty** (for judge's-discretion cases).
6. **Timeout path** — "No takers" button (or auto after buzz window): reveal answer to the room, close clue, control unchanged.
7. **Daily Double path** — splash → UI prompts wager from the controlling player's phone (host sees allowed min/max computed automatically, can type the wager on their behalf) → reveal clue → single Correct/Wrong adjudication.
8. **Anytime controls**: score override (± any amount per player), **undo last action** (mis-taps are constant in live hosting — undo is essential), reopen a closed clue, skip clue, pause timers, kick/rename players, force-end round.
9. **Round transitions**: end round (with warning if clues remain), start Double Jeopardy (auto-flip selection to lowest scorer), run Final Jeopardy wizard (eligibility list → category reveal → wager collection status per player → clue + 30s music → per-player reveal in lowest-first order with Correct/Wrong buttons → winner screen, tiebreaker flow if needed).
10. **Awareness aids**: which cells remain, running scores, whose turn to pick, wager-submission progress bars, and a private view of every clue's correct response.

Key design principle from the TV production: **three humans run the show** — host (reads/judges), board operator (arms buzzers), judges (rulings). A live-event app should let one person do all three, so automation defaults (auto-arm, auto-timers, auto-rebound) matter, but every automated step needs a manual override.

---

## Configurable rules matrix

| # | Setting | Options | Default |
|---|---|---|---|
| **Game structure** |||
| 1 | Rounds played | R1 only / R1+R2 / R1+R2+Final / R1+Final | R1 + R2 + Final |
| 2 | Board size | rows 3–6 × columns 3–6 | 6 categories × 5 clues |
| 3 | Value scheme | TV ($200–1000, doubled R2) / classic ($100–500) / points (100–500) / custom per row | TV values |
| 4 | Currency label | $ / points / custom | $ |
| 5 | Round 2 multiplier | ×2 / ×1 / custom | ×2 |
| 6 | Round time limit | off / minutes | off (play out board) |
| **Board control** |||
| 7 | Who selects next clue | last correct answerer (TV) / rotate / host picks / auto-sweep | TV rule |
| 8 | First selector R1 | random / host picks | random |
| 9 | First selector R2 | lowest score (TV) / same as R1 | TV rule |
| 10 | Selection shot clock | off / 10–30 s | off |
| **Buzzing** |||
| 11 | Arm mode | manual host button / auto after TTS / auto after fixed reading delay | manual |
| 12 | Early-buzz lockout | off / 0.1–1.0 s | 0.25 s |
| 13 | Buzz-in window | 3–15 s / unlimited until host closes | 5 s |
| 14 | Answer window after buzz | 3–15 s | 5 s |
| 15 | Rebound after wrong answer | on (TV) / off | on |
| 16 | Wrong answerer locked out of clue | yes (TV) / no | yes |
| **Scoring** |||
| 17 | Deduct on wrong answer | yes (TV) / no / floor at 0 | yes |
| 18 | Deduct on answer-timeout after buzz | yes (TV) / no | yes |
| 19 | Question-format required | off / host-reminder only / strict in R2+Final | off (typed) or host-reminder (verbal) |
| 20 | Host score override & undo | always on | always on |
| **Answer mode** |||
| 21 | Answer capture | verbal + host judges / typed + auto-judge with host override | verbal |
| 22 | Everyone-answers mode (no buzzer race; all type within timer) | off / on per round / speed-weighted scoring | off (on suggested for 30+ solo players) |
| **Daily Doubles** |||
| 23 | Count per round | 0 / 1 / 2 / custom | 1 in R1, 2 in R2 |
| 24 | Placement | weighted-realistic (row-4-heavy, never row 1) / uniform rows 2–5 / manual | weighted-realistic |
| 25 | Min wager | $5 / 0 / custom | $5 |
| 26 | Max wager | max(score, top row value of round) (TV) / score only / unlimited cap | TV rule |
| 27 | DD wager timer | off / 15–60 s | 30 s |
| 28 | DD name & branding | genericized label (e.g. "Double Down") | genericized |
| **Final round** |||
| 29 | Final round enabled | on / off | on |
| 30 | Eligibility | score > 0 (TV) / everyone plays (min stake for ≤0) | TV rule |
| 31 | Wager range | 0 to current score (TV) / fixed stake | TV rule |
| 32 | Writing timer | 15–60 s | 30 s |
| 33 | Reveal style | lowest-first individual (TV) / top-N individual + batch / leaderboard animation | lowest-first (≤6 players/teams), top-N + batch otherwise |
| **Teams** |||
| 34 | Player mode | individuals / teams | individuals |
| 35 | Team buzzer | one shared phone / any member (first buzz counts) / rotating designated buzzer | one shared phone |
| 36 | Team-wide early-buzz penalty | on / off | on |
| **End of game** |||
| 37 | Tie for first | sudden-death tiebreaker clue (TV) / co-champions / shared win | co-champions (party default; tiebreaker for competitive) |
| 38 | All-non-positive finish | no winner / highest score wins anyway | highest wins anyway (party-friendly) |
| **Presentation** |||
| 39 | Sounds (board fill, DD sting, think music, time's-up, buzz-in) | individually toggleable, original/royalty-free assets only | all on |
| 40 | Announce buzz winner | screen only / screen + sound / screen + name TTS | screen + sound |
| 41 | Category reveal animation | on / skip | on |
| 42 | Show correct answer on dead clue | auto-display / host reads only | auto-display |

### Sources (key references)
- [Jeopardy.com — How Does the Jeopardy! Buzzer Work?](https://www.jeopardy.com/jbuzz/behind-scenes/how-does-jeopardy-buzzer-work)
- [Jeopardy.com — The Infamous Jeopardy! Buzzer](https://www.jeopardy.com/jbuzz/behind-scenes/infamous-jeopardy-buzzer-key-becoming-jeopardy-champion)
- [FlowingData — Where to Find Jeopardy! Daily Doubles](https://flowingdata.com/2015/03/03/where-to-find-jeopardy-daily-doubles/) (J! Archive data, seasons 1–31)
- [J! Archive — Daily Double statistics](https://j-archive.com/ddstats.php?season=29)
- [The Ringer — History of the Jeopardy! Tiebreaker](https://www.theringer.com/2021/01/23/tv/jeopardy-tiebreaker-scenario-rules-changes)
- [Jeopardy.com — Jeopardy! First: A Tiebreaker](https://www.jeopardy.com/jbuzz/behind-scenes/jeopardy-first-tiebreaker)
- [Trivia Bliss — Complete Rules Guide to Final Jeopardy](https://triviabliss.com/jeopardy-final-jeopardy-rules/)
- [The Jeopardy! Fan — Final Jeopardy wagering](https://thejeopardyfan.com/final-jeopardy-betting)
