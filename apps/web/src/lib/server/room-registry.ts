// The room registry repository - the ONLY place the web Worker touches the `rooms` D1 table
// (migrations/0001_create_rooms.sql is that table's canonical schema).
//
// SERVER-ONLY: nothing under src/lib/server may be imported from a component; the D1 binding
// exists solely inside the Worker. Every statement is parameterized - room codes and
// host-supplied titles are untrusted input, and string-built SQL is how a lobby becomes an
// injection surface.
//
// Contract with the rest of the system (docs/decisions/2026-08-14-room-visibility-and-lobby.md):
// - rows are a CACHE of DO truth, so every read filters on liveness (phase, ended_at,
//   expires_at) instead of believing what it finds;
// - writes are BEST EFFORT - a failed registry write must never fail a room creation or a
//   join, it may only cost a lobby row (the caller decides, see the route handlers);
// - the room DO writes this same table directly through its own D1 binding
//   (apps/realtime/src/room/registry-writer.ts holds its three statements; the realtime
//   workerd suite runs them against THIS migration so a column rename cannot drift silently).
import { limits } from "@jeopardy/protocol/limits";
import type { RegistryRowState } from "@jeopardy/protocol/room/diagnostics";
import type { RegistryStatus, RoomSummary } from "@jeopardy/protocol/room/registry";
import type { RoomListing } from "@jeopardy/protocol/room/visibility";

// The sliver of D1 this module uses, typed structurally for the same reason App.Platform is
// (src/app.d.ts): pulling @cloudflare/workers-types into a DOM-lib SvelteKit app trades a few
// lines of shape for a world of lib conflicts. Shapes match D1Database/D1PreparedStatement.
export type RegistryStatement = {
  bind(...values: unknown[]): RegistryStatement;
  run(): Promise<unknown>;
  all<Row>(): Promise<{ results: Row[] }>;
};
export type RegistryDatabase = {
  prepare(query: string): RegistryStatement;
  batch(statements: RegistryStatement[]): Promise<unknown[]>;
};

// What the create route knows at insert time. `expiresAt` comes from the DO's answer, so the
// row's delisting deadline is the room's real one rather than a second guess at it.
export type RoomRegistration = {
  code: string;
  title: string;
  hostLabel: string;
  listing: RoomListing;
  // The room's own settings.maxPlayers - what the lobby fraction must mean (registry.ts).
  playerCap: number;
  // The second budget, from the same settings object. The COUNT is not here: a room being
  // created has no connections yet, and only the DO can ever see one (spectators hold no
  // roster seat), so the count arrives with the first touch.
  spectatorCap: number;
  spectatorsAllowed: boolean;
  createdAt: number;
  expiresAt: number;
};

type RoomRow = {
  code: string;
  title: string;
  host_label: string;
  listing: string;
  phase: string;
  player_count: number;
  player_cap: number;
  spectator_count: number;
  spectator_cap: number;
  spectators_allowed: number;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
};

// A code is reusable once its room expires (single-origin decision doc, lifecycle), so the
// insert must be able to land on a stale row for the same code - upsert, not insert.
const upsertSql = `INSERT INTO rooms
  (code, title, host_label, listing, phase, player_count, player_cap,
   spectator_count, spectator_cap, spectators_allowed,
   created_at, last_seen_at, expires_at, ended_at)
  VALUES (?, ?, ?, ?, 'lobby', 0, ?, 0, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(code) DO UPDATE SET
    title = excluded.title,
    host_label = excluded.host_label,
    listing = excluded.listing,
    phase = 'lobby',
    player_count = 0,
    player_cap = excluded.player_cap,
    spectator_count = 0,
    spectator_cap = excluded.spectator_cap,
    spectators_allowed = excluded.spectators_allowed,
    created_at = excluded.created_at,
    last_seen_at = excluded.last_seen_at,
    expires_at = excluded.expires_at,
    ended_at = NULL`;

// Live public rooms, newest first. Liveness is asserted here rather than trusted: a room the
// DO stopped reporting on delists itself when its expiry deadline passes, and `ended` rooms
// never appear even if the sweep has not run yet.
const listSql = `SELECT code, title, host_label, listing, phase,
    player_count, player_cap, spectator_count, spectator_cap, spectators_allowed,
    created_at, last_seen_at, expires_at
  FROM rooms
  WHERE listing = 'public'
    AND ended_at IS NULL
    AND phase IN ('lobby', 'active')
    AND expires_at > ?
  ORDER BY created_at DESC
  LIMIT ?`;

// The reconcile sweep the decision doc promises: rows outlive their rooms whenever a DO dies
// without a clean shutdown (D1 hiccup, eviction mid-write). Nothing here is authoritative, so
// deleting anything past its deadline is always safe.
const sweepSql = `DELETE FROM rooms WHERE expires_at <= ?`;

const deleteSql = `DELETE FROM rooms WHERE code = ?`;

// One room's row as the inspector reads it (the DO's own belief is fetched separately, and
// the point is comparing the two).
const rowStateSql = `SELECT listing, phase, player_count, expires_at, ended_at
  FROM rooms
  WHERE code = ?`;

// Liveness probe for /api/version: touches the table, reads nothing, and costs one parse. Its
// only job is to make "the migration was never applied" answerable without creating a room.
const probeSql = `SELECT code FROM rooms LIMIT 0`;

export function registerRoom(
  database: RegistryDatabase,
  registration: RoomRegistration,
): Promise<unknown> {
  return database
    .prepare(upsertSql)
    .bind(
      registration.code,
      registration.title,
      registration.hostLabel,
      registration.listing,
      registration.playerCap,
      registration.spectatorCap,
      registration.spectatorsAllowed ? 1 : 0,
      registration.createdAt,
      registration.createdAt,
      registration.expiresAt,
    )
    .run();
}

export async function listPublicRooms(
  database: RegistryDatabase,
  now: number,
  listingMax: number = limits.lobby.listingMax,
): Promise<RoomSummary[]> {
  // The cap is an operational limit, not a caller preference: hosts (and callers) cannot
  // lift it, so a hand-written `?limit=500` cannot turn a browse surface into a scraper feed.
  const cap = Math.min(Math.max(Math.trunc(listingMax), 1), limits.lobby.listingMax);
  const { results } = await database.prepare(listSql).bind(now, cap).all<RoomRow>();
  return results.map(toRoomSummary);
}

/** Delete rows whose room's expiry deadline has passed. Returns nothing useful by design. */
export function sweepExpiredRooms(database: RegistryDatabase, now: number): Promise<unknown> {
  return database.prepare(sweepSql).bind(now).run();
}

/** Host delisting a room, and the cleanup path when a create attempt is rolled back. */
export function forgetRoom(database: RegistryDatabase, code: string): Promise<unknown> {
  return database.prepare(deleteSql).bind(code).run();
}

/**
 * What the registry believes about ONE room (the DO inspector's second opinion). Null = no
 * row at all, which next to a live room is real drift and next to a `no-table` status is the
 * missing migration saying so again.
 */
export async function readRegistryRow(
  database: RegistryDatabase,
  code: string,
  now: number,
): Promise<RegistryRowState | null> {
  const { results } = await database.prepare(rowStateSql).bind(code).all<{
    listing: string;
    phase: string;
    player_count: number;
    expires_at: number;
    ended_at: number | null;
  }>();
  const row = results[0];
  if (row === undefined) return null;
  const phase = row.phase === "active" ? "active" : row.phase === "ended" ? "ended" : "lobby";
  return {
    // Exactly the listing query's predicate, restated against one row: "would the lobby show
    // this?" is the question the harness asks, and it must not drift from listSql above.
    listed:
      row.listing === "public" &&
      row.ended_at === null &&
      (phase === "lobby" || phase === "active") &&
      row.expires_at > now,
    phase,
    playerCount: row.player_count,
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
  };
}

/**
 * Would a client be walking into a room that still exists? The listing query answers this for
 * PUBLIC rooms only; the front door's rejoin offer needs the same verdict for a private room
 * it holds the code for (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md).
 * Same three liveness facts as `listSql`, minus the listing predicate - deliberately, because
 * being browsable and being alive are the two independent axes this milestone is built on.
 */
export function registryRowIsLive(row: RegistryRowState, now: number): boolean {
  return row.endedAt === null && row.phase !== "ended" && row.expiresAt > now;
}

/**
 * Turn a D1 failure into the wire's registry status. The SQLite message is the only signal
 * that separates "this deployment never had its migration applied" - the overwhelmingly
 * common cause of an empty lobby, and the one an owner can fix in one command - from a
 * genuine database fault. Matched on the message text because that is what D1 gives us; a
 * wording change downgrades a `no-table` to `error`, which stays loud either way.
 */
export function registryStatusFromError(error: unknown): RegistryStatus {
  const detail = describeError(error);
  return {
    status: "unavailable",
    reason: /no such table/i.test(detail) ? "no-table" : "error",
    detail: detail.slice(0, 300),
  };
}

/** Is the registry answering at all? The cheapest honest answer, for /api/version. */
export async function probeRegistry(
  database: RegistryDatabase | undefined,
): Promise<RegistryStatus> {
  if (database === undefined) return { status: "unavailable", reason: "no-binding" };
  try {
    await database.prepare(probeSql).bind().all();
    return { status: "ok" };
  } catch (error) {
    return registryStatusFromError(error);
  }
}

// D1 nests the real SQLite complaint in `cause`, and the outer message is often the generic
// D1_ERROR wrapper - so both go into the string the reason is matched against and shown.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
}

// D1 has no booleans and stores our phases as text; the row shape is infrastructure and the
// summary is the wire contract, so the conversion lives here and nowhere else.
function toRoomSummary(row: RoomRow): RoomSummary {
  return {
    code: row.code,
    title: row.title,
    hostLabel: row.host_label,
    listing: row.listing === "public" ? "public" : "private",
    phase: row.phase === "active" ? "active" : row.phase === "ended" ? "ended" : "lobby",
    playerCount: row.player_count,
    playerCap: row.player_cap,
    // Always emitted from a row this repository read: the columns exist (the migration is the
    // schema), so a listing from THIS server always carries the spectator facts. The wire
    // fields stay optional for servers that predate them, never for rows we just read.
    spectatorCount: row.spectator_count,
    spectatorCap: row.spectator_cap,
    spectatorsAllowed: row.spectators_allowed !== 0,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

// Exported for the schema-drift gate test (src/lib/server/room-registry.test.ts), which reads
// the migration and asserts every column these statements name really exists.
export const registryStatements = {
  upsert: upsertSql,
  list: listSql,
  sweep: sweepSql,
  delete: deleteSql,
  rowState: rowStateSql,
  probe: probeSql,
} as const;
