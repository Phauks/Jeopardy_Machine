// Client -> server room message catalog. Every message rides the versioned wire envelope
// (envelope/wire.ts); `parseRoomClientMessage` is the DO's single entry point and refuses
// malformed shapes and version skew before any game code runs.
//
// Role authority (enforced by the DO; the matrix for relayed engine actions lives in
// authority.ts):
//
// | Message         | Who may send                                                          |
// | --------------- | --------------------------------------------------------------------- |
// | join            | anyone; a password room additionally requires `password` from every    |
// |                 | role EXCEPT host (the creation-time hostToken already proves the       |
// |                 | stronger claim). Wrong/missing password = a `refused` that KEEPS the   |
// |                 | socket for a retry, rate-limited per connection (limits.room)          |
// | resume          | anyone holding a session token from a previous join                   |
// | action          | per the engine-action authority matrix (authority.ts)                 |
// | team-create     | player, lobby only (creator becomes leader - user-flows A2)           |
// | team-join       | player, lobby only, target team unlocked (also how a MOVE is sent);   |
// |                 | the HOST may name `playerId` to seat somebody else (host supremacy)   |
// | team-leave      | player, lobby only (back to the holding area; never refused)          |
// | team-update     | the team's leader, or host (rename/color/buzz-sound/lock)             |
// | team-kick       | the team's leader (own team), or host (any player, any team)          |
// | team-handoff    | the team's leader, or host                                            |
// | identity-update | the player themself (rate-limited; locked during the armed window)    |
// | rename-player   | host only (host supremacy over any nickname)                          |
// | kick-player     | host only (removes from the room, not just the team)                  |
// | sync            | anyone joined (asks for a fresh snapshot after a missed-event gap)    |
// | leave           | anyone joined (explicit exit; a dropped socket is NOT a leave)        |
// | set-pause       | host only (freezes the room and parks every running timer)            |
// | expire-timer    | host only ("skip the wait": fires whichever timer the room is on)     |
// | update-room-settings | host only (listing, caps, spectators, streamer mode, password)   |
// | close-room      | host only (ends the room for everyone - the polite screen everywhere) |
import { z } from "zod";
import { extensionBagSchema } from "../ext.ts";
import { limits } from "../limits.ts";
import { protocolVersion } from "../envelope/wire.ts";
import {
  curatedAssetIdSchema,
  hostTokenSchema,
  nicknameSchema,
  playerIdSchema,
  roomRoleSchema,
  sessionTokenSchema,
} from "./identity.ts";
import { roomSettingsPatchSchema } from "./room-settings.ts";
import { teamIdSchema } from "./roster.ts";
import { roomPasswordSchema } from "./visibility.ts";

// Every concrete message is strict (unknown fields only in ext) and carries the envelope
// fields itself, so one parse validates envelope + payload in a single pass.
const envelopeFields = {
  version: z.literal(protocolVersion),
  ext: extensionBagSchema.optional(),
};

const teamNameSchema = z
  .string()
  .min(limits.team.teamNameMinLength)
  .max(limits.team.teamNameMaxLength);

// Team intent at join time (user-flows A2): tap an existing team's card, or found a new one
// (which makes you its leader). Only meaningful for role=player in a teams-mode room.
export const joinTeamIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("join"), teamId: teamIdSchema }),
  z.strictObject({ kind: z.literal("create"), name: teamNameSchema }),
]);
export type JoinTeamIntent = z.infer<typeof joinTeamIntentSchema>;

// A relayed engine action, shipped WITHOUT `at` and WITHOUT actor identity - the server
// stamps arrival time and the session's playerId/entityId (authority.ts documents which
// fields are stamped per action). Loose here on purpose: the full action shape belongs to
// @jeopardy/engine, which depends on this package - the DO re-validates against
// gameActionSchema after stamping, so nothing unvalidated ever reaches the engine.
export const relayedActionSchema = z.looseObject({ type: z.string().min(1) });

export const roomClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...envelopeFields,
    type: z.literal("join"),
    role: roomRoleSchema,
    // Required for role=player, ignored for display/spectator (they are anonymous
    // observers), optional label for host consoles.
    nickname: nicknameSchema.optional(),
    avatarId: curatedAssetIdSchema.optional(),
    accentId: curatedAssetIdSchema.optional(),
    buzzSoundId: curatedAssetIdSchema.optional(),
    // Absent when the player never touched the control, which is the neutral default and not
    // a value the server may fill in (identity.ts).
    skinToneId: curatedAssetIdSchema.optional(),
    team: joinTeamIntentSchema.optional(),
    hostToken: hostTokenSchema.optional(),
    // The shared room secret, when the room has one (docs/decisions/2026-08-14-room-
    // visibility-and-lobby.md). It rides the join MESSAGE, never the URL or a query string:
    // room links get pasted into group chats and printed on QR codes, and a secret in a URL
    // ends up in browser history, referrers, and access logs.
    password: roomPasswordSchema.optional(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("resume"),
    sessionToken: sessionTokenSchema,
  }),
  z.strictObject({ ...envelopeFields, type: z.literal("action"), action: relayedActionSchema }),
  z.strictObject({ ...envelopeFields, type: z.literal("team-create"), name: teamNameSchema }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("team-join"),
    teamId: teamIdSchema,
    // WHO is being seated. Absent = the sender, which is every phone's own move between team
    // cards. Present = the host seating somebody else from the console's roster panel, which
    // is host supremacy over team membership (guiding principle 4, and the "drag to rebalance"
    // of user-flows C2); a player sending it for anybody but themself is refused. It rides
    // team-join rather than a new message because it is the same edit with a different actor -
    // the alternative was a console that could only eject a mis-seated player and ask them to
    // re-pick on their own phone.
    playerId: playerIdSchema.optional(),
  }),
  // Step out of a team back to the holding area, without picking another. Its own message
  // rather than `team-join` with a null teamId: those are different intents and the authority
  // matrix treats them differently (a locked team can refuse a join; nothing refuses a leave).
  z.strictObject({ ...envelopeFields, type: z.literal("team-leave") }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("team-update"),
    // Which team: leaders omit it (their own team is unambiguous); the HOST must name the
    // team it is overriding. A leader naming someone else's team is refused.
    teamId: teamIdSchema.optional(),
    // Sparse: only present fields change. Leaders may retune any subset mid-lobby;
    // the armed-window identity lock applies (server-messages error reason identity-locked).
    name: teamNameSchema.optional(),
    colorId: curatedAssetIdSchema.nullable().optional(),
    buzzSoundId: curatedAssetIdSchema.nullable().optional(),
    locked: z.boolean().optional(),
  }),
  z.strictObject({ ...envelopeFields, type: z.literal("team-kick"), playerId: playerIdSchema }),
  z.strictObject({ ...envelopeFields, type: z.literal("team-handoff"), playerId: playerIdSchema }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("identity-update"),
    nickname: nicknameSchema.optional(),
    avatarId: curatedAssetIdSchema.nullable().optional(),
    accentId: curatedAssetIdSchema.nullable().optional(),
    buzzSoundId: curatedAssetIdSchema.nullable().optional(),
    // Sparse like its siblings: absent = leave the tone alone, explicit null = go back to the
    // pack's own colors (identity.ts explains why those are two different things).
    skinToneId: curatedAssetIdSchema.nullable().optional(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("rename-player"),
    playerId: playerIdSchema,
    nickname: nicknameSchema,
  }),
  z.strictObject({ ...envelopeFields, type: z.literal("kick-player"), playerId: playerIdSchema }),
  z.strictObject({ ...envelopeFields, type: z.literal("sync") }),
  z.strictObject({ ...envelopeFields, type: z.literal("leave") }),
  // Host freeze. Room-level, NOT an engine action: the engine has no pause concept, so the
  // room parks its alarm book (each running timer keeps its remaining time) and says so.
  // Guiding principle 4 - every automated step has a manual override.
  z.strictObject({ ...envelopeFields, type: z.literal("set-pause"), paused: z.boolean() }),
  // "Skip the wait": fire the timer the room is currently waiting on, right now. Ordinary
  // expiries are SERVER-driven (the DO's alarm book fires them; a client can never forge
  // time), so this is a host convenience over the same path rather than a new authority -
  // the host may already relay each *-timeout action by name (authority.ts).
  z.strictObject({ ...envelopeFields, type: z.literal("expire-timer") }),
  // Change the ROOM (not the game): listing, caps, spectators, streamer mode, password, title.
  // Sparse - only the named fields move - and answered by a `room-settings` broadcast to
  // everyone, because the whole point is that a display reacts to the change immediately
  // (docs/decisions/2026-08-14-room-controls-and-staging.md). The same patch shape rides
  // PATCH /api/rooms/<CODE> for hosts holding a token but no socket.
  z.strictObject({
    ...envelopeFields,
    type: z.literal("update-room-settings"),
    settings: roomSettingsPatchSchema,
  }),
  // End the room for everyone: every connection gets room-closed(host-closed) and closes.
  z.strictObject({ ...envelopeFields, type: z.literal("close-room") }),
]);

export type RoomClientMessage = z.infer<typeof roomClientMessageSchema>;
export type RoomClientMessageType = RoomClientMessage["type"];

export type RoomClientMessageParseResult =
  | { ok: true; message: RoomClientMessage }
  // Mirrors EnvelopeParseResult's split (envelope/wire.ts): unsupported-version earns the
  // user-visible refresh prompt, malformed is a bug or an attacker.
  | { ok: false; reason: "malformed" | "unsupported-version"; detail: string };

// The DO's single parse entry point. Version skew is detected FIRST (any object with a
// non-current integer version is skew, whatever its type), so a stale client always gets
// the actionable error even when its message shape has drifted too.
export function parseRoomClientMessage(raw: unknown): RoomClientMessageParseResult {
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
        detail: `this server speaks protocol version ${String(protocolVersion)}, message declared version ${String(declared)}`,
      };
    }
  }
  const parsed = roomClientMessageSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "malformed",
      detail: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  return { ok: true, message: parsed.data };
}
