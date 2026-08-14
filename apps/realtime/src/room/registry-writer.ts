// The room DO's half of the registry (docs/decisions/2026-08-14-room-visibility-and-lobby.md,
// addendum "How registry updates reach D1"): three statements against the SAME `rooms` table
// the web Worker owns, through this Worker's own D1 binding.
//
// Why the DO writes D1 directly instead of calling the web Worker: a DO cannot import the web
// app, and the alternatives are worse. A service binding back to the web Worker would add a
// circular binding (web already binds this Worker's DO namespace), a network hop on every
// transition, and an internal endpoint needing a shared secret - a new trust boundary bought
// for nothing. Letting the web Worker own all writes would simply lose the events: phase
// changes, roster counts and expiry all happen INSIDE the DO with no request to piggyback on.
// D1 bindings are shareable, so this is the boring option.
//
// SCHEMA OWNERSHIP: apps/web/migrations/0001_create_rooms.sql is canonical and the web
// repository (apps/web/src/lib/server/room-registry.ts) is the full one. This file holds only
// what a live room needs to report. The drift risk is real and gated: apps/realtime's
// registry suite applies that migration and runs these statements against it, so a column
// rename in the web migration reddens here.
//
// FAILURE MODE (by design): every write is best effort. A D1 error, an evicted DO, or an
// unapplied migration costs the lobby an accurate row - never a player their game. Rows are a
// cache; the DO refuses dead rooms on connect regardless of what the registry believes, and
// the listing query filters on expires_at so a row nobody ever cleaned up delists itself.

export type RegistrySnapshot = {
  code: string;
  phase: "lobby" | "active" | "ended";
  playerCount: number;
  lastSeenAt: number;
  expiresAt: number;
};

// Only ever an UPDATE: the row is created by the web Worker's create route, and a room that
// has no row (unapplied migration, failed insert) must not resurrect itself as an unlisted
// ghost with a fabricated title.
const touchSql = `UPDATE rooms
  SET phase = ?, player_count = ?, last_seen_at = ?, expires_at = ?
  WHERE code = ?`;

const endSql = `UPDATE rooms SET phase = 'ended', ended_at = ?, last_seen_at = ? WHERE code = ?`;

const deleteSql = `DELETE FROM rooms WHERE code = ?`;

/** Report the room's live state. Silent on failure - the caller has a game to run. */
export async function touchRegistryRow(
  database: D1Database | undefined,
  snapshot: RegistrySnapshot,
): Promise<void> {
  if (database === undefined) return;
  try {
    await database
      .prepare(touchSql)
      .bind(
        snapshot.phase,
        snapshot.playerCount,
        snapshot.lastSeenAt,
        snapshot.expiresAt,
        snapshot.code,
      )
      .run();
  } catch (error) {
    console.warn("registry touch failed (the lobby row may be stale)", error);
  }
}

/** The room is over but still browsable history for a moment; the sweep collects it later. */
export async function endRegistryRow(
  database: D1Database | undefined,
  code: string,
  endedAt: number,
): Promise<void> {
  if (database === undefined) return;
  try {
    await database.prepare(endSql).bind(endedAt, endedAt, code).run();
  } catch (error) {
    console.warn("registry end failed (the lobby row may linger until the sweep)", error);
  }
}

/** Expiry wiped the room and freed its code - the row must go with it, not outlive it. */
export async function deleteRegistryRow(
  database: D1Database | undefined,
  code: string,
): Promise<void> {
  if (database === undefined) return;
  try {
    await database.prepare(deleteSql).bind(code).run();
  } catch (error) {
    console.warn("registry delete failed (the sweep will collect the row)", error);
  }
}

// Exported for the drift gate in apps/realtime/test/registry.test.ts.
export const registryWriterStatements = {
  touch: touchSql,
  end: endSql,
  delete: deleteSql,
} as const;
