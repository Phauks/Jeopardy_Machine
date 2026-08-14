// Room visibility and entry primitives - the two INDEPENDENT axes of
// docs/decisions/2026-08-14-room-visibility-and-lobby.md:
//
// | Axis    | Values               | Meaning                                          |
// | ------- | -------------------- | ------------------------------------------------ |
// | listing | public / unlisted    | does the room appear in the browsable lobby?     |
// | entry   | open / password      | is a shared room password required to join?      |
//
// All four combinations are legal and each has a real use case (public+password is the club
// night: everyone sees it, the password keeps randoms out). Conflating "listed" with "open"
// is the mistake the decision doc exists to prevent.
//
// Their own module rather than create.ts because the JOIN path needs the password schema: a
// phone importing @jeopardy/protocol/room/client-messages must not drag the entire game-
// definition schema graph (create.ts) into its bundle.
import { z } from "zod";
import { limits } from "../limits.ts";

export const roomVisibilitySchema = z.enum(["public", "unlisted"]);
export type RoomVisibility = z.infer<typeof roomVisibilitySchema>;

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
