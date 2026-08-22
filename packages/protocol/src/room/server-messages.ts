// Server -> client room message catalog. Delivery contract per message:
//
// | Message      | Delivery                                                                    |
// | ------------ | --------------------------------------------------------------------------- |
// | welcome      | to the joining/resuming connection only, before anything else               |
// | refused      | to the refused connection; room-level reasons then close (codes below),     |
// |              | team-level reasons keep the socket for a retry with another team            |
// | snapshot     | to one connection (join/resume/sync); role-redacted (see `game` note);      |
// |              | carries the room's static facts too (teamsMode, board material, timers)     |
// | event        | broadcast after every accepted engine transition; role-redacted, and it     |
// |              | carries the state those events produced (see the `game` note on it)         |
// | arm-window   | broadcast the instant buzzers arm (and to a connection that joins while     |
// |              | an arming is open); carries the id a client acks and stamps its buzz with   |
// | buzz-won     | broadcast, EXACTLY ONCE per arming - the room-audio driver (owner           |
// |              | directive "Only the winning buzz is heard"; sound resolution note below)    |
// | buzz-rejected| to the losing/early phone only - silent local feedback, never room audio    |
// | roster       | broadcast on any roster or team change                                      |
// | clue-content | to each connection when a clue opens (and with a snapshot while one is      |
// |              | open); role-redacted - see clueContentSchema                                |
// | paused       | broadcast when the host freezes/resumes the room                            |
// | room-settings| to a joining connection, and broadcast on every host edit                   |
// | room-closed  | broadcast (or to one connection, for a kick), then those connections close  |
// | error        | to the offending connection only                                            |
//
// Close codes (WebSocket application range): 4404 no-such-room, 4401 bad token, 4409 room
// full (players AND spectators - both budgets are "this room has no space for you"), 4403
// join refused, 4000 room-closed. Clients treat any 44xx as "do not reconnect".
import { z } from "zod";
import { playerModeSchema } from "../settings/groups/teams.ts";
import { mediaKindSchema } from "../content/media-ref.ts";
import { idSchema } from "../ids.ts";
import { extensionBagSchema } from "../ext.ts";
import { protocolVersion } from "../envelope/wire.ts";
import { limits } from "../limits.ts";
import {
  curatedAssetIdSchema,
  playerIdSchema,
  roomRoleSchema,
  sessionTokenSchema,
} from "./identity.ts";
import { liveRulesSchema } from "./live-rules.ts";
import { roomSettingsSchema } from "./room-settings.ts";
import { rosterPayloadSchema, teamIdSchema } from "./roster.ts";

const envelopeFields = {
  version: z.literal(protocolVersion),
  ext: extensionBagSchema.optional(),
};

/**
 * The room-code alphabet: uppercase alphanumerics MINUS I, O, 0 and 1 - shoutable across a
 * noisy hall, un-mistakable on a projector. 32 characters, which is also what makes the
 * generator's modulo unbiased (create.ts `generateRoomCode`).
 *
 * It lives here, beside the schema, because the two must agree and for a week they did not:
 * the generator drew from these 32 characters while the schema accepted all 36. A typed `O`
 * therefore passed validation, dialled a socket, and came back "no such room" - the same
 * answer a room that ENDED gives, so a person who mistyped one character was told their
 * quiz was over. Nothing can fold a stray I/O/0/1 onto something else, either: no member of
 * this alphabet is confusable with them, which is the entire point of leaving them out. So
 * the only honest handling is to refuse the string early, by name.
 */
export const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The characters a code can never contain, for a refusal that can say which one is wrong. */
export const roomCodeExcludedCharacters = "IO01";

export const roomCodeSchema = z
  .string()
  .regex(new RegExp(`^[${roomCodeAlphabet}]{${String(limits.room.roomCodeLength)}}$`));
export type RoomCode = z.infer<typeof roomCodeSchema>;

export const refusalReasonSchema = z.enum([
  // The friendly bad-code error of user-flows A1; also what an expired room's code answers
  // (creation is explicit - connecting never creates, decision doc 2026-08-13).
  "no-such-room",
  // The PLAYER budget is spent (settings.maxPlayers, itself bounded by limits.room).
  "room-full",
  // The two spectator refusals, deliberately distinct from room-full and from each other
  // (docs/decisions/2026-08-14-room-controls-and-staging.md): a spectator turned away must be
  // able to say WHY - "the audience is full, try again in a minute" and "this host does not
  // allow spectators at all" are different screens and different advice. Neither ever consumes
  // a player seat, which is the entire point of the two budgets.
  "spectators-full",
  "spectators-not-allowed",
  "bad-host-token",
  "bad-session-token",
  "late-join-disabled",
  "team-locked",
  "unknown-team",
  // Team-create hit limits.team.teamMaxCount. A TEAM-tier refusal like the two above: the
  // connection survives and the player joins one of the teams that already exist. Distinct
  // from room-full because the room may have plenty of seats left - what is exhausted is the
  // number of teams the board can show, which is a fact about the room and not about them.
  "teams-full",
  // GONE 2026-08-20: "password-required" and "bad-password", the two reasons a room could
  // refuse a connection that knew its code. Rooms have no password any more (visibility.ts) -
  // the code is what admits people - so a connection that reaches a room is never turned away
  // for a secret it does not hold. Nothing replaces them: there is no third door.
]);
export type RefusalReason = z.infer<typeof refusalReasonSchema>;

export const errorReasonSchema = z.enum([
  "malformed",
  "unsupported-version",
  // The sender's role fails the authority matrix for what it tried to do.
  "unauthorized",
  // Sent something requiring a joined session (action/team/identity messages) before join.
  "not-joined",
  // The engine refused a relayed action; `detail` carries the engine's rejection reason.
  "action-rejected",
  // Nickname/team edits during the armed window (owner directive: the display never
  // relabels mid-adjudication) - retry after the clue resolves.
  "identity-locked",
  // Rename rate limit (limits.player.renameBurstMax per renameWindowMs) or the
  // per-connection message-rate cap (limits.wire.clientMessagesPerSecondMax).
  "rate-limited",
  "unknown-team",
  "unknown-player",
  // Structurally valid but impossible right now (join a team mid-game, create a 33rd team...).
  "rejected",
]);
export type RoomErrorReason = z.infer<typeof errorReasonSchema>;

// What `snapshot.game` contains, by receiving role (redaction happens in the DO;
// apps/realtime/src/room/redact.ts is the one implementation):
// - host: the full engine GameState minus actionLog/rngState (those are recovery internals).
// - everyone else: additionally hidden-wager-cell positions are emptied and uncommitted
//   final wagers/answers are stripped - phones and the public display must never receive
//   Daily-Double locations or secret wagers, even in devtools.
// Typed as unknown at the protocol layer because GameState belongs to @jeopardy/engine
// (which depends on this package); consumers cast to their engine version's GameState.
const gameViewSchema = z.unknown();

export const roomPhaseSchema = z.enum(["lobby", "active", "ended"]);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

// THE BOARD'S PUBLIC MATERIAL: category titles and face values, per round.
//
// Added at the M4 reconcile (2026-08-17), when wiring the real surfaces found the gap: the
// engine deals in coordinates and carries no titles or values in its state (GameSetup is not
// part of GameState, by design - packages/engine/src/setup.ts), and `clue-content` answers
// only for the clue that is OPEN. A display therefore had nothing to paint a board with. This
// is the missing half of the content channel, and it is deliberately its own shape rather
// than a second content message: it is STATIC for a room's whole life, it contains no answers
// and no prompts, and it is exactly what a projector already shows the room. Redaction does
// not apply - a face value is public the moment the board is on a wall.
//
// It rides the snapshot rather than a message of its own so that `sync` recovers everything a
// client needs in one round trip; a client that missed a standalone message would have had no
// way back to a board short of reconnecting.
export const boardMaterialSchema = z.strictObject({
  rounds: z.array(
    z.strictObject({
      categoryTitles: z.array(z.string().max(80)),
      /** cellValues[categoryIndex][rowIndex] - resolved face values, multipliers applied. */
      cellValues: z.array(z.array(z.int())),
    }),
  ),
});
export type BoardMaterial = z.infer<typeof boardMaterialSchema>;

// CLUE CONTENT - the one channel carrying authored prompt/answer text to clients. The engine
// deals in board coordinates and never sees a word of content (guiding principle 6), so this
// rides beside the event stream rather than inside it, resolved by the DO from the room's
// stored game definition.
//
// Redaction is the entire point (the DO's room/content.ts is the one implementation):
//
// | Role      | prompt                                        | answer |
// | --------- | --------------------------------------------- | ------ |
// | host      | always                                        | always |
// | display   | always (it IS the big screen)                 | never  |
// | player    | only when settings.join.clueTextOnPhones is on| never  |
// | spectator | same as display                               | never  |
//
// A null field means "this role does not get it" - the message still arrives so a client can
// render its layout without guessing whether more is coming.
export const clueContentTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("cell"),
    roundIndex: z.int().nonnegative(),
    category: z.int().nonnegative(),
    row: z.int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("final") }),
]);
export type ClueContentTarget = z.infer<typeof clueContentTargetSchema>;

// A clue's media, RESOLVED - what a surface needs to actually paint it, in one object.
//
// The clue used to carry `mediaRef` here, which is an id and nothing else. That is exactly
// right inside a document, where a separate `media` table maps ids to bytes-right-now and
// moving bytes never touches a content item (content/media-ref.ts). It is exactly wrong on the
// wire: a phone holds no document, so an id told it there WAS media and gave it no way to
// learn the kind, the type, the alt text or where the bytes are. Every picture clue rendered as
// text (owner, 2026-08-19). The room owns the pack, so the room does the lookup once and sends
// the answer.
//
// `url` is absent when the room has no fetchable bytes - a `pending-local` asset that never
// left the authoring device, or a bundled path nobody resolved before hosting. A surface then
// shows the alt text, which is what alt has always been for: "a11y, and the fallback when media
// is missing". Never a broken image.
export const resolvedMediaSchema = z.strictObject({
  mediaId: idSchema,
  kind: mediaKindSchema,
  mime: z.string().min(1).max(100),
  alt: z.string().max(300).optional(),
  url: z.url().optional(),
});
export type ResolvedMedia = z.infer<typeof resolvedMediaSchema>;

export const clueContentSchema = z.strictObject({
  target: clueContentTargetSchema,
  // Category title - chrome the display shows above the clue.
  category: z.string().max(80),
  prompt: z
    .strictObject({ text: z.string().max(2000), media: resolvedMediaSchema.optional() })
    .nullable(),
  // Host only. `accepted` carries the authored equivalents so a host card can show them.
  answer: z
    .strictObject({
      canonical: z.string().max(500),
      accepted: z.array(z.string().max(500)).max(20),
      media: resolvedMediaSchema.optional(),
    })
    .nullable(),
});
export type ClueContent = z.infer<typeof clueContentSchema>;

// What a client owes the room when buzzers arm (docs/decisions/2026-08-17-buzz-latency-
// compensation.md), in one shape so no surface has to infer it:
//
// 1. Note the local time this message was RENDERED - that is the phone's own t0, no clock
//    synchronization involved.
// 2. Send `arm-ack` with this armId immediately, before painting anything. The reply time is
//    how the server measures this connection's round trip, and a client that skips it is
//    ranked by raw arrival (never penalized below that, never compensated either).
// 3. Attach `timing: { armId, elapsedMs }` to the buzz action, elapsed measured from step 1.
//
// `compensationMs` is how long the room may hold buzzes before crowning a winner (0 = the
// setting is off and arrival order decides), so a phone can size its own optimistic feedback
// against the real wait instead of guessing.
export const armWindowSchema = z.strictObject({
  armId: z.int().nonnegative(),
  at: z.number().int().nonnegative(),
  compensationMs: z.int().nonnegative(),
  /** True for a re-arm after a wrong answer (the rebound), so a client can word it. */
  rebound: z.boolean(),
});
export type ArmWindow = z.infer<typeof armWindowSchema>;

// A timer the room is currently running, as remaining milliseconds. Present on every snapshot
// so a console or display that reconnects mid-clue can paint the countdown it missed
// (user-flows C6: "reopen console URL on any device -> full resume"). Remaining time rather
// than a deadline: the two clocks are not synchronized, and the client needs a duration anyway.
export const runningTimerSchema = z.strictObject({
  kind: z.string().min(1).max(40),
  remainingMs: z.number().int().nonnegative(),
});
export type RunningTimer = z.infer<typeof runningTimerSchema>;

export const roomServerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...envelopeFields,
    type: z.literal("welcome"),
    roomCode: roomCodeSchema,
    role: roomRoleSchema,
    // Player seats only; null for host/display/spectator (they re-join by URL + token).
    playerId: playerIdSchema.nullable(),
    // The resume credential (sessionStorage per user-flows A2); only ever sent to its owner.
    sessionToken: sessionTokenSchema.nullable(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("refused"),
    reason: refusalReasonSchema,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("snapshot"),
    // Monotonic per accepted engine transition; a client that sees event.stateVersion jump
    // by more than one missed a message and should send `sync`.
    stateVersion: z.number().int().nonnegative(),
    phase: roomPhaseSchema,
    // Engine state (see gameViewSchema note); null until start-game creates it.
    game: gameViewSchema.nullable(),
    roster: rosterPayloadSchema,
    // How this room seats people (rules row 34, frozen at creation). A room fact rather than a
    // room SETTING - it belongs to the game's rule set, not to the host's live controls - and
    // a client cannot derive it: in the lobby the engine has met nobody, so an empty `teams`
    // record says nothing. Without it a teams room's join screen offers no teams at all.
    //
    // The MODE, not a boolean: it was `teamsMode: boolean` until the third mode landed
    // (2026-08-19), and "mixed" is precisely the case a boolean cannot carry - teams exist AND
    // playing solo is a legitimate choice, which are two different answers a client needs to
    // give different screens (settings/groups/teams.ts: teamsAreOffered vs teamsAreRequired).
    playerMode: playerModeSchema,
    board: boardMaterialSchema,
    // Host-held freeze (the console's pause button). Room-level, not engine-level: the
    // engine has no pause concept, so the room parks its timers and says so.
    paused: z.boolean(),
    // Present while a clue is open, so a phone that reconnects mid-clue renders the same
    // screen it left; null otherwise. Redacted exactly like the standalone message.
    clueContent: clueContentSchema.nullable(),
    // Every timer the room is still running, with the time it has LEFT (empty while paused or
    // idle). Without this a reconnecting console shows a clue with no countdown and a host
    // has to guess how long the room has been waiting - user-flows C6, hardened in M6.
    timers: z.array(runningTimerSchema),
  }),
  z.strictObject({ ...envelopeFields, type: z.literal("arm-window"), arm: armWindowSchema }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("event"),
    stateVersion: z.number().int().nonnegative(),
    // GameEvent[] from @jeopardy/engine (typed unknown for the same layering reason as
    // `game`), role-redacted: everyone-answers submission text is stripped for everyone but
    // the host and the submitting phone.
    events: z.array(z.unknown()),
    // The state those events produced, redacted exactly like `snapshot.game`.
    //
    // Added at the M4 reconcile (2026-08-17). Events are NARRATION, not a diff: replaying the
    // action log regenerates them, but no client holds the log, the setup, or the engine's
    // seeded rng, so nothing on the wire let a display or a console rebuild GameState from an
    // event batch. The alternatives were both worse: asking every client to send `sync` after
    // every action turns one broadcast into N round trips that each wake the DO, and shipping
    // the action log would hand phones the wager positions redaction exists to hide. The state
    // is a few KB with the log and rng stripped, and it is computed once per ROLE per batch,
    // not once per connection.
    game: gameViewSchema.nullable(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("buzz-won"),
    stateVersion: z.number().int().nonnegative(),
    playerId: playerIdSchema,
    // The scoring entity: the team in teams mode, the player otherwise.
    entityId: z.string().min(1).max(64),
    teamId: teamIdSchema.nullable(),
    // Resolved server-side to the ROOM-audible sound: the team's in teams mode (leader-picked,
    // the double-confirmation directive), the winner's personal sound otherwise. Room audio
    // keys off this field of this message alone.
    buzzSoundId: curatedAssetIdSchema.nullable(),
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("buzz-rejected"),
    reason: z.enum([
      "not-armed",
      "early-lockout",
      "too-late",
      "locked-out",
      "not-captain",
      "unknown-player",
    ]),
    // Present for early-lockout: when this phone's buzzer unlocks (the visible penalty ring).
    lockedUntil: z.number().int().nonnegative().nullable(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("roster"),
    roster: rosterPayloadSchema,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("clue-content"),
    content: clueContentSchema,
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("paused"),
    paused: z.boolean(),
    at: z.number().int().nonnegative(),
  }),
  // The room's own settings, sent to a connection when it joins and broadcast to EVERYONE on
  // every host edit (docs/decisions/2026-08-14-room-controls-and-staging.md). Broadcast rather
  // than polled because the strictest requirement is instantaneous: a join code that just
  // became hidden must vanish from the projector at once, not at the next refresh, or streamer
  // mode is decoration. Carries no secret: there is nothing secret left in room settings.
  z.strictObject({
    ...envelopeFields,
    type: z.literal("room-settings"),
    settings: roomSettingsSchema,
    at: z.number().int().nonnegative(),
  }),
  /**
   * The RULES the room is currently playing by - sent on join beside the snapshot, and again
   * whenever the host retunes one (client-messages.ts `update-game-rules`).
   *
   * Separate from `room-settings` because they are different kinds of fact: room settings are
   * about the ROOM (who may come in, how many, what is on the projector), and these are about
   * the GAME (how long you have to answer, what a wrong answer costs). A phone reads this to
   * draw the right answer clock; a console reads it to show what the room is actually playing
   * by rather than what the game definition shipped with.
   */
  z.strictObject({
    ...envelopeFields,
    type: z.literal("game-rules"),
    rules: liveRulesSchema,
    at: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("room-closed"),
    // The polite screen a client shows keys off this alone (user-flows A5 "the host
    // kicks/renames ... phone shows a polite screen"): expired = the room aged out,
    // host-closed = the host ended it for everyone, kicked = this phone only.
    reason: z.enum(["expired", "host-closed", "kicked"]),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("error"),
    reason: errorReasonSchema,
    detail: z.string().max(500).optional(),
  }),
]);

export type RoomServerMessage = z.infer<typeof roomServerMessageSchema>;
export type RoomServerMessageType = RoomServerMessage["type"];

export type RoomServerMessageParseResult =
  | { ok: true; message: RoomServerMessage }
  | { ok: false; reason: "malformed" | "unsupported-version"; detail: string };

// Client-side mirror of parseRoomClientMessage: phones, displays, and bots parse every
// incoming frame through this one function.
export function parseRoomServerMessage(raw: unknown): RoomServerMessageParseResult {
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "malformed", detail: "message is not valid JSON" };
    }
  }
  if (typeof candidate === "object" && candidate !== null && "version" in candidate) {
    const declared = (candidate as { version: unknown }).version;
    if (
      typeof declared === "number" &&
      Number.isInteger(declared) &&
      declared !== protocolVersion
    ) {
      return {
        ok: false,
        reason: "unsupported-version",
        detail: `this client speaks protocol version ${String(protocolVersion)}, message declared version ${String(declared)}`,
      };
    }
  }
  const parsed = roomServerMessageSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "malformed",
      detail: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  return { ok: true, message: parsed.data };
}

// WebSocket close codes paired with `refused`/`room-closed` (documented here so both ends
// share one table; 4xxx is the application range the runtime passes through untouched).
// Room-level refusals (no-such-room, bad tokens, room-full, the spectator budget refusals,
// late-join-disabled) close the socket; TEAM-level join refusals (team-locked, unknown-team,
// teams-full) deliberately do NOT - the phone keeps its socket and retries the join with
// another team card. Those two tiers are the whole table now that passwords are gone; the
// third tier that used to sit between them retried on the same socket and, once a connection
// burned its guess budget, closed with joinRefused.
export const roomCloseCodes = {
  roomClosed: 4000,
  badToken: 4401,
  joinRefused: 4403,
  noSuchRoom: 4404,
  roomFull: 4409,
} as const;
