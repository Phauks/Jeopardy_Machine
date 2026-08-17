# Bundled sound pack

Every file here came through the repo-committed pipeline in `tools/audio-bake/` (how to re-bake, and the honest notes on source quality: its README). The curation history - what was auditioned, what the owner approved, and why - is `docs/content/media-and-sounds.md`.

**All 21 files are CC0 1.0** (Creative Commons Zero: public domain dedication, no attribution required). The bundle policy is CC0-only, so no credits slide is legally required for anything in this directory. The rows below exist anyway, because checklist section 5.5 of the worklist asks for a credits row per file even when the license does not - it is the audit trail that lets anyone re-verify what we shipped.

License verification is not a one-time claim recorded here: `tools/audio-bake/src/fetch.mjs` re-opens each sound page on every fetch run and fails the whole bake unless the page still states "Creative Commons 0" and still names the same author. A relicensed or replaced upload stops the pipeline instead of slipping into a release.

| File                   | Kind  | In-app label     | Source (Freesound)                                                                        | Author                | License | Verified   |
| ---------------------- | ----- | ---------------- | ----------------------------------------------------------------------------------------- | --------------------- | ------- | ---------- |
| `correct-bell.mp3`     | buzz  | Correct Bell     | [Correct Bell](https://freesound.org/s/538147/)                                           | Fupicat               | CC0 1.0 | 2026-08-17 |
| `ding.mp3`             | buzz  | Ding             | [ding.wav](https://freesound.org/s/580649/)                                               | mark205               | CC0 1.0 | 2026-08-17 |
| `clown-horn.mp3`       | buzz  | Clown Horn       | [Clown Horn (Single Honk).wav](https://freesound.org/s/588570/)                           | Gimp_Revival          | CC0 1.0 | 2026-08-17 |
| `squeaky-toy.mp3`      | buzz  | Squeaky Toy      | [Squeaky Toy #4](https://freesound.org/s/483922/)                                         | Breviceps             | CC0 1.0 | 2026-08-17 |
| `laser-zap.mp3`        | buzz  | Laser Zap        | [LASRGun_Retro Laser Zap Synth_Funky Audio_Sonic Spices](https://freesound.org/s/729389/) | Funky_Audio           | CC0 1.0 | 2026-08-17 |
| `klaxon.mp3`           | buzz  | Klaxon           | [Klaxon.wav](https://freesound.org/s/88465/)                                              | davidou               | CC0 1.0 | 2026-08-17 |
| `kookaburra.mp3`       | buzz  | Kookaburra       | [kookaburra](https://freesound.org/s/841979/)                                             | soundofsong           | CC0 1.0 | 2026-08-17 |
| `loon.mp3`             | buzz  | Loon             | [loon.wav](https://freesound.org/s/428077/)                                               | pschrandt             | CC0 1.0 | 2026-08-17 |
| `owl-hoot.mp3`         | buzz  | Owl Hoot         | [Hoot_2.wav](https://freesound.org/s/164652/)                                             | deleted_user_2104797  | CC0 1.0 | 2026-08-17 |
| `airhorn.mp3`          | buzz  | Airhorn          | [Airhorn](https://freesound.org/s/414208/)                                                | jacksonacademyashmore | CC0 1.0 | 2026-08-17 |
| `gong.mp3`             | buzz  | Gong             | [Gong_Center_Clear.wav](https://freesound.org/s/56240/)                                   | Q.K.                  | CC0 1.0 | 2026-08-17 |
| `game-powerup.mp3`     | buzz  | Game Powerup     | [Game Powerup](https://freesound.org/s/368651/)                                           | Jofae                 | CC0 1.0 | 2026-08-17 |
| `elephant-trumpet.mp3` | buzz  | Elephant Trumpet | [Elephant Trumpets Growls.flac](https://freesound.org/s/527845/)                          | D.jones               | CC0 1.0 | 2026-08-17 |
| `swanee-whistle.mp3`   | buzz  | Swanee Whistle   | [FX swanee whistle up.wav](https://freesound.org/s/497092/)                               | v0idation             | CC0 1.0 | 2026-08-17 |
| `board-ready.mp3`      | cue   | Board Ready      | [Countdown Start](https://freesound.org/s/680825/)                                        | stomachache           | CC0 1.0 | 2026-08-17 |
| `wrong-answer.mp3`     | cue   | Wrong Answer     | [Wrong Answer Buzzer](https://freesound.org/s/650842/)                                    | -Andreas              | CC0 1.0 | 2026-08-17 |
| `wager-sting.mp3`      | cue   | Wager Sting      | [Ba Dum Bum ALL.aif](https://freesound.org/s/221642/)                                     | eggsandwichent        | CC0 1.0 | 2026-08-17 |
| `think-elevator.mp3`   | music | Elevator         | [Short Elevator Music Loop](https://freesound.org/s/659889/)                              | BlondPanda            | CC0 1.0 | 2026-08-17 |
| `think-bossa.mp3`      | music | Bossa Nova       | [(Bossa Nova Loop) Thank You for Shopping!](https://freesound.org/s/464924/)              | plasterbrain          | CC0 1.0 | 2026-08-17 |
| `think-lounge.mp3`     | music | Smooth Keys      | [Lounging - Smooth Keys.wav](https://freesound.org/s/681097/)                             | deleted_user_14795591 | CC0 1.0 | 2026-08-17 |
| `lobby-theme.mp3`      | music | Funk Rock        | [Funk Rock, 135 BPM](https://freesound.org/s/724495/)                                     | carloseton            | CC0 1.0 | 2026-08-17 |

## What is committed, and how it differs from the source

The downloads are **not** committed (`tools/audio-bake/downloads/` is gitignored). What ships is each source's curated window, processed identically:

1. **Trimmed** to a hand-picked window (`tools/audio-bake/src/sources.mjs`) - for multi-take sources this is the one take the owner approved, not a detected "best hit".
2. **Loudness-normalized** toward -16 LUFS (buzz-ins and cues) or -20 LUFS (music beds), by linear gain only - never past a -1.5 dBFS peak ceiling, so nothing clips in a room.
3. **Onset-standardized**: leading silence removed and audible energy re-seated at ~10 ms with a 4 ms micro fade-in, uniform across the whole pack. This is a fairness rule, not a polish one - file onset is perceived buzz-in latency, so one team's sound must not "react" later than another's (docs/content/media-and-sounds.md 7b).
4. **Encoded** to one format at one sample rate: MP3, 44100 Hz, mono for buzz-ins and cues, stereo for music.

Sources are Freesound's HQ previews (128 kbps MP3), not the full-quality originals, because originals are behind a Freesound account and this pipeline runs without credentials. For one-second buzz-ins that is genuinely inaudible; for `lobby-theme.mp3` it is a real (if mild) quality ceiling. `tools/audio-bake/README.md` explains the upgrade path.

`lobby-theme.mp3` is a **placeholder**, not the owner's pick: the signature-lobby-track review (media-and-sounds.md section 9, round 4) is still open. It is that round's only CC0 candidate clearing the owner's 2-3 minute lap floor. Replacing it is one row in `tools/audio-bake/src/sources.mjs` and a re-bake.

Buzz-ins land in the 0.5-1.5 s window the owner set; cues stay under 3 s. Both are asserted by the bake and re-checked by `apps/web/src/lib/room/sound-manifest.gate.test.ts` against the committed bytes.

One cue has no file and no row above: **time-up** is synthesized in `apps/web/src/lib/room/room-audio.ts` (two 150 ms beeps at 880 Hz, 120 ms apart). No CC0 double-beep exists (docs/content/media-and-sounds.md section 3); the owner approved synthesizing it.

Total committed: **5129 KiB** across 21 files (259 KiB of buzz-ins, 48 KiB of cues, 4822 KiB of music).
