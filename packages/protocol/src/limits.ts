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
    // Video is the expensive kind and the cap says so: ~60 MB is a couple of minutes of
    // compressed 720p, which is already longer than any clue should hold a room. Anything
    // else ("file") is small by definition - it is handed over, not played.
    videoMaxBytes: 60 * mebibyte,
    fileMaxBytes: 10 * mebibyte,
    // Per-game total across all clue media, so one game cannot silently become a media dump.
    gameTotalMaxBytes: 200 * mebibyte,
  },
  room: {
    // Soft cap = the supported product promise (2-100 players); hard cap = the refusal point,
    // headroom included so a team rebalance mid-join never bounces player 101 of a full room.
    // The host's own `maxPlayers` setting rides BELOW these: hosts tune down, never up
    // (docs/design/expansion-and-boundaries.md boundary 2.7).
    playerSoftCap: 100,
    playerHardCap: 128,
    // Spectators are a SEPARATE budget from players (docs/decisions/2026-08-14-room-controls-
    // and-staging.md): a streamed room's audience must never be able to crowd out the people
    // who came to play, so the two are counted, capped and refused independently. The soft cap
    // is the default a room starts with; the hard cap is the ceiling a host cannot lift.
    spectatorSoftCap: 50,
    spectatorHardCap: 100,
    // How long a room with ZERO connected participants survives before it closes itself.
    // Distinct from idleExpiryMs, which protects rooms that are OCCUPIED but dormant: this one
    // answers "everyone left", and 15 minutes is long enough for a venue to lose its Wi-Fi and
    // come back while short enough that abandoned rooms stop squatting on codes and lobby slots.
    emptyRoomGraceMs: 15 * 60 * 1000,
    // 5 uppercase-alphanumeric chars ~= 33 million codes - collision-safe for idFromName rooms
    // while staying shoutable across a noisy hall.
    roomCodeLength: 5,
    // Room lifetime after the last client activity (docs/decisions/2026-08-13-single-origin-binding.md
    // lifecycle): the expiry alarm wipes the DO, frees the code, and later joins get no-such-room.
    // 2h idle covers a dinner break mid-game night without keeping dead rooms alive for days.
    idleExpiryMs: 2 * 60 * 60 * 1000,
    // Listing metadata (docs/decisions/2026-08-14-room-visibility-and-lobby.md): the title is
    // one line of a lobby row on a phone, the host label is a name or a club - never a bio.
    // Both are host-supplied strings that strangers read, so they are capped, not trusted.
    roomTitleMaxLength: 60,
    hostLabelMaxLength: 32,
  },
  lobby: {
    // Rooms returned by one public-lobby query (GET /api/rooms), newest first. A browse
    // surface, not a directory: pagination is deliberately deferred, so this cap IS the list.
    listingMax: 40,
    // Edge/browser cache lifetime of that response. Long enough that a refreshing lobby costs
    // one D1 read per interval across all viewers, short enough that a room a host just
    // created shows up while they are still looking at the screen.
    listingCacheSeconds: 10,
    // How often the lobby page re-queries. It is a browse surface, not a live room - no
    // socket, no push (same decision doc).
    listingRefreshMs: 15 * 1000,
  },
  player: {
    nicknameMinLength: 1,
    // Long enough for "Team Environmental Sequoias", short enough for the roster UI and
    // the scoreboard strip on a phone.
    nicknameMaxLength: 24,
    // Post-join rename rate limit (user-flows "Post-join customization": anti-confusion, not
    // anti-fun) - burst per sliding window, applied to nickname changes only; avatar/sound
    // swaps are unmetered.
    renameBurstMax: 3,
    renameWindowMs: 60 * 1000,
  },
  team: {
    teamMaxCount: 32,
    teamNameMinLength: 1,
    teamNameMaxLength: 40,
    // Leader-disconnect succession grace (user-flows "Teams & leadership"): leadership
    // auto-passes to the longest-tenured connected member only after this much continuous
    // absence, so a phone-sleep blip never reshuffles the crown.
    leaderDisconnectGraceMs: 30 * 1000,
  },
  buzz: {
    // THE TRUST CEILING of latency compensation (docs/decisions/2026-08-17-buzz-latency-
    // compensation.md). A buzz carries a number the CLIENT produced (ms since it saw the arm),
    // and no server can verify it - so the room never credits more than this much network
    // handicap, whatever the client says and whatever its measured round trip is. The security
    // property this buys, stated exactly: a lying client can gain at most as much as an HONEST
    // client on the same connection would be given, and never more than this ceiling.
    //
    // 250ms is the ceiling because it is roughly the p95 round trip of a phone on congested
    // venue Wi-Fi: high enough that the handicap it exists to cancel is actually cancelled, low
    // enough that the worst cheat is comparable to one human reaction time rather than a free win.
    maxCompensationMs: 250,
    // Hard ceiling on the host-tunable adjudication window (settings.buzzing.compensationWindowMs):
    // how long the room may hold buzzes before crowning a winner. A window longer than this
    // would be felt in the room as a lag between the press and the sound, which is a worse
    // failure than the unfairness it corrects.
    compensationWindowMaxMs: 500,
    // A round-trip sample above this is not a slow phone, it is a broken one (or a client
    // stalling its ack to farm compensation); it is discarded rather than trusted.
    roundTripSampleMaxMs: 2000,
  },
  wire: {
    // A client message is an envelope + small payload (a buzz, a wager, a typed Final answer).
    // 4 KiB is an order of magnitude of headroom; anything larger is a bug or abuse.
    clientMessageMaxBytes: 4 * kibibyte,
    // Rate limit per connection, enforced in the DO for every role except the host (the
    // console authenticated with the creation token and legitimately bursts - keyboard
    // judging, undo runs, sound check). Normal player traffic peaks at ~2 msgs/s (buzz spam).
    clientMessagesPerSecondMax: 10,
  },
} as const;

export type Limits = typeof limits;
