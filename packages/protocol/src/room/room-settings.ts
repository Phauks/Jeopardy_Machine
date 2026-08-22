// The room's own settings - what a HOST may change about the room itself, at any time, after
// it exists (docs/decisions/2026-08-14-room-controls-and-staging.md, "Room settings").
//
// Distinct from the GAME settings registry under src/settings/: those describe how a quiz is
// played and travel inside the rule set / game definition (the design law - customization
// lives in documents). These describe the ROOM as a place - who may come in, how many, and
// whether its code is safe to show on a stream - so they live on the room, are editable while
// it runs, and every change is broadcast to everyone connected.
//
// Two rules shape this module:
//
// 1. HOSTS TUNE DOWN, NEVER UP. Every cap here is bounded by @jeopardy/protocol/limits, which
//    hosts cannot lift (boundary 2.7). `maxPlayers` of 500 is not a bigger room, it is a
//    rejected payload.
// 2. THE CODE STILL WORKS WHEN IT IS HIDDEN. `hideJoinCode` is streamer mode: the display and
//    every shared surface stop RENDERING the code and its QR, so a stream audience cannot read
//    it off the screen. It is not a lock - the code still admits anyone who was given it, and
//    the host can reveal it on demand. There is no lock to reach for either (visibility.ts).
import { z } from "zod";
import { limits } from "../limits.ts";
import { hostLabelSchema, roomListingSchema, roomTitleSchema } from "./visibility.ts";

// Independent budgets, both bounded by limits: a stream audience must never be able to crowd
// out the people who came to play, which is the whole reason there are two numbers.
export const maxPlayersSchema = z.int().min(1).max(limits.room.playerHardCap);
export const maxSpectatorsSchema = z.int().min(0).max(limits.room.spectatorHardCap);

// What every client is told about the room it is in. Nothing here is or contains a secret, so
// this payload is safe on the display, on a phone, and in a log. It carried an `entry` axis
// (open / password) until 2026-08-20; passwords are gone and the code is the only thing that
// admits anybody (visibility.ts explains the trade).
export const roomSettingsSchema = z.strictObject({
  listing: roomListingSchema,
  maxPlayers: maxPlayersSchema,
  maxSpectators: maxSpectatorsSchema,
  spectatorsAllowed: z.boolean(),
  hideJoinCode: z.boolean(),
  // Echoed here (they are already public for a listed room) so one message carries everything
  // a surface renders about the room's identity - a title change reaches the projector the
  // same way a hidden code does.
  title: z.string().max(limits.room.roomTitleMaxLength),
  hostLabel: z.string().max(limits.room.hostLabelMaxLength),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

// The defaults a room is created with when the create payload says nothing. Private + open is
// the untouched QR flow (guiding principle 3): nothing a host does by accident publishes their
// game, and a room is private until a host says otherwise.
export const defaultRoomSettings = {
  listing: "private",
  maxPlayers: limits.room.playerSoftCap,
  maxSpectators: limits.room.spectatorSoftCap,
  spectatorsAllowed: true,
  hideJoinCode: false,
} as const satisfies Omit<RoomSettings, "title" | "hostLabel">;

// A host's edit: SPARSE, so a console can change one control without restating the room. It
// carried a `password` field until 2026-08-20 - the only field here that was ever a secret -
// and with passwords gone every field in this patch is public, which is why the whole thing
// travels straight back to every connection as `room-settings`.
export const roomSettingsPatchSchema = z
  .strictObject({
    listing: roomListingSchema.optional(),
    maxPlayers: maxPlayersSchema.optional(),
    maxSpectators: maxSpectatorsSchema.optional(),
    spectatorsAllowed: z.boolean().optional(),
    hideJoinCode: z.boolean().optional(),
    title: roomTitleSchema.optional(),
    hostLabel: hostLabelSchema.or(z.literal("")).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    error: "an empty settings patch changes nothing - send the fields you mean to change",
  });
export type RoomSettingsPatch = z.infer<typeof roomSettingsPatchSchema>;

// Body of PATCH /api/rooms/<CODE> (host-authenticated) - the same patch the host-only
// `update-room-settings` client message carries, so the two doors cannot drift into meaning
// different things.
export const updateRoomSettingsRequestSchema = z.strictObject({
  settings: roomSettingsPatchSchema,
});
export type UpdateRoomSettingsRequest = z.infer<typeof updateRoomSettingsRequestSchema>;

/**
 * Why a settings change was refused, in the vocabulary the surface shows.
 * - `title-required`: a room cannot become PUBLIC without a title - an unnamed row in a
 *   server browser is noise, not an invitation (the create path refuses the same thing).
 * - `below-current`: a cap cannot be set below the participants already in the room. Nobody is
 *   ever ejected by a settings edit; lower the number after they leave, or kick deliberately.
 */
export const settingsRejectionSchema = z.enum(["title-required", "below-current"]);
export type SettingsRejection = z.infer<typeof settingsRejectionSchema>;
