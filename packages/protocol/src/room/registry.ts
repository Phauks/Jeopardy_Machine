// The room registry projection: what the public lobby lists
// (docs/decisions/2026-08-14-room-visibility-and-lobby.md, "The registry").
//
// Durable Objects have NO enumeration API - `idFromName` hashes a code straight to an
// instance, so nothing anywhere knows which rooms exist. Listing is therefore only possible
// against a registry we write ourselves (a D1 table, owned by apps/web; the migration under
// apps/web/migrations is its canonical schema). This module is the shared CONTRACT for that
// table's public projection - the shape the lobby endpoint returns and the lobby UI renders.
// It deliberately contains no SQL: the row layout is infrastructure, the summary is a wire
// contract, and only the latter belongs to every consumer.
//
// Two properties this shape is built to preserve:
// - Registry rows are a CACHE, never authority. The DO is the source of truth and refuses
//   dead rooms on connect regardless of what a stale row claims.
// - Nothing here identifies a player. The lobby lists rooms, never people.
//
// It carried `hasPassword` until 2026-08-20 - the one password fact that was ever public,
// enough for a lock icon and useless as an oracle. Passwords are gone entirely
// (@jeopardy/protocol room/visibility.ts), so a listed room has nothing left to be locked by.
import { z } from "zod";
import { limits } from "../limits.ts";
import { roomCodeSchema, roomPhaseSchema } from "./server-messages.ts";
import { hostLabelSchema, roomListingSchema, roomTitleSchema } from "./visibility.ts";

export const roomSummarySchema = z.strictObject({
  code: roomCodeSchema,
  title: roomTitleSchema,
  // Empty string = the host did not name themselves; the lobby simply omits the byline.
  hostLabel: hostLabelSchema.or(z.literal("")),
  listing: roomListingSchema,
  // Only lobby/active rooms are ever listed; `ended` appears in the type because the row
  // outlives the transition by one write (the sweep and the phase filter drop it).
  phase: roomPhaseSchema,
  playerCount: z.int().nonnegative(),
  // The room's OWN `settings.maxPlayers`, not the product limit: "7/24" in the lobby has to
  // mean the door this host actually set, or the fraction lies to everyone reading it. It
  // moves when the host retunes the cap (room-settings.ts).
  playerCap: z.int().positive(),
  // The SECOND budget (room-settings.ts: a stream audience must never crowd out the people who
  // came to play), projected for the lobby row so a browser can see whether there is room to
  // WATCH as well as room to play. `spectatorsAllowed: false` is a different fact from a full
  // audience and reads as a different line.
  //
  // All three are OPTIONAL, and that is load-bearing rather than lazy: absent means "this
  // server does not report spectators", which the lobby must render as nothing at all, while
  // `spectatorCount: 0` means "nobody is watching" and renders as 0. A required field could
  // not tell those apart, and a client that guessed zero would invent an empty audience for
  // every room a pre-spectator-columns registry answers with
  // (apps/web/src/lib/lobby/room-capacity.ts holds that distinction).
  spectatorCount: z.int().nonnegative().optional(),
  spectatorCap: z.int().nonnegative().optional(),
  spectatorsAllowed: z.boolean().optional(),
  // Unix ms. `createdAt` drives newest-first ordering and the "age" column; `lastSeenAt` is
  // how fresh the projection is - a row whose DO went quiet ages visibly instead of lying.
  createdAt: z.int().positive(),
  lastSeenAt: z.int().positive(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

// Why the registry might not be answering. Added 2026-08-14 after the owner reported "I
// created a public room and it never appeared in the lobby": every registry failure used to
// be swallowed into an empty list, so an unapplied migration and a genuinely quiet lobby were
// the same pixel on screen. They are different facts and the wire now says which:
//
// - `no-binding`: no D1 binding at all (vite dev). Rooms cannot even be created here.
// - `no-table`:   binding present, `rooms` table missing - the migration has not been applied
//                 to this environment (docs/cloudflare-setup.md 2a). THE common production
//                 cause, and the one a host can fix.
// - `error`:      anything else D1 said. Detail carries the message, trimmed, for the log.
export const registryUnavailableReasonSchema = z.enum(["no-binding", "no-table", "error"]);
export type RegistryUnavailableReason = z.infer<typeof registryUnavailableReasonSchema>;

// Discriminated on purpose: `ok` with zero rooms (a quiet lobby) must never be confusable
// with `unavailable` (the lobby is broken), which is exactly the confusion this replaces.
export const registryStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok") }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: registryUnavailableReasonSchema,
    // Operator-facing, never player-facing: a trimmed D1 message. Capped because an error
    // string is untrusted length, and this rides a cacheable public response.
    detail: z.string().max(300).optional(),
  }),
]);
export type RegistryStatus = z.infer<typeof registryStatusSchema>;

// Body of GET /api/rooms. `fetchedAt` is the server's stamp, not the browser's: the response
// is edge-cacheable (limits.lobby.listingCacheSeconds), so the page can show how old the list
// it is looking at actually is rather than assuming it just arrived.
export const lobbyListingSchema = z.strictObject({
  rooms: z.array(roomSummarySchema).max(limits.lobby.listingMax),
  fetchedAt: z.int().positive(),
  // Always present, never optional: a caller that forgets to look at it still cannot ship a
  // UI that silently renders a broken registry as "no rooms right now".
  registry: registryStatusSchema,
});
export type LobbyListing = z.infer<typeof lobbyListingSchema>;
