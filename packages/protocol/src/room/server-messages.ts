// Server -> client room message catalog. Delivery contract per message:
//
// | Message      | Delivery                                                                    |
// | ------------ | --------------------------------------------------------------------------- |
// | welcome      | to the joining/resuming connection only, before anything else               |
// | refused      | to the refused connection; room-level reasons then close (codes below),     |
// |              | team-level reasons keep the socket for a retry with another team            |
// | snapshot     | to one connection (join/resume/sync); role-redacted (see `game` note)       |
// | event        | broadcast after every accepted engine transition; role-redacted             |
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
import { mediaRefSchema } from "../content/media-ref.ts";
import { extensionBagSchema } from "../ext.ts";
import { protocolVersion } from "../envelope/wire.ts";
import { limits } from "../limits.ts";
import {
  curatedAssetIdSchema,
  playerIdSchema,
  roomRoleSchema,
  sessionTokenSchema,
} from "./identity.ts";
import { roomSettingsSchema } from "./room-settings.ts";
import { rosterPayloadSchema, teamIdSchema } from "./roster.ts";

const envelopeFields = {
  version: z.literal(protocolVersion),
  ext: extensionBagSchema.optional(),
};

export const roomCodeSchema = z
  .string()
  .regex(new RegExp(`^[A-Z0-9]{${String(limits.room.roomCodeLength)}}$`));
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
  // Password rooms (docs/decisions/2026-08-14-room-visibility-and-lobby.md). Both reasons
  // KEEP the socket so the phone can prompt and retry on the same connection - the only
  // difference between them is whether the client sent a password at all, which the client
  // already knows. Attempts are rate-limited per connection (limits.room.passwordAttempt*);
  // the connection that exhausts them is closed with joinRefused.
  "password-required",
  "bad-password",
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

export const clueContentSchema = z.strictObject({
  target: clueContentTargetSchema,
  // Category title - chrome the display shows above the clue.
  category: z.string().max(80),
  prompt: z
    .strictObject({ text: z.string().max(2000), media: mediaRefSchema.optional() })
    .nullable(),
  // Host only. `accepted` carries the authored equivalents so a host card can show them.
  answer: z
    .strictObject({
      canonical: z.string().max(500),
      accepted: z.array(z.string().max(500)).max(20),
      media: mediaRefSchema.optional(),
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
  // mode is decoration. Carries no secret - `entry` says a password exists, never what it is.
  z.strictObject({
    ...envelopeFields,
    type: z.literal("room-settings"),
    settings: roomSettingsSchema,
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
// late-join-disabled) close the
// socket; TEAM-level join refusals (team-locked, unknown-team) deliberately do NOT - the
// phone keeps its socket and retries the join with another team card. PASSWORD refusals
// (password-required, bad-password) behave like the team ones - retry on the same socket -
// until the per-connection attempt budget runs out, which closes with joinRefused.
export const roomCloseCodes = {
  roomClosed: 4000,
  badToken: 4401,
  joinRefused: 4403,
  noSuchRoom: 4404,
  roomFull: 4409,
} as const;
