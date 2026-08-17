// THE source table: every bundled sound, pinned to its Freesound id, with the curated trim
// window and gain trim that turn the raw source into the shipped file. Editing this file is
// how the pack changes - nothing downstream guesses.
//
// Why the trim window is committed data rather than "detect the best hit": several sources
// are multi-take files (a rimshot set, a 6 s kookaburra sequence) where "best" is a taste
// call the owner already made in the Listening Rooms (docs/content/media-and-sounds.md
// sections 7 and 9). Hand-picked offsets keep the bake deterministic and reviewable; an
// onset detector would silently re-pick a different take on any re-run.
//
// Fields:
//   id            - the shipped file name stem and the manifest/catalog key. Buzz ids MUST
//                   match apps/web/src/lib/room/buzz-sound-catalog.ts.
//   kind          - buzz (0.5-1.5 s, room-audible identity) | cue (<=3 s, system event) |
//                   music (beds and the lobby track; no duration window).
//   freesoundId   - the sound page id; the page is re-fetched and its license line re-read on
//                   every fetch run (fetch.mjs), so a relicensed source fails the bake loudly.
//   author        - as shown on the page today; the fetch step asserts it still matches.
//   title         - the uploader's own file title, for the credits row.
//   startSeconds  - where the kept region begins in the SOURCE file (pre-onset-trim).
//   lengthSeconds - how much of the source to keep from startSeconds. The onset trim then
//                   removes whatever leading silence remains inside that window, so this is
//                   an upper bound on the shipped duration, not the shipped duration.
//   gainDecibels  - optional pre-normalization trim. loudnorm handles level; this exists only
//                   for sources whose peak would clip after normalization.
//   fadeOutSeconds- optional tail fade, for sounds cut mid-decay (a hard cut clicks).
export const sampleRate = 44100;

// One format, one sample rate (checklist section 7). MP3 rather than Opus/Ogg because every
// browser that can run a player phone decodes it through decodeAudioData - Ogg Opus is still
// young on Safari, and a player whose buzz sound silently fails to decode is worse than a few
// KB. MP3's constant encoder delay is uniform across the pack (same encoder, same settings),
// so it shifts every sound equally and cannot reintroduce the fairness problem that the
// uniform-onset rule exists to solve (docs/content/media-and-sounds.md 7b).
export const encoding = {
  buzz: { channels: 1, bitrateKilobits: 128 },
  cue: { channels: 1, bitrateKilobits: 128 },
  music: { channels: 2, bitrateKilobits: 128 },
};

/** Uniform onset target: audible energy starts here in EVERY shipped file. */
export const onsetTargetSeconds = 0.01;
/** The assertion window around it - first sample above -40 dBFS must land inside. */
export const onsetWindowSeconds = { minimum: 0.008, maximum: 0.015 };
/** Micro fade-in over the onset ramp: kills the click that an instant hard start makes. */
export const onsetFadeSeconds = 0.004;
/** Duration windows per kind, enforced by the bake and re-checked by the gate test. */
export const durationWindows = {
  buzz: { minimum: 0.5, maximum: 1.5 },
  cue: { minimum: 0.15, maximum: 3 },
};
/** Loudness target (checklist section 7). Integrated LUFS, EBU R128 via ffmpeg loudnorm. */
export const loudnessTargets = {
  buzz: -16,
  cue: -16,
  // Beds sit UNDER a host talking over them; -20 keeps them present without ducking work.
  music: -20,
};

export const sources = [
  // ---- The approved 14 buzz sounds (media-and-sounds.md section 9, finalized 2026-08-13).
  {
    id: "correct-bell",
    kind: "buzz",
    label: "Correct Bell",
    freesoundId: 538147,
    author: "Fupicat",
    title: "Correct Bell",
    startSeconds: 0,
    lengthSeconds: 1.45,
    fadeOutSeconds: 0.15,
  },
  {
    id: "ding",
    kind: "buzz",
    label: "Ding",
    freesoundId: 580649,
    author: "mark205",
    title: "ding.wav",
    startSeconds: 0,
    lengthSeconds: 0.6,
  },
  {
    id: "clown-horn",
    kind: "buzz",
    label: "Clown Horn",
    freesoundId: 588570,
    author: "Gimp_Revival",
    title: "Clown Horn (Single Honk).wav",
    startSeconds: 0,
    lengthSeconds: 0.62,
    fadeOutSeconds: 0.04,
  },
  {
    id: "squeaky-toy",
    kind: "buzz",
    label: "Squeaky Toy",
    freesoundId: 483922,
    author: "Breviceps",
    title: "Squeaky Toy #4",
    startSeconds: 0,
    lengthSeconds: 0.72,
    fadeOutSeconds: 0.05,
  },
  {
    id: "laser-zap",
    kind: "buzz",
    label: "Laser Zap",
    freesoundId: 729389,
    author: "Funky_Audio",
    title: "LASRGun_Retro Laser Zap Synth_Funky Audio_Sonic Spices",
    startSeconds: 0.14,
    lengthSeconds: 1.05,
    fadeOutSeconds: 0.06,
  },
  {
    id: "klaxon",
    kind: "buzz",
    label: "Klaxon",
    freesoundId: 88465,
    author: "davidou",
    title: "Klaxon.wav",
    startSeconds: 0,
    lengthSeconds: 0.81,
    fadeOutSeconds: 0.05,
  },
  {
    id: "kookaburra",
    kind: "buzz",
    label: "Kookaburra",
    freesoundId: 841979,
    author: "soundofsong",
    title: "kookaburra",
    startSeconds: 0.05,
    lengthSeconds: 1.45,
    fadeOutSeconds: 0.1,
  },
  {
    id: "loon",
    kind: "buzz",
    label: "Loon",
    freesoundId: 428077,
    author: "pschrandt",
    title: "loon.wav",
    startSeconds: 0,
    lengthSeconds: 1.45,
    fadeOutSeconds: 0.2,
  },
  {
    id: "owl-hoot",
    kind: "buzz",
    label: "Owl Hoot",
    freesoundId: 164652,
    author: "deleted_user_2104797",
    title: "Hoot_2.wav",
    startSeconds: 0.2,
    lengthSeconds: 1.15,
    fadeOutSeconds: 0.1,
  },
  {
    id: "airhorn",
    kind: "buzz",
    label: "Airhorn",
    freesoundId: 414208,
    author: "jacksonacademyashmore",
    title: "Airhorn",
    startSeconds: 0,
    lengthSeconds: 1.45,
    fadeOutSeconds: 0.1,
  },
  {
    id: "gong",
    kind: "buzz",
    label: "Gong",
    freesoundId: 56240,
    author: "Q.K.",
    title: "Gong_Center_Clear.wav",
    startSeconds: 0,
    lengthSeconds: 1.45,
    fadeOutSeconds: 0.15,
  },
  {
    id: "game-powerup",
    kind: "buzz",
    label: "Game Powerup",
    freesoundId: 368651,
    author: "Jofae",
    title: "Game Powerup",
    startSeconds: 0,
    lengthSeconds: 1.12,
    fadeOutSeconds: 0.04,
  },
  {
    id: "elephant-trumpet",
    kind: "buzz",
    label: "Elephant Trumpet",
    freesoundId: 527845,
    author: "D.jones",
    title: "Elephant Trumpets Growls.flac",
    startSeconds: 0,
    lengthSeconds: 1.4,
    fadeOutSeconds: 0.1,
  },
  {
    id: "swanee-whistle",
    kind: "buzz",
    label: "Swanee Whistle",
    freesoundId: 497092,
    author: "v0idation",
    title: "FX swanee whistle up.wav",
    startSeconds: 0,
    lengthSeconds: 1.23,
    fadeOutSeconds: 0.04,
  },

  // ---- System cues (section 7 "System cues: all approved"). time-up is NOT here: no CC0
  // double-beep exists, so it is synthesized in apps/web/src/lib/room/room-audio.ts.
  {
    id: "board-ready",
    kind: "cue",
    label: "Board Ready",
    freesoundId: 680825,
    author: "stomachache",
    title: "Countdown Start",
    startSeconds: 0,
    lengthSeconds: 1.2,
    fadeOutSeconds: 0.08,
  },
  {
    id: "wrong-answer",
    kind: "cue",
    label: "Wrong Answer",
    freesoundId: 650842,
    author: "-Andreas",
    title: "Wrong Answer Buzzer",
    startSeconds: 0,
    lengthSeconds: 0.31,
    fadeOutSeconds: 0.03,
  },
  {
    id: "wager-sting",
    kind: "cue",
    label: "Wager Sting",
    freesoundId: 221642,
    author: "eggsandwichent",
    title: "Ba Dum Bum ALL.aif",
    startSeconds: 0.4,
    lengthSeconds: 1.4,
    fadeOutSeconds: 0.12,
  },

  // ---- Think-music beds (section 7 "Think music: 3 approved"), cut to 30 s beds.
  {
    id: "think-elevator",
    kind: "music",
    label: "Elevator",
    freesoundId: 659889,
    author: "BlondPanda",
    title: "Short Elevator Music Loop",
    startSeconds: 0,
    lengthSeconds: 27.1,
  },
  {
    id: "think-bossa",
    kind: "music",
    label: "Bossa Nova",
    freesoundId: 464924,
    author: "plasterbrain",
    title: "(Bossa Nova Loop) Thank You for Shopping!",
    startSeconds: 0,
    lengthSeconds: 12.1,
  },
  {
    id: "think-lounge",
    kind: "music",
    label: "Smooth Keys",
    freesoundId: 681097,
    author: "deleted_user_14795591",
    title: "Lounging - Smooth Keys.wav",
    startSeconds: 0,
    lengthSeconds: 26.4,
  },

  // ---- The lobby track. PLACEHOLDER DEFAULT, not the owner's pick: round 4 of the Listening
  // Rooms is still open (media-and-sounds.md section 9, "Round-4 candidates"). This is F1, the
  // round's only CC0 entry that clears the owner's 2-3 minute lap floor. Swapping it is one
  // edit to this row - the id, the slot, and every consumer stay put.
  {
    id: "lobby-theme",
    kind: "music",
    label: "Funk Rock",
    freesoundId: 724495,
    author: "carloseton",
    title: "Funk Rock, 135 BPM",
    startSeconds: 0,
    lengthSeconds: 243,
  },
];
