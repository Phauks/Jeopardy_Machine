// Operational limits - the single documented home for every hard cap in the product
// (docs/design/expansion-and-boundaries.md, boundary 2.7). These are physics, not preferences:
// venue Wi-Fi, DO memory, R2 bills, and abuse set them, so hosts cannot lift them. They are
// surfaced in editor validation and join flows - never discovered at game time. We (the
// maintainers) tune the values with real-world data; changing one is an ordinary reviewed commit.
//
// Everything is `as const` so consumers get literal types and the object is deep-frozen by
// convention (nothing may mutate it; there is deliberately no runtime freeze - workers cold-start
// cost beats paranoia over our own code).

const kibibyte = 1024;
const mebibyte = 1024 * kibibyte;

export const limits = {
  media: {
    // Per-file caps by kind. ~10 MB covers any sane projector image; ~20 MB covers minutes of
    // compressed audio. Enforced client-side in the editor AND server-side at upload.
    imageMaxBytes: 10 * mebibyte,
    audioMaxBytes: 20 * mebibyte,
    // Per-game total across all clue media, so one game cannot silently become a media dump.
    gameTotalMaxBytes: 200 * mebibyte,
  },
  room: {
    // Soft cap = the supported product promise (2-100 players); hard cap = the refusal point,
    // headroom included so a team rebalance mid-join never bounces player 101 of a full room.
    playerSoftCap: 100,
    playerHardCap: 128,
    // 5 uppercase-alphanumeric chars ~= 33 million codes - collision-safe for idFromName rooms
    // while staying shoutable across a noisy hall.
    roomCodeLength: 5,
  },
  player: {
    nicknameMinLength: 1,
    // Long enough for "Team Environmental Sequoias", short enough for the roster UI and
    // the scoreboard strip on a phone.
    nicknameMaxLength: 24,
  },
  wire: {
    // A client message is an envelope + small payload (a buzz, a wager, a typed Final answer).
    // 4 KiB is an order of magnitude of headroom; anything larger is a bug or abuse.
    clientMessageMaxBytes: 4 * kibibyte,
    // Rate limit per connection, enforced in the DO. Normal play peaks at ~2 msgs/s (buzz spam).
    clientMessagesPerSecondMax: 10,
  },
} as const;

export type Limits = typeof limits;
