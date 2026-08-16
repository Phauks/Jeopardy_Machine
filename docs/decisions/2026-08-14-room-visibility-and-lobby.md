# 2026-08-14 - Room visibility, passwords, and the public lobby

## Context

Owner: "when you go to the website, a room can be public or private. If a room is public, it will show up in the public list, if it is private, you need the password and/or room code. Making a lobby... Look at how multiplayer games work."

Also answers the prior question "can the harness list all available rooms?" - it cannot today, and the reason is architectural: **Durable Objects have no enumeration API.** `idFromName` hashes a code straight to an instance; nothing anywhere knows which rooms exist. Listing requires a registry we write to ourselves. D1 (already bound, unused) is exactly that.

## Decision

Adopt the multiplayer server-browser model, with two INDEPENDENT axes - the mistake to avoid is conflating "listed" with "open":

| Axis        | Values               | Meaning                                      |
| ----------- | -------------------- | -------------------------------------------- |
| **Listing** | `public` / `private` | Does the room appear in the browsable lobby? |
| **Entry**   | `open` / `password`  | Is a shared room password required to join?  |

> **Renamed 2026-08-14** (docs/decisions/2026-08-14-room-controls-and-staging.md, owner call): the listing values were `public` / `unlisted` until this document's own vocabulary was judged wrong. `unlisted` was accurate jargon; a host choosing between **public** and **private** needs no explanation. Renamed with NO alias - the schema, the D1 column and its CHECK constraint, the UI strings and the tests all moved together, which is why `apps/web/migrations/0001_create_rooms.sql` was rewritten in place and must be re-applied (docs/cloudflare-setup.md 2a). Everything else below is unchanged: the two axes stay independent, and all four combinations still exist.

All four combinations are legal and each maps to a real use case:

| Combination        | Game analogue                  | Our use case                                                                                         |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| public + open      | open server browser            | pub quiz night, drop-in trivia, demo rooms                                                           |
| public + password  | listed server with a lock icon | club night: everyone sees it, the password keeps randoms out (owner's "public but needs a password") |
| private + open     | share-a-code lobby             | the current behavior: QR/code is the entire flow (guiding principle 3)                               |
| private + password | private match                  | rehearsals, staff-only games                                                                         |

**Default stays `private` + `open`** - the QR-code flow is untouched and nothing a host does accidentally publishes their game.

### Room passwords are not accounts

Boundary check against guiding principle 3 (players never log in): a room password is a **shared room-level secret**, exactly like a game-server password - no identity, no registration, no persistence, nothing to remember after the night. It never becomes a player account, and hosts still cannot require player identity. Boundary 2.2 stands.

### The registry (what makes listing possible)

A D1 table written by the room-creation route and updated over the room's life:

`rooms(code PK, title, host_label, listing, has_password, phase, player_count, player_cap, created_at, last_seen_at, expires_at, ended_at)`

- **Written on create**, refreshed by the DO on meaningful transitions (lobby -> active, roster count changes, close/expiry). Registry rows are a _projection_: the DO stays the source of truth, the row is a cache for browsing. A stale row can never let someone into a dead room - the DO refuses on connect regardless.
- **Password verification lives in the DO, never in the registry**: the row stores only `has_password` (for the lock icon); the DO stores a salted hash and checks it during join. Wrong password = a join refusal, with rate limiting per connection, so the lobby list can never be used as an oracle.
- Rows are deleted/marked ended by the expiry alarm; the lobby query filters to live, non-ended rooms.

### The lobby browser (public surface)

Route `/` gains a **Join** entry (the real landing eventually): room-code box + password field, and a **public rooms list** (title, host label, players/capacity, lock icon, phase badge "in lobby"/"playing", age). Refreshes on an interval, not a socket - it is a browse surface, not a live room.

Server-browser conventions we adopt: lock icons for password rooms, capacity fractions, "in progress" dimming (joinable only if late-join is enabled), newest-first ordering, and a code box that always wins (typing a code bypasses the list entirely).

### Abuse posture (a public list on a free service invites it)

- Listing is **opt-in per room**, off by default.
- Only rooms in `lobby`/`active` phases list; expiry delists automatically.
- Host-supplied titles are length-capped and profanity-filtered with the existing filter; a room can be delisted by its host at any time from the console.
- Global cap on listed rooms per query, newest-first, with pagination deferred.
- No free-text chat anywhere in the product, so the lobby cannot become a message board.

## Addendum 2026-08-14 (implementation): how registry updates reach D1

The decision above says the registry is "refreshed by the DO on meaningful transitions" without saying how a Durable Object - which cannot import the web app - performs a D1 write. Three mechanisms were available; **the realtime Worker binds the same D1 database and the DO writes its own rows** (`apps/realtime/src/room/registry-writer.ts`, four statements: touch, relist, end, delete - `relist` was added with the editable room settings, since a room that just went private must leave the lobby immediately rather than at the next sweep).

| Option                                                              | Why not / why                                                                                                                                                                                                                                                                                                                                 |     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| DO -> web Worker over a **service binding** to an internal endpoint | Rejected. Web already binds this Worker's DO namespace, so this adds a **circular binding** (awkward first deploy), a network hop on every transition, and an internal write endpoint that needs a shared secret - a new trust boundary and a new secret to rotate, bought for nothing.                                                       |
| **Web owns all writes**, riding the routes it already touches       | Rejected: it cannot see the events. Phase changes, roster counts and expiry all happen INSIDE the DO with no HTTP request to piggyback on; the registry would be accurate only about rooms nobody has joined yet.                                                                                                                             |
| **Shared D1 binding** (chosen)                                      | D1 bindings are shareable; a DO writing D1 is ordinary. No new secret, no new hop, no binding cycle - the realtime Worker simply gains `DB` pointing at the same `database_id`. Schema ownership stays singular: the migration lives in `apps/web/migrations`, the web repository is the full one, and this Worker only ever UPDATEs/DELETEs. |

**Write policy.** Roster-count churn is coalesced (5s floor - a 100-phone join stampede must not cost 100 D1 writes for one visible number); phase changes (`lobby -> active -> ended`) are never throttled, because the phase badge is what a browser reads. The expiry alarm deletes the row as it frees the code. Every write is wrapped and swallowed: a registry failure may cost a lobby row, never a room or a join.

**Failure mode: registry drift.** A row can outlive its room (D1 error, eviction between transition and write, unapplied migration) or lag it (coalescing). Three things make that survivable rather than dangerous:

1. **Rows are a cache, never authority.** The DO refuses `no-such-room` on connect regardless of what any row claims - held by a test that lists a live row for a room that was never created.
2. **The listing query asserts liveness instead of trusting it** (`ended_at IS NULL`, phase in lobby/active, `expires_at > now`), so a row nobody cleaned up delists itself on schedule.
3. **A reconcile sweep** deletes rows past their deadline; it runs on the create path (rare) rather than the lobby path (constant), and needs no coordination with any DO because a row past its expiry can never be valid.

**Drift between the two Workers' SQL** is gated, not trusted: the realtime workerd suite applies `apps/web/migrations/*.sql` to a real local D1 and runs the DO's statements against it, and a web-side gate parses the same migration and asserts no repository statement names a column it does not define.

**Password crypto.** PBKDF2-HMAC-SHA256, 100k iterations, 16-byte random salt, 32-byte derived key, verified in constant time (`apps/realtime/src/room/password.ts`). workerd's SubtleCrypto has PBKDF2 natively and has neither scrypt nor argon2, which settles the choice; a plain salted SHA-256 would be free to attack offline, while 100k iterations costs one join a few tens of milliseconds of DO CPU. The hash lives only in DO storage - the registry stores `has_password` and nothing else.

**Password on the wire** rides the `join` MESSAGE, never a URL or query string: room links are pasted into group chats and printed onto QR codes, and a secret in a URL lands in history, referrers and access logs. Password refusals keep the socket (retry in place); the connection that burns `limits.room.passwordAttemptBurstMax` attempts is closed with the existing join-refusal code.

## Consequences

- **D1 gets its first real use** (it was bound but idle) - the registry table plus a migration file; `wrangler d1 migrations` becomes part of the deploy runbook.
- The creation payload gains `listing`, `password?`, `title`, `hostLabel`; the room protocol's join gains an optional `password`, and `refused` gains `bad-password`/`password-required` reasons.
- The realtime harness gets its room list for free (it queries the same endpoint) - answering the earlier question.
- Host console gains listing controls (list/delist, set/clear password) - shipped for the room layer 2026-08-14 as the host-only `update-room-settings` message and `PATCH /api/rooms/<CODE>` (docs/decisions/2026-08-14-room-controls-and-staging.md); the console UI itself is M4 surface work.
- Future: the same registry backs "my rooms" for hosts once accounts exist (M8), and multi-room events (expansion 1.2).

## Addendum 2026-08-14 (b): the registry reports its own health - graceful is not the same as silent

**What happened.** The owner created a public room on the deployed site; it never appeared in the lobby, and every surface showed the same thing an ordinary quiet night shows. Reproduced locally in the single-origin loop with and without the migration applied: **rooms create and join normally either way** (201, real code, working WebSocket) and `GET /api/rooms` answers `{"rooms":[]}` in both cases. The only difference was a `console.warn` in the Worker log - `D1_ERROR: no such table: rooms` - which nobody was reading. The registry's D1 migration (§2a of the runbook) had never been applied to that environment.

**The design flaw, stated exactly.** "Best effort" was implemented as "silent". Degrading gracefully was right - a D1 fault may never cost anyone a game - but swallowing the reason made an operational misconfiguration indistinguishable from an empty lobby, on every surface, indefinitely.

**The fix: a status on the wire, everywhere a room list travels.** `packages/protocol/src/room/registry.ts` gains a discriminated `registryStatus`: `{status:"ok"}` or `{status:"unavailable", reason:"no-binding"|"no-table"|"error", detail?}`. It is a REQUIRED field of `lobbyListing`, so an empty list can never again be shipped without a verdict, and of `createRoomResponse`, so the creating surface can say "room created; NOT listed because the registry table is missing". `/api/version` reports the same probe (plus whether the DO binding exists) so an owner can diagnose a deployment with one curl instead of a room. `no-table` is detected from SQLite's own "no such table" message, including inside D1's wrapper `cause`.

Behavior kept: rooms still work with no registry at all, writes are still best-effort, and the listing still degrades to empty. Behavior added: a broken registry is never cached (an applied migration must show up immediately, not after the cache window), and every surface renders the reason with the fix command verbatim.

**Companion surfaces (same owner report).** `DELETE /api/rooms/<CODE>` closes a room end to end (host token required, verified inside the DO; the polite screen goes out, the lobby row is deleted) and `GET /api/rooms/<CODE>` is a host-authenticated DO inspector - lifecycle, timestamps, connection census by role, roster/team counts, state version, the alarm book, per-key storage sizes, and the registry's own row beside it so drift is visible rather than inferred. The inspector carries no host token, no session token, no password material and no authored clue text, held by a redaction test that searches the serialized response for all four.
