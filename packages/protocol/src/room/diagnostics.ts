// Room diagnostics: what a HOST may ask a live Durable Object about itself
// (owner request 2026-08-14, "provide more information about the DO objects").
//
// This is an operator instrument, not a play surface: the harness renders it, the host
// console may later, and nothing else should. Two rules shape the schema and are gated by
// apps/realtime/test/diagnostics.test.ts:
//
// 1. NO SECRETS, EVER. The host token, every player's session token, and all authored clue
//    text/answers are absent by construction - this
//    schema is `strictObject` all the way down, so a field cannot be added by accident at a
//    call site, only deliberately here.
// 2. COUNTS, NOT PEOPLE. The lobby lists rooms, never players (registry.ts); the inspector
//    keeps the same promise - roster size and connection counts, no nicknames, no ids.
//
// Everything here is a SNAPSHOT of DO memory at request time. It is diagnostic truth, not
// wire state: nothing subscribes, nothing patches, and a stale reading is harmless.
import { z } from "zod";
import { registryStatusSchema } from "./registry.ts";
import { roomSettingsSchema } from "./room-settings.ts";
import { roomCodeSchema, roomPhaseSchema } from "./server-messages.ts";

// How a host proves itself to the ops endpoints. A header, not a query parameter: room links
// are pasted, logged and screenshotted, and the host token is the room's strongest secret -
// it must never end up in an access log or a browser history entry.
export const hostTokenHeader = "x-host-token";

// Connections by the role they joined as. `unjoined` is a socket that upgraded but has sent
// neither join nor resume - the state a refused or still-typing client sits in, and the one
// worth seeing when a phone "connects" but nothing happens.
export const connectionCensusSchema = z.strictObject({
  total: z.int().nonnegative(),
  host: z.int().nonnegative(),
  player: z.int().nonnegative(),
  display: z.int().nonnegative(),
  spectator: z.int().nonnegative(),
  unjoined: z.int().nonnegative(),
});
export type ConnectionCensus = z.infer<typeof connectionCensusSchema>;

// One entry of the DO's multiplexed alarm book (apps/realtime/src/room/storage.ts). The ONE
// runtime alarm always sits at the earliest `dueAt`; seeing the whole book is how a timer
// that never fired stops being a mystery.
export const alarmEntrySchema = z.strictObject({
  // `empty-room` is the grace timer a room starts when its last participant disconnects -
  // separate from `idle-expiry`, which measures dormancy in an OCCUPIED room. Seeing both in
  // one book is how "why did my room disappear" answers itself.
  // `buzz-adjudication` is the sub-second M6 entry: the room holding one arming's buzzes
  // while latency compensation ranks them (apps/realtime/src/room/arm-window.ts). It is the
  // only entry measured in milliseconds, and seeing it is how "the buzz felt late" answers
  // itself.
  source: z.enum([
    "engine-timer",
    "team-succession",
    "idle-expiry",
    "empty-room",
    "buzz-adjudication",
  ]),
  // Timer kind, team id, or "room" - a label, never an identity.
  label: z.string().max(60),
  dueAt: z.int().positive(),
});

// The participant census, split by the two budgets the room enforces separately
// (docs/decisions/2026-08-14-room-controls-and-staging.md). Players are counted from the
// ROSTER (a seat survives a dropped phone; `connected` is how many are on a socket right now),
// spectators from live CONNECTIONS (they hold no seat by design). Displays are counted in
// `connections` above and belong to neither budget - the projector is the host's own screen.
export const participantCensusSchema = z.strictObject({
  players: z.strictObject({
    seated: z.int().nonnegative(),
    connected: z.int().nonnegative(),
    max: z.int().positive(),
  }),
  spectators: z.strictObject({
    connected: z.int().nonnegative(),
    max: z.int().nonnegative(),
    allowed: z.boolean(),
  }),
});
export type ParticipantCensus = z.infer<typeof participantCensusSchema>;

export const roomDiagnosticsSchema = z.strictObject({
  code: roomCodeSchema,
  lifecycle: roomPhaseSchema,
  // The live room controls, exactly as every connected client sees them (room-settings.ts).
  // No secret is reachable from here, and since 2026-08-20 there is no secret in the settings
  // to reach: passwords are gone and the room code is what admits people.
  settings: roomSettingsSchema,
  // Unix ms. `expiresAt` is derived (lastActivityAt + the idle-expiry limit), so the gap
  // between "now" and it is exactly how long the room has left if nobody touches it.
  createdAt: z.int().positive(),
  lastActivityAt: z.int().positive(),
  expiresAt: z.int().positive(),
  paused: z.boolean(),
  stateVersion: z.int().nonnegative(),
  connections: connectionCensusSchema,
  participants: participantCensusSchema,
  roster: z.strictObject({
    players: z.int().nonnegative(),
    connected: z.int().nonnegative(),
    teams: z.int().nonnegative(),
  }),
  alarm: z.strictObject({
    // What the runtime alarm is actually set to, i.e. the earliest entry below.
    nextWakeAt: z.union([z.int().positive(), z.null()]),
    entries: z.array(alarmEntrySchema).max(64),
  }),
  // Approximate size of each storage bundle key, measured as serialized JSON characters of
  // what the DO holds in memory. Cheap (no extra storage reads) and precise enough for its
  // only question: which key is growing.
  storage: z.strictObject({
    totalBytes: z.int().nonnegative(),
    keys: z.array(z.strictObject({ key: z.string().max(40), bytes: z.int().nonnegative() })),
  }),
});
export type RoomDiagnostics = z.infer<typeof roomDiagnosticsSchema>;

// What the registry believes about this same room, so the two halves can be compared side by
// side - the drift the decision doc calls "expected and visible, never fatal" becomes
// literally visible here (row missing while the room is live = the lobby is lying by omission).
export const registryRowStateSchema = z.strictObject({
  listed: z.boolean(),
  phase: roomPhaseSchema,
  playerCount: z.int().nonnegative(),
  expiresAt: z.int().positive(),
  endedAt: z.union([z.int().positive(), z.null()]),
});
export type RegistryRowState = z.infer<typeof registryRowStateSchema>;

// Body of GET /api/rooms/<CODE> (host-authenticated). `registryRow` is null when the room has
// no row at all - which, with `registry.status === "ok"`, is real drift worth investigating,
// and with `no-table` is simply the missing migration saying so again.
export const roomInspectionSchema = z.strictObject({
  room: roomDiagnosticsSchema,
  registry: registryStatusSchema,
  registryRow: z.union([registryRowStateSchema, z.null()]),
});
export type RoomInspection = z.infer<typeof roomInspectionSchema>;

// Body of PATCH /api/rooms/<CODE> (host-authenticated): the settings AFTER the edit, plus what
// the lobby row write made of it - a room that just went public and could not be listed must
// say so in the same breath, exactly as creation does. Every field of the settings it echoes
// is public by construction (room-settings.ts); since 2026-08-20 none of them is a secret.
export const updateRoomSettingsResponseSchema = z.strictObject({
  code: roomCodeSchema,
  settings: roomSettingsSchema,
  registry: registryStatusSchema,
});
export type UpdateRoomSettingsResponse = z.infer<typeof updateRoomSettingsResponseSchema>;

// Body of DELETE /api/rooms/<CODE> (host-authenticated): the room is closed, everyone got the
// polite screen, and the lobby row is gone. `registry` reports the row deletion the same way
// creation reports the row insert - loudly.
export const closeRoomResponseSchema = z.strictObject({
  code: roomCodeSchema,
  closed: z.literal(true),
  registry: registryStatusSchema,
});
export type CloseRoomResponse = z.infer<typeof closeRoomResponseSchema>;
