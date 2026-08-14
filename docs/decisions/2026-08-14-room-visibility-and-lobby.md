# 2026-08-14 - Room visibility, passwords, and the public lobby

## Context

Owner: "when you go to the website, a room can be public or private. If a room is public, it will show up in the public list, if it is private, you need the password and/or room code. Making a lobby... Look at how multiplayer games work."

Also answers the prior question "can the harness list all available rooms?" - it cannot today, and the reason is architectural: **Durable Objects have no enumeration API.** `idFromName` hashes a code straight to an instance; nothing anywhere knows which rooms exist. Listing requires a registry we write to ourselves. D1 (already bound, unused) is exactly that.

## Decision

Adopt the multiplayer server-browser model, with two INDEPENDENT axes - the mistake to avoid is conflating "listed" with "open":

| Axis        | Values                | Meaning                                      |
| ----------- | --------------------- | -------------------------------------------- |
| **Listing** | `public` / `unlisted` | Does the room appear in the browsable lobby? |
| **Entry**   | `open` / `password`   | Is a shared room password required to join?  |

All four combinations are legal and each maps to a real use case:

| Combination         | Game analogue                  | Our use case                                                                                         |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| public + open       | open server browser            | pub quiz night, drop-in trivia, demo rooms                                                           |
| public + password   | listed server with a lock icon | club night: everyone sees it, the password keeps randoms out (owner's "public but needs a password") |
| unlisted + open     | share-a-code lobby             | the current behavior: QR/code is the entire flow (guiding principle 3)                               |
| unlisted + password | private match                  | rehearsals, staff-only games                                                                         |

**Default stays `unlisted` + `open`** - the QR-code flow is untouched and nothing a host does accidentally publishes their game.

### Room passwords are not accounts

Boundary check against guiding principle 3 (players never log in): a room password is a **shared room-level secret**, exactly like a game-server password - no identity, no registration, no persistence, nothing to remember after the night. It never becomes a player account, and hosts still cannot require player identity. Boundary 2.2 stands.

### The registry (what makes listing possible)

A D1 table written by the room-creation route and updated over the room's life:

`rooms(code PK, title, host_label, visibility, has_password, phase, player_count, player_cap, created_at, last_seen_at, expires_at, ended_at)`

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

## Consequences

- **D1 gets its first real use** (it was bound but idle) - the registry table plus a migration file; `wrangler d1 migrations` becomes part of the deploy runbook.
- The creation payload gains `visibility`, `password?`, `title`, `hostLabel`; the room protocol's join gains an optional `password`, and `refused` gains `bad-password`/`password-required` reasons.
- The realtime harness gets its room list for free (it queries the same endpoint) - answering the earlier question.
- Host console gains visibility controls (list/delist, set/clear password) - M4 surface work.
- Future: the same registry backs "my rooms" for hosts once accounts exist (M8), and multi-room events (expansion 1.2).
