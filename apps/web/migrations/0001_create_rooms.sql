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
-- Apply: wrangler d1 migrations apply jeopardy-machine --remote -c apps/web/wrangler.jsonc
-- (docs/cloudflare-setup.md section 2c; --local for the dev loop, docs/DEVELOPMENT.md).

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  -- Empty string = the host did not name themselves; the lobby then shows no byline.
  host_label TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted')),
  has_password INTEGER NOT NULL DEFAULT 0 CHECK (has_password IN (0, 1)),
  phase TEXT NOT NULL CHECK (phase IN ('lobby', 'active', 'ended')),
  player_count INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS rooms_public_listing ON rooms (visibility, created_at DESC);

-- The reconcile sweep: delete rows whose deadline has passed (cheap, bounded, index-driven).
CREATE INDEX IF NOT EXISTS rooms_expiry_sweep ON rooms (expires_at);
