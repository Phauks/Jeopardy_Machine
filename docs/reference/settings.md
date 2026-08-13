# Settings reference

> GENERATED FILE - do not edit. Source of truth: `packages/protocol/src/settings/`
> (the settings registry, resolution R2 of docs/proposals/m1-protocol.md). Regenerate with
> `pnpm -F @jeopardy/protocol generate:settings-docs`; the gate test
> `settings/docs-table.gate.test.ts` fails CI when this file is stale.
>
> "Matrix" is the row in the 43-setting rules matrix (docs/research/01-game-anatomy.md);
> a dash marks named additions from the user-flows review. Matrix row 20 (host score
> override and undo) is deliberately absent: it is always on, so it is not a setting.

## Game structure (`structure`)

Rounds, board size, and what a cell is worth.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #1 | `roundCount` (Board rounds) | integer 1 to 4 | `2` | How many board rounds are played. The final round is its own toggle (final group). |
| #2 | `boardColumns` (Categories per round) | integer 3 to 6 | `6` | Columns on the board. |
| #2 | `boardRows` (Clues per category) | integer 3 to 6 | `5` | Rows on the board. |
| #3 | `valueScheme` (Value scheme) | `preset` / `custom` | `{"kind":"preset","preset":"tv"}` | Row values: a named preset or custom per-row values, lowest row first. _Custom row values must match the clues-per-category row count._ |
| #4 | `currencyLabel` (Currency label) | text (max 12 chars) | `"$"` | What scores are denominated in: "$", "points", or any short custom label. |
| #5 | `roundTwoValueMultiplier` (Round two multiplier) | integer 1 to 10 | `2` | Multiplies row values in the second board round (TV doubles them). |
| #6 | `roundTimeLimitMs` (Round time limit) | integer 60000 to 3600000, or null | null | Wall-clock limit per board round; null plays the board out (TV forfeits uncalled clues, a digital game need not). |

Cross-field rules: A custom value scheme must list exactly one value per board row.

## Board control (`boardControl`)

Who selects the next clue and when.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #7 | `nextSelector` (Next clue selector) | `last-correct` / `rotate` / `host-picks` / `auto-sweep` | `"last-correct"` | last-correct is the TV rule; auto-sweep plays cells top-to-bottom with no choosing (faster, less strategy). |
| #8 | `firstSelectorRoundOne` (First selector, round one) | `random` / `host-picks` | `"random"` | Who picks the first clue of the game. |
| #9 | `firstSelectorRoundTwo` (First selector, round two) | `lowest-score` / `same-as-round-one` | `"lowest-score"` | lowest-score is the TV rule (trailing player opens the second board). |
| #10 | `selectionShotClockMs` (Selection shot clock) | integer 5000 to 60000, or null | null | Time limit for choosing a clue; null lets the host prod stallers instead. |

## Buzzing (`buzzing`)

Arming, lockouts, and the windows around a buzz.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #11 | `armMode` (Arm mode) | `manual` / `auto-after-tts` / `auto-after-delay` | `"manual"` | manual mirrors the TV production (a human arms on the last syllable); the auto modes arm after text-to-speech ends or after a fixed reading delay. |
| #11 | `autoArmDelayMs` (Auto-arm delay) | integer 500 to 30000 | `4000` | Reading time before buzzers arm themselves. _Only read when arm mode is auto-after-delay._ |
| #12 | `earlyBuzzLockoutMs` (Early-buzz lockout) | integer 0 to 1000 | `250` | Buzzing before arming locks that buzzer out this long, re-triggered per press (TV: 250ms - the core skill element). 0 turns the penalty off. |
| #13 | `buzzWindowMs` (Buzz-in window) | integer 3000 to 15000, or null | `5000` | How long after arming anyone may ring in; null keeps buzzers live until the host closes the clue. |
| #14 | `answerWindowMs` (Answer window) | integer 3000 to 15000 | `5000` | Time the buzz winner has to answer before it counts as wrong. |
| #15 | `rebound` (Rebound after wrong answer) | on / off | `true` | Re-arm the remaining buzzers after a wrong answer (TV rule); off means one attempt per clue. |
| #16 | `wrongAnswererLockedOut` (Wrong answerer locked out) | on / off | `true` | A player who answered wrong stays locked out for the rest of the clue (TV rule). |

## Scoring (`scoring`)

What wrong answers and timeouts cost.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #17 | `wrongAnswerPenalty` (Wrong answer penalty) | `deduct` / `floor-at-zero` / `none` | `"deduct"` | deduct is the TV rule (negative scores are normal); floor-at-zero deducts but never below zero; none is the kids/casual mode. |
| #18 | `deductOnAnswerTimeout` (Deduct on answer timeout) | on / off | `true` | Buzzing in and then running out the answer window is treated as a wrong answer (TV rule). |
| #19 | `questionFormatRequired` (Question format required) | `off` / `host-reminder` / `strict-later-rounds` | `"off"` | Whether responses must be phrased as a question. strict-later-rounds is the TV rule (gentle reminder in round one, strictly enforced from round two); off is the natural default for typed answers. |

## Answer mode (`answerMode`)

Verbal or typed answers, and the everyone-answers crowd mode.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #21 | `answerCapture` (Answer capture) | `verbal` / `typed` | `"verbal"` | verbal: the host judges spoken answers, the app tracks buzz order and scores (the faithful live-event default). typed: answers are typed on phones and auto-judged with host override. |
| #22 | `everyoneAnswers` (Everyone answers) | `off` / `on` / `speed-weighted` | `"off"` | No buzzer race: every player types an answer within the timer. speed-weighted decays points by answer speed. Suggested on for 30+ solo players. _Requires typed answer capture._ |

Cross-field rules: Everyone-answers mode needs typed capture - there is no buzz winner to judge verbally.

## Wager cells (`wagers`)

Hidden wager cells: how many, where, and the betting rules.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #28 | `label` (Wager cell label) | text (max 30 chars) | `"Double Down"` | What the splash screen calls it. Any short phrase except the trademarked TV name. |
| #23 | `countRoundOne` (Wager cells, round one) | integer 0 to 4 | `1` | Hidden wager cells auto-placed in the first board round (TV: 1). |
| #23 | `countRoundTwo` (Wager cells, round two) | integer 0 to 4 | `2` | Hidden wager cells auto-placed in the second board round (TV: 2, never two in one category). |
| #24 | `autoPlacement` (Auto placement) | `weighted-realistic` / `uniform` | `"weighted-realistic"` | weighted-realistic mirrors 13,600 aired placements (row-4-heavy, never the top row); uniform draws from rows 2 down. |
| #25 | `minimumWager` (Minimum wager) | integer 0 to 10000 | `5` | Lowest allowed bet on a wager cell (TV: 5). |
| #26 | `maximumWagerRule` (Maximum wager rule) | `tv` / `score-only` / `unlimited` | `"tv"` | tv: the greater of current score and the round's top row value (a trailing player can still bet big). score-only: current score caps the bet. unlimited: no cap. |
| #27 | `wagerTimerMs` (Wager entry timer) | integer 10000 to 120000, or null | `30000` | Time to commit a wager before the clue shows; null is host-paced. |

## Final round (`final`)

The all-play wager round after the boards.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #29 | `enabled` (Final round enabled) | on / off | `true` | Play a final round after the last board round. A game definition with no authored final slot also skips it. |
| #30 | `eligibility` (Eligibility) | `positive-score-only` / `everyone` | `"positive-score-only"` | positive-score-only is the TV rule (zero or less sits out); everyone lets all players wager at least the minimum stake. |
| #31 | `wagerRule` (Wager range) | `zero-to-score` / `fixed-stake` | `"zero-to-score"` | zero-to-score is the TV rule (nobody can finish the final below zero); fixed-stake puts the same amount on the line for everyone. |
| #31 | `fixedStakeAmount` (Fixed stake amount) | integer 0 to 100000 | `100` | The stake everyone risks under the fixed-stake rule. _Only read when the wager range is fixed-stake._ |
| #32 | `writingTimerMs` (Writing timer) | integer 10000 to 120000 | `30000` | Time to type the final answer (TV: 30 seconds - the think-music length). |
| #33 | `revealStyle` (Reveal style) | `lowest-first` / `top-contenders` / `leaderboard` | `"lowest-first"` | lowest-first is the TV drama order, right for up to ~6 players/teams. top-contenders reveals the top few individually and batches the rest; leaderboard animates the whole standings - both exist because sequential reveal of 100 players is too slow. |

## Teams (`teams`)

Individuals or teams, and how a team buzzes.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #34 | `playerMode` (Player mode) | `individuals` / `teams` | `"individuals"` | Individual players or shared-score teams. |
| #35 | `teamBuzzer` (Team buzzer) | `shared-phone` / `any-member` / `rotating-captain` | `"shared-phone"` | shared-phone: one phone per team (simplest and most robust). any-member: first buzz from any teammate counts. rotating-captain: one active buzzer per clue, rotated to keep everyone engaged. _Only read in teams mode._ |
| #36 | `teamWideEarlyBuzzPenalty` (Team-wide early-buzz penalty) | on / off | `true` | An early buzz locks out the whole team, not just the presser - otherwise multi-phone teams can spam the arm window. _Only read in teams mode._ |

## End of game (`end`)

Ties and degenerate finishes.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #37 | `tieForFirst` (Tie for first) | `sudden-death` / `co-champions` / `shared-placement` | `"co-champions"` | sudden-death is the current TV rule (one buzz-in clue, repeat until resolved); co-champions is the pre-2014 rule and the party default; shared-placement just ranks them equal. |
| #38 | `allNonPositiveFinish` (All-non-positive finish) | `no-winner` / `highest-wins` | `"highest-wins"` | When every score ends at zero or below: TV declares no winner; highest-wins crowns someone anyway. |

## Presentation (`presentation`)

Per-cue sounds, announcements, and reveal animations.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #39 | `soundBoardFill` (Board-fill sound) | on / off | `true` | The ascending boops as cells populate at round start. |
| #39 | `soundWagerSting` (Wager cell sting) | on / off | `true` | The dramatic sting when a hidden wager cell is revealed. |
| #39 | `soundThinkMusic` (Think music) | on / off | `true` | The final round writing-timer track (an original composition, not the TV melody). |
| #39 | `soundTimeUp` (Time's-up beep) | on / off | `true` | The double beep when a buzz or answer window expires. |
| #39 | `soundBuzzIn` (Buzz-in sound) | on / off | `true` | An audible cue when someone wins the buzz - useful in a big room (TV uses only the podium light). |
| #40 | `announceBuzzWinner` (Announce buzz winner) | `screen-only` / `screen-and-sound` / `screen-and-name-tts` | `"screen-and-sound"` | How the room learns who buzzed first. |
| #41 | `categoryRevealAnimation` (Category reveal animation) | on / off | `true` | Animate the category strip one at a time at round start (host reads each aloud). |
| #42 | `deadClueReveal` (Dead clue answer reveal) | `auto-display` / `host-reads` | `"auto-display"` | When nobody gets a clue: auto-display shows the correct answer on the board; host-reads leaves it to the host. |

## Joining (`join`)

Late joiners and the player-facing join experience.

| Matrix | Setting | Values | Default | Description |
| --- | --- | --- | --- | --- |
| #43 | `lateJoinAllowed` (Late join allowed) | on / off | `true` | Players can join after the game starts. |
| #43 | `lateJoinScore` (Late join score) | `zero` / `match-lowest` / `host-prompt` | `"zero"` | zero: late joiners start at 0. match-lowest: they match the current lowest score. host-prompt: the host is asked per joiner. Host score override remains the universal escape hatch. _Only read when late join is allowed._ |
| - | `clueTextOnPhones` (Clue text on phones) | on / off | `false` | Show the clue text on player phones. Off for in-room play (reading ahead beats listening); on for remote play and accessibility. _Default under review - revisit after the first playtest (user-flows open question 4)._ |
| - | `profanityFilter` (Nickname profanity filter) | on / off | `true` | Filter player nicknames at join; duplicate names get an auto-suffix either way. |
