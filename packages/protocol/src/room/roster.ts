// The roster: the room's participant list plus the two customization tiers from
// docs/design/user-flows.md "Teams & leadership". Team membership and personal identity live
// HERE (room tier), not in engine state - the engine only learns seats at start-game, so the
// lobby can rearrange teams freely without engine actions. After start, the roster stays the
// source of truth for presentation (names, avatars, sounds) while the engine owns scores.
//
// The tiers are separate protocol shapes on purpose (owner directive): personal identity is
// never leader-editable, team customization is never member-editable, and the host console
// out-ranks both (guiding principle 4).
import { z } from "zod";
import { limits } from "../limits.ts";
import {
  curatedAssetIdSchema,
  deviceKindSchema,
  nicknameSchema,
  personalIdentitySchema,
  playerIdSchema,
} from "./identity.ts";

export const teamIdSchema = z.string().min(1).max(64);
export type TeamId = z.infer<typeof teamIdSchema>;

// The team customization tier, leader-controlled. `leaderPlayerId` moves via team-handoff,
// leader-disconnect succession (after the grace in limits.team), or host override.
export const teamDocSchema = z.strictObject({
  teamId: teamIdSchema,
  name: z.string().min(limits.team.teamNameMinLength).max(limits.team.teamNameMaxLength),
  colorId: curatedAssetIdSchema.nullable(),
  // The room-audible buzz sound in teams mode (leader-picked; the double-confirmation
  // directive: room hears the TEAM's sound while the display shows the team name/color).
  buzzSoundId: curatedAssetIdSchema.nullable(),
  leaderPlayerId: playerIdSchema.nullable(),
  // Lock = no new joiners (the anti-nuisance tool after a kick, not a ban list).
  locked: z.boolean(),
});
export type TeamDoc = z.infer<typeof teamDocSchema>;

export const rosterEntrySchema = z.strictObject({
  playerId: playerIdSchema,
  identity: personalIdentitySchema,
  teamId: teamIdSchema.nullable(),
  connected: z.boolean(),
  // Unix ms of first join - team-leadership succession picks the longest-tenured connected
  // member, and the roster UI sorts by it.
  joinedAt: z.number().int().nonnegative(),
  /**
   * Phone or computer, as this seat's own client reported it (identity.ts explains the two
   * values and why it is client-reported). Absent means the client did not say, which the
   * console renders as nothing rather than as a guess.
   */
  deviceKind: deviceKindSchema.optional(),
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

/**
 * A WATCHER, since 2026-08-20 (owner: "spectators still should have a name").
 *
 * Deliberately not a `rosterEntry`: a spectator holds no seat, no team, no score and no
 * curated identity, and giving them the player shape would invite every surface that iterates
 * players to iterate these too. What a spectator has is a connection, optionally a name, and
 * the kind of device it is on.
 *
 * `name` is nullable rather than optional because absent and anonymous are the same thing
 * here and the distinction would be noise: somebody watching without giving a name is one
 * state, and the console says "someone watching" for it.
 */
export const spectatorEntrySchema = z.strictObject({
  spectatorId: playerIdSchema,
  name: nicknameSchema.nullable(),
  deviceKind: deviceKindSchema.optional(),
  joinedAt: z.number().int().nonnegative(),
});
export type SpectatorEntry = z.infer<typeof spectatorEntrySchema>;

// The full roster payload as broadcast in `roster` messages and embedded in snapshots.
// Always sent whole: at the 128-player hard cap this is a few KB, and whole-payload sync
// makes the client store trivial (no roster diffing protocol to get wrong in M4).
export const rosterPayloadSchema = z.strictObject({
  players: z.array(rosterEntrySchema).max(limits.room.playerHardCap),
  teams: z.array(teamDocSchema).max(limits.team.teamMaxCount),
  // THE AUDIENCE, as a number and never as a list. Spectators hold no seat and give no
  // identity - a spectator is a live connection and nothing else - so the only honest thing a
  // roster can carry about them is how many there are, counted from connections by the one
  // party that can see them (the DO).
  //
  // OPTIONAL, and absent is NOT zero: absent means "this producer does not report its
  // audience", which is the state a client must render as unknown rather than as an empty
  // room (the same rule the lobby's capacity lines follow - apps/web/src/lib/lobby/
  // room-capacity.ts). A host console showing "0 watching" for a room nobody has counted is
  // the invented-number bug that rule exists to prevent.
  spectatorCount: z.int().nonnegative().max(limits.room.spectatorHardCap).optional(),
  /**
   * The audience BY NAME, for the host console (owner, 2026-08-20). Optional for exactly the
   * reason `spectatorCount` is: a producer that does not report its audience must not be read
   * as reporting an empty one.
   *
   * The count above stays the authority on HOW MANY - it is counted from live connections,
   * and it includes the watchers who gave no name. This list is what the console draws so a
   * host can see whether the person they are waiting for is in the room yet, which "12
   * watching" could never answer.
   *
   * NEVER leaves the room. The lobby's projection carries counts and no people at all
   * (registry.ts), and the diagnostics surface redacts identity by construction
   * (diagnostics.ts) - both of those rules are unchanged by this.
   */
  spectators: z.array(spectatorEntrySchema).max(limits.room.spectatorHardCap).optional(),
});
export type RosterPayload = z.infer<typeof rosterPayloadSchema>;
