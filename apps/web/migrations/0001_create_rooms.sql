-- The room registry: the table that makes a public lobby possible at all.
--
-- Durable Objects have NO enumeration API (docs/decisions/2026-08-14-room-visibility-and-lobby.md):
-- idFromName hashes a code straight to an instance, so nothing anywhere knows which rooms
-- exist. This table is the projection we write ourselves. It is a CACHE, never authority -
-- the DO remains the source of truth and refuses dead rooms on connect no matter what a row
-- here claims. Both Workers write it (web on create, the room DO on transitions); the
-- addendum in the decision doc explains why the DO holds its own D1 binding.
--
-- Deliberately absent: the room password (only has_password lives here, for the lock icon;
-- the salted hash never leaves the DO) and anything identifying a player.
--
-- REWRITTEN IN PLACE 2026-08-14 (docs/decisions/2026-08-14-room-controls-and-staging.md): the
-- listing axis became public/private, so the column is `listing` and its CHECK moved with it.
-- The product has no users and rooms live hours, so the honest edit is a DROP + CREATE rather
-- than an ALTER trail and a compatibility alias - but it means an environment that already
-- applied this file MUST re-apply it and will lose the rows it had (dead rooms, all of them).
-- The runbook says so out loud: docs/cloudflare-setup.md 2a.
--
-- Apply: wrangler d1 migrations apply jeopardy-machine --remote -c apps/web/wrangler.jsonc
-- (docs/cloudflare-setup.md section 2c; --local for the dev loop, docs/DEVELOPMENT.md).

DROP TABLE IF EXISTS rooms;

CREATE TABLE rooms (
  code TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  -- Empty string = the host did not name themselves; the lobby then shows no byline.
  host_label TEXT NOT NULL DEFAULT '',
  -- The listing axis: public rooms appear in the browsable lobby, private ones never do.
  -- Editable while the room runs, so this column moves (apps/realtime/src/room/registry-writer.ts).
  listing TEXT NOT NULL CHECK (listing IN ('public', 'private')),
  has_password INTEGER NOT NULL DEFAULT 0 CHECK (has_password IN (0, 1)),
  phase TEXT NOT NULL CHECK (phase IN ('lobby', 'active', 'ended')),
  player_count INTEGER NOT NULL DEFAULT 0,
  -- The ROOM's own settings.maxPlayers, not the product limit: "7/24" in the lobby has to mean
  -- the door this host actually set, and it moves when they retune it.
  player_cap INTEGER NOT NULL,
  -- Unix ms throughout, matching the wire and the DO's clock.
  created_at INTEGER NOT NULL,
  -- Refreshed by the DO on meaningful transitions; how the lobby tells a live room from a
  -- row whose DO stopped reporting (registry drift is expected and visible, never fatal).
  last_seen_at INTEGER NOT NULL,
  -- The idle-expiry deadline as last known. The listing query filters on it, so even a row
  -- the DO never got to clean up delists itself on time.
  expires_at INTEGER NOT NULL,
  ended_at INTEGER
) STRICT;

-- The lobby query: newest-first among live public rooms.
CREATE INDEX IF NOT EXISTS rooms_public_listing ON rooms (listing, created_at DESC);

-- The reconcile sweep: delete rows whose deadline has passed (cheap, bounded, index-driven).
CREATE INDEX IF NOT EXISTS rooms_expiry_sweep ON rooms (expires_at);
