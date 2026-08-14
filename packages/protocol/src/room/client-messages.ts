// Client -> server room message catalog. Every message rides the versioned wire envelope
// (envelope/wire.ts); `parseRoomClientMessage` is the DO's single entry point and refuses
// malformed shapes and version skew before any game code runs.
//
// Role authority (enforced by the DO; the matrix for relayed engine actions lives in
// authority.ts):
//
// | Message         | Who may send                                                          |
// | --------------- | --------------------------------------------------------------------- |
// | join            | anyone (role=host additionally requires the creation-time hostToken)  |
// | resume          | anyone holding a session token from a previous join                   |
// | action          | per the engine-action authority matrix (authority.ts)                 |
// | team-create     | player, lobby only (creator becomes leader - user-flows A2)           |
// | team-join       | player, lobby only, target team unlocked                              |
// | team-update     | the team's leader, or host (rename/color/buzz-sound/lock)             |
// | team-kick       | the team's leader (own team), or host (any player, any team)          |
// | team-handoff    | the team's leader, or host                                            |
// | identity-update | the player themself (rate-limited; locked during the armed window)    |
// | rename-player   | host only (host supremacy over any nickname)                          |
// | kick-player     | host only (removes from the room, not just the team)                  |
// | sync            | anyone joined (asks for a fresh snapshot after a missed-event gap)    |
// | leave           | anyone joined (explicit exit; a dropped socket is NOT a leave)        |
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
import { teamIdSchema } from "./roster.ts";

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
    team: joinTeamIntentSchema.optional(),
    hostToken: hostTokenSchema.optional(),
  }),
  z.strictObject({
    ...envelopeFields,
    type: z.literal("resume"),
    sessionToken: sessionTokenSchema,
  }),
  z.strictObject({ ...envelopeFields, type: z.literal("action"), action: relayedActionSchema }),
  z.strictObject({ ...envelopeFields, type: z.literal("team-create"), name: teamNameSchema }),
  z.strictObject({ ...envelopeFields, type: z.literal("team-join"), teamId: teamIdSchema }),
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
