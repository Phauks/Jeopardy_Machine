# Room passwords are gone; the code is the password

Date: 2026-08-20
Status: adopted

## The direction

Owner, verbatim: "let's just not have a password, no one is using it. the code is the password. simplifies things."

## What was there

Since 2026-08-14 a room had two independent axes (docs/decisions/2026-08-14-room-visibility-and-lobby.md, renamed in docs/decisions/2026-08-14-room-controls-and-staging.md): `listing` (public / private) and `entry` (open / password). The password was a shared room secret - shouted across a hall, printed on a table tent, never an account - verified inside the DO with PBKDF2-SHA256 (100k iterations, per-room salt, constant-time compare), rate-limited per connection, with the host exempt because the creation token is the stronger claim. `has_password` was the one password fact that was ever public: enough for a lock icon in the lobby, useless as an oracle.

It worked. Nobody used it.

## What it cost to keep

The password was the only secret a PLAYER surface ever held, and it was load-bearing for a surprising amount of machinery: a second storage key in `join-hand-off.ts` with its own lifetime rules; a password argument threaded through `createRoomStore` into `WsRoomStore` and out again in every `join` frame; two refusal reasons whose defining property was that they did NOT close the socket, which is a third refusal tier the protocol carried for them alone; a full-page password door on the pre-game screen, added 2026-08-19 to close the gap where a phone arriving by QR had nowhere to type one; a per-card prompt in the lobby; a field in the create form; a field in both settings panels; a column in D1; and a redaction gate over all of it.

## What is gone

`entry`, `roomEntrySchema`, `roomPasswordSchema`, the `password` field on creation / join / settings-patch, `password-required`, `bad-password`, `limits.room.passwordAttempt*`, `has_password` in D1 and `hasPassword` on the wire, `apps/realtime/src/room/password.ts`, `apps/realtime/test/passwords.test.ts`, `submitRoomPassword`, `passwordPrompt`, `rememberRoomPassword` / `recallRoomPassword`, the pre-game door, the lobby's lock badge and in-card prompt, and the lobby's "open rooms only" filter.

## What it costs, stated plainly

**A PUBLIC room can no longer be locked.** "Listed but gated" was a real combination - a room anyone could find and only invited people could enter - and it is not coming back. A room that should not admit strangers is PRIVATE, and its code is what admits people.

That is a genuine narrowing, and it is the right one at this product's scale. The code is five characters from a 32-symbol alphabet with the confusable glyphs removed, it is never in a public listing for a private room, and a room that goes idle expires. The threat the password answered - somebody who can see a public listing and wants in uninvited - is answered instead by not listing the room.

## What this changes about how joining reads

One credential, one place. The room code travels in the URL by design (that is what a QR code is), and there is no second secret that must NOT travel in the URL - which was the rule the whole hand-off module was shaped around. A phone that reaches a room is in it. The refusal tiers drop from three to two: room-level refusals close the socket, team-level ones keep it.
