// Room listing and entry primitives - the two INDEPENDENT axes of
// docs/decisions/2026-08-14-room-visibility-and-lobby.md:
//
// | Axis    | Values               | Meaning                                          |
// | ------- | -------------------- | ------------------------------------------------ |
// | listing | public / private     | does the room appear in the browsable lobby?     |
// | entry   | open / password      | is a shared room password required to join?      |
//
// All four combinations are legal and each has a real use case (public+password is the club
// night: everyone sees it, the password keeps randoms out). Conflating "listed" with "open"
// is the mistake the decision doc exists to prevent.
//
// The listing values were `public`/`unlisted` until 2026-08-14 (docs/decisions/2026-08-14-
// room-controls-and-staging.md, owner call): "unlisted" was accurate jargon and bad
// vocabulary, and a host choosing between public and private needs no explanation. Renamed
// with NO alias - the D1 CHECK constraint moved with it, which is why the migration must be
// re-applied (docs/cloudflare-setup.md 2a).
//
// Their own module rather than create.ts because the JOIN path needs the password schema: a
// phone importing @jeopardy/protocol/room/client-messages must not drag the entire game-
// definition schema graph (create.ts) into its bundle.
import { z } from "zod";
import { limits } from "../limits.ts";

export const roomListingSchema = z.enum(["public", "private"]);
export type RoomListing = z.infer<typeof roomListingSchema>;

// The entry axis, derived rather than stored: a room has a password or it does not, and a
// second stored field could only ever disagree with the first. It travels on the wire so a
// surface can render "locked" without being told the secret exists in some other field.
export const roomEntrySchema = z.enum(["open", "password"]);
export type RoomEntry = z.infer<typeof roomEntrySchema>;

// Host-supplied listing text. Strangers read these in the lobby, so they are capped here and
// re-validated server-side; the nickname profanity filter (settings group `join`) covers
// player names today and is the filter these strings adopt when it ships with the M4 join UI.
export const roomTitleSchema = z.string().min(1).max(limits.room.roomTitleMaxLength);
export const hostLabelSchema = z.string().min(1).max(limits.room.hostLabelMaxLength);

// The shared room secret. Never stored in the registry (only `has_password` is) and never
// compared in the web Worker: the DO holds a salted hash and verifies it during join, so the
// public lobby can never be used as a password oracle.
export const roomPasswordSchema = z
  .string()
  .min(limits.room.roomPasswordMinLength)
  .max(limits.room.roomPasswordMaxLength);
