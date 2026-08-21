// Room-scoped identity: who a connection is and what it may do. Two separate strings matter
// and must never be conflated (docs/design/user-flows.md A2/A5):
//
// - `playerId` - the PUBLIC seat identifier. It appears in rosters, engine actions, and
//   broadcast events; it is also the engine's participant id, so one identity spans the
//   roster tier and the game state.
// - `sessionToken` - the SECRET resume credential, minted at join, held in the phone's
//   sessionStorage, presented on reconnect. It never appears in any broadcast message.
//
// Roles are the explicit protocol vocabulary from user-flows ("Roles are explicit in the
// protocol (M3): host | display | player | spectator"). Multiple displays are allowed;
// co-host consoles ride the same host role later.
import { z } from "zod";
import { limits } from "../limits.ts";

export const roomRoleSchema = z.enum(["host", "display", "player", "spectator"]);

/**
 * What a connection is running on, coarsely - the only question a host actually asks about a
 * device (owner, 2026-08-20: "show in roster whether users are on mobile or computers").
 *
 * TWO VALUES, deliberately, and neither of them is a model or an operating system. A host
 * scanning a roster before starting wants to know who is holding a buzzer they can hit with a
 * thumb and who is at a keyboard - because that is what predicts a slow buzz, a shared
 * screen, or a person who wandered off with the tab open. Anything finer would be a
 * fingerprint: this room needs no accounts, and a roster that recorded browsers and platforms
 * would be collecting data the product has no use for.
 *
 * Reported by the CLIENT, from the browser's own coarse-pointer query rather than from a
 * user-agent string (client-messages.ts `deviceKind` explains why). Absent means "did not
 * say" and is rendered as nothing, never guessed at.
 */
export const deviceKindSchema = z.enum(["phone", "computer"]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;
export type RoomRole = z.infer<typeof roomRoleSchema>;

// Same shape as the engine's participantIdSchema (packages/engine/src/actions.ts) - the
// engine consumes protocol, not the reverse, so the constraint is restated here and the
// realtime test suite holds a gate asserting the two accept the same ids.
export const playerIdSchema = z.string().min(1).max(64);
export type PlayerId = z.infer<typeof playerIdSchema>;

// Server-minted, 128 bits of hex. Long enough to be unguessable for a 2h room, short enough
// to live happily in sessionStorage. Only the DO ever generates these.
export const sessionTokenSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type SessionToken = z.infer<typeof sessionTokenSchema>;

// Host credential returned by room creation (docs/decisions/2026-08-13-single-origin-binding.md:
// "Host identity for the room = a creation-time token"). Same shape as a session token but a
// separate schema on purpose: the two are different secrets with different lifetimes.
export const hostTokenSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type HostToken = z.infer<typeof hostTokenSchema>;

export const nicknameSchema = z
  .string()
  .min(limits.player.nicknameMinLength)
  .max(limits.player.nicknameMaxLength);

// Curated-set identifiers (avatar sprites, accent palette entries, buzzer pack sounds).
// The protocol validates shape only; whether an id names a real asset is the client's
// lookup problem - an unknown id renders as the default, never an error mid-game.
export const curatedAssetIdSchema = z.string().min(1).max(40);

// The personal customization tier (user-flows "Teams & leadership"): everything a player
// controls about themselves, editable post-join (identity-update) within rate limits.
export const personalIdentitySchema = z.strictObject({
  nickname: nicknameSchema,
  avatarId: curatedAssetIdSchema.nullable(),
  accentId: curatedAssetIdSchema.nullable(),
  // In individuals mode this is the room-audible buzz sound; in teams mode it plays only on
  // the player's own phone (owner directive: team-scoped buzz sounds).
  buzzSoundId: curatedAssetIdSchema.nullable(),
  // The human models' skin tone (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md).
  //
  // OPTIONAL AND NULLABLE, and the two mean different things on purpose. Absent = a client
  // that predates the field, which is why it is optional rather than required-nullable: this
  // is an additive change and an older phone's join must keep validating. Present-and-null =
  // this player has not chosen a tone, and their avatar renders in the pack's own colors.
  // Neither ever means "guess one" - nothing anywhere may infer a tone from a nickname, an
  // avatar, or a locale (the decision's "never inferred, never defaulted from anything but a
  // neutral"). Like every other curated id the protocol checks the shape only; whether it
  // names a tone this build ships is the client's lookup problem.
  skinToneId: curatedAssetIdSchema.nullable().optional(),
});
export type PersonalIdentity = z.infer<typeof personalIdentitySchema>;
