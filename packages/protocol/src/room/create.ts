// Room creation contracts (docs/decisions/2026-08-13-single-origin-binding.md, "Room
// lifecycle: creation is explicit"): the web Worker's create route allocates a code, calls
// the DO's initialize RPC through the cross-script binding, and returns code + host token.
// Connecting NEVER creates - an uninitialized DO refuses upgrades with no-such-room.
//
// Two game shapes are accepted on purpose:
// - "definition": a full game-definition body - the product path ("Host this game" sends the
//   authored game; content items stay behind, the DO stores board material + the body).
// - "compact":    board material only, mirroring the engine's scenario-fixture shape - the
//   dev/test/bot path (spin a room without authoring content). The M4 sim panel uses it too.
import { z } from "zod";
import { limits } from "../limits.ts";
import { settingsOverridesSchema } from "../settings/derive.ts";
import { settingsPresetIdSchema } from "../settings/presets.ts";
import { gameDefinitionBodySchema } from "../modes/jeopardy/game-definition.ts";
import { hostTokenSchema } from "./identity.ts";
import { registryStatusSchema } from "./registry.ts";
import {
  defaultRoomSettings,
  maxPlayersSchema,
  maxSpectatorsSchema,
  roomSettingsSchema,
} from "./room-settings.ts";
import { roomCodeSchema } from "./server-messages.ts";
import { hostLabelSchema, roomListingSchema, roomTitleSchema } from "./visibility.ts";

// Mirrors the board shape of @jeopardy/engine's scenario fixtures (packages/engine/src/
// fixture.ts) - restated here because the engine depends on protocol, not the reverse; the
// realtime suite gates the two against drift.
export const compactRoundSchema = z.strictObject({
  columns: z.int().min(3).max(6),
  rows: z.int().min(3).max(6),
  rowValues: z.array(z.int().positive()).optional(),
  valueMultiplier: z.number().positive().optional(),
  wagerPlacement: z.enum(["auto", "manual"]).optional(),
  authoredWagers: z.array(z.tuple([z.int().nonnegative(), z.int().nonnegative()])).optional(),
});
export type CompactRound = z.infer<typeof compactRoundSchema>;

export const roomGameSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("definition"), body: gameDefinitionBodySchema }),
  z.strictObject({
    kind: z.literal("compact"),
    rounds: z.array(compactRoundSchema).min(1).max(4),
    preset: settingsPresetIdSchema.default("casual-party"),
    overrides: settingsOverridesSchema.prefault({}),
    hasFinalClue: z.boolean().default(false),
  }),
]);
export type RoomGameSpec = z.infer<typeof roomGameSpecSchema>;

// Body of both the web create route (POST /api/rooms) and the DO initialize RPC the route
// forwards to. Seed optional: omitted = the server draws one (normal play); pinned = a
// reproducible game for bug reports and simulations (owner directive on seeded randomness).
export const createRoomRequestSchema = z
  .strictObject({
    game: roomGameSpecSchema,
    seed: z.string().min(1).max(120).optional(),
    listing: roomListingSchema.default(defaultRoomSettings.listing),
    // Listing metadata. Optional for private rooms (nobody ever reads them) and REQUIRED for
    // public ones - an unnamed row in a server browser is noise, not an invitation.
    title: roomTitleSchema.optional(),
    hostLabel: hostLabelSchema.optional(),
    // Room controls (docs/decisions/2026-08-14-room-controls-and-staging.md). Every one of
    // them is editable AFTER creation through `update-room-settings`, so these are opening
    // positions rather than commitments - the create form is allowed to be short.
    maxPlayers: maxPlayersSchema.default(defaultRoomSettings.maxPlayers),
    maxSpectators: maxSpectatorsSchema.default(defaultRoomSettings.maxSpectators),
    spectatorsAllowed: z.boolean().default(defaultRoomSettings.spectatorsAllowed),
    hideJoinCode: z.boolean().default(defaultRoomSettings.hideJoinCode),
  })
  .refine((body) => body.listing !== "public" || body.title !== undefined, {
    error: "a public room needs a title - it is the row people read in the lobby",
    path: ["title"],
  });
// Parsed shape (defaults applied - `listing` is always present after a parse).
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
// Wire shape: what a caller must actually SEND. Distinct from the parsed type since
// `listing` has a default - callers that build request bodies (the harness, the bots CLI,
// the workerd suite) type against this one, or they would be forced to restate the default.
export type CreateRoomRequestInput = z.input<typeof createRoomRequestSchema>;

export const createRoomResponseSchema = z.strictObject({
  code: roomCodeSchema,
  hostToken: hostTokenSchema,
  // Unix ms when the room's idle-expiry alarm would fire if nothing ever connects.
  expiresAt: z.number().int().positive(),
  // Echoed back so the creating surface can show the truth the server recorded (lock badge,
  // "listed in the lobby" confirmation, the caps that were actually applied) without
  // re-deriving any of it from its own request body.
  settings: roomSettingsSchema,
  // Did the lobby row get written? The room exists either way (the registry is a cache and a
  // D1 failure may never cost anyone a game), but "created, and NOT listed because the
  // migration is missing" is a sentence the creating surface must be able to say out loud -
  // owner report 2026-08-14, docs/decisions/2026-08-14-room-visibility-and-lobby.md.
  registry: registryStatusSchema,
});
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;

// The DO's initialize refusal (code already names a live room): the web route retries with
// a fresh code. Anything else is a 500 with no schema - bugs should look like bugs.
export const initializeConflictResponseSchema = z.strictObject({
  error: z.literal("already-active"),
});

// Unambiguous room-code alphabet: uppercase alphanumerics minus I/O/0/1 (shoutable across a
// noisy hall, un-mistakable on a projector). Length from limits; ~24M five-char codes.
const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Server-allocated codes only (owner decision: never user-chosen). Uses rejection-free
// modulo over a 32-char alphabet: 32 divides 256, so no bias.
export function generateRoomCode(): string {
  const bytes = new Uint8Array(limits.room.roomCodeLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => roomCodeAlphabet[byte % roomCodeAlphabet.length]).join("");
}

// 128-bit hex secrets for host and session tokens (identity.ts documents the split).
export function generateSecretToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
