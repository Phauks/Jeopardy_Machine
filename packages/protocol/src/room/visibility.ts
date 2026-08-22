// Room listing - now the ONE axis of room visibility.
//
// | Axis    | Values               | Meaning                                          |
// | ------- | -------------------- | ------------------------------------------------ |
// | listing | public / private     | does the room appear in the browsable lobby?     |
//
// THERE WAS A SECOND AXIS UNTIL 2026-08-20: `entry` (open / password), a shared room secret
// checked on join. It is gone, on the owner's call - "let's just not have a password, no one
// is using it, the code is the password". That is the honest reading of what a room code
// already is: five characters from a 32-character alphabet, never listed unless a host opts
// in, and expiring in hours. A second secret on top of it bought a capability nobody reached
// for and cost a field on the create form, a prompt on the join path, a hash in the DO, two
// refusal reasons, a rate limiter, a column in the registry, and a whole screen.
//
// What it also cost, and this is the part worth being explicit about: a PUBLIC room can no
// longer be locked. "Listed but gated" was a real combination and it is not coming back with
// this change - anyone browsing the lobby can walk into any public room. A room that should
// not admit strangers is PRIVATE, and its code is what admits people. That is the trade the
// owner made deliberately, and it is the right one for a party game: the club night is a
// private room whose code goes on the projector.
//
// The listing values were `public`/`unlisted` until 2026-08-14 (docs/decisions/2026-08-14-
// room-controls-and-staging.md, owner call): "unlisted" was accurate jargon and bad
// vocabulary, and a host choosing between public and private needs no explanation. Renamed
// with NO alias - the D1 CHECK constraint moved with it, which is why the migration must be
// re-applied (docs/cloudflare-setup.md 2a).
//
// Its own module rather than create.ts because the JOIN path needs the listing and title
// schemas: a phone importing @jeopardy/protocol/room/client-messages must not drag the entire
// game-definition schema graph (create.ts) into its bundle.
import { z } from "zod";
import { limits } from "../limits.ts";

export const roomListingSchema = z.enum(["public", "private"]);
export type RoomListing = z.infer<typeof roomListingSchema>;

// Host-supplied listing text. Strangers read these in the lobby, so they are capped here and
// re-validated server-side; the nickname profanity filter (settings group `join`) covers
// player names today and is the filter these strings adopt when it ships with the M4 join UI.
export const roomTitleSchema = z.string().min(1).max(limits.room.roomTitleMaxLength);
export const hostLabelSchema = z.string().min(1).max(limits.room.hostLabelMaxLength);
