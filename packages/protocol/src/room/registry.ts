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
// Three properties this shape is built to preserve:
// - Registry rows are a CACHE, never authority. The DO is the source of truth and refuses
//   dead rooms on connect regardless of what a stale row claims.
// - `hasPassword` is the ONLY password fact that is ever public - enough for a lock icon,
//   useless as an oracle (verification happens in the DO, rate-limited, per join).
// - Nothing here identifies a player. The lobby lists rooms, never people.
import { z } from "zod";
import { limits } from "../limits.ts";
import { roomCodeSchema, roomPhaseSchema } from "./server-messages.ts";
import { hostLabelSchema, roomTitleSchema, roomVisibilitySchema } from "./visibility.ts";

export const roomSummarySchema = z.strictObject({
  code: roomCodeSchema,
  title: roomTitleSchema,
  // Empty string = the host did not name themselves; the lobby simply omits the byline.
  hostLabel: hostLabelSchema.or(z.literal("")),
  visibility: roomVisibilitySchema,
  hasPassword: z.boolean(),
  // Only lobby/active rooms are ever listed; `ended` appears in the type because the row
  // outlives the transition by one write (the sweep and the phase filter drop it).
  phase: roomPhaseSchema,
  playerCount: z.int().nonnegative(),
  playerCap: z.int().positive(),
  // Unix ms. `createdAt` drives newest-first ordering and the "age" column; `lastSeenAt` is
  // how fresh the projection is - a row whose DO went quiet ages visibly instead of lying.
  createdAt: z.int().positive(),
  lastSeenAt: z.int().positive(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

// Body of GET /api/rooms. `fetchedAt` is the server's stamp, not the browser's: the response
// is edge-cacheable (limits.lobby.listingCacheSeconds), so the page can show how old the list
// it is looking at actually is rather than assuming it just arrived.
export const lobbyListingSchema = z.strictObject({
  rooms: z.array(roomSummarySchema).max(limits.lobby.listingMax),
  fetchedAt: z.int().positive(),
});
export type LobbyListing = z.infer<typeof lobbyListingSchema>;
