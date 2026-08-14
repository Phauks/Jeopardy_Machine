// The GameRoomDO storage layout - every durable fact about a room, hibernation-safe. The DO
// keeps an in-memory cache of these values purely as an optimization; the truth is ALWAYS
// what ctx.storage holds, because hibernation (and eviction, which the test suite triggers
// on purpose) wipes memory between any two events. Pure types + key names only: no
// partyserver imports here (transport-boundary rule, docs/decisions/2026-08-13-partyserver.md).
//
// Keys (DO KV over SQLite; values up to 2 MB, far above a full GameState with action log):
// - "meta":     RoomMeta - lifecycle, tokens, counters, activity stamp, state version
// - "setup":    GameSetup - the engine's static per-game input, built at initialize
// - "spec":     RoomGameSpec - the creation-time game spec, kept verbatim for M4 surfaces
//               (prompt/answer text never enters the engine; the hosting layer joins them)
// - "state":    GameState - the live engine state incl. the append-only action log
//               (crash recovery = replaying that log; snapshot = this object, redacted)
// - "roster":   Record<playerId, StoredRosterEntry> - seats + personal tier + secrets
// - "teams":    Record<teamId, TeamDoc> - the team customization tier
// - "renames":  Record<participantId, number[]> - rename timestamps for rate limiting
// - "schedule": AlarmSchedule - the multiplexed alarm book (engine timers, leadership
//               succession, room expiry); the ONE runtime alarm is always min() of these
import type { RoomGameSpec } from "@jeopardy/protocol/room/create";
import type { RosterEntry, TeamDoc } from "@jeopardy/protocol/room/roster";
import type { RoomVisibility } from "@jeopardy/protocol/room/visibility";
import type { GameActionType } from "@jeopardy/engine/actions";
import type { StoredRoomPassword } from "./password.ts";

export type RoomLifecycle = "lobby" | "active" | "ended";

export type RoomMeta = {
  code: string;
  hostToken: string;
  // Listing + entry, the two independent axes of docs/decisions/2026-08-14-room-visibility-
  // and-lobby.md. `visibility` decides whether the registry row is browsable; `password` is
  // the salted hash of the shared room secret (null = an open room). The hash lives HERE and
  // only here - the registry row carries has_password and nothing else, so the lobby can
  // never be used as a password oracle.
  visibility: RoomVisibility;
  title: string;
  hostLabel: string;
  password: StoredRoomPassword | null;
  createdAt: number;
  // Bumped (coalesced - see the DO's touchActivity) on connects and messages; expiry
  // compares against limits.room.idleExpiryMs.
  lastActivityAt: number;
  // Monotonic, incremented once per state-changing broadcast batch (an `event` message and
  // its companion buzz-won share one version). Clients gap-detect against it and re-sync.
  stateVersion: number;
  lifecycle: RoomLifecycle;
  // Host-held freeze (client message set-pause). Unix ms when the room was paused, null when
  // running. Room-level rather than engine-level: @jeopardy/engine has no pause concept, so
  // the room parks the alarm book (each running timer keeps its remaining time in
  // EngineTimerEntry.remainingMs) and every client is told - guiding principle 4, every
  // automated step has a manual override.
  pausedAt: number | null;
  // Monotonic counters for minted ids: seats are "p-<n>", teams "t-<n>". Session/host
  // TOKENS are crypto-random; ids are deliberately small and readable in logs.
  playerCounter: number;
  teamCounter: number;
};

export type StoredRosterEntry = RosterEntry & {
  // The resume secret (never broadcast; the wire RosterEntry shape strips it).
  sessionToken: string;
};

export type EngineTimerEntry = {
  dueAt: number;
  // Set only while the room is paused: what was left on this timer at the moment of the
  // freeze. Resuming turns it back into a dueAt, so a pause never silently expires a clue.
  remainingMs?: number;
  // The expiry action the engine asked for via its timer-set hint. Stale entries (phase
  // moved on, undo rewound) fire as harmless engine rejections and are dropped silently.
  actionType: GameActionType;
};

export type SuccessionEntry = {
  dueAt: number;
  // Leadership passes only if THIS player is still the leader and still disconnected when
  // the grace elapses (a reconnect in between makes the entry a no-op).
  leaderPlayerId: string;
};

export type AlarmSchedule = {
  // Keyed by the engine's TimerKind - one pending expiry per timer kind, latest wins.
  engineTimers: Record<string, EngineTimerEntry>;
  // Keyed by teamId.
  successions: Record<string, SuccessionEntry>;
};

export const emptySchedule: AlarmSchedule = { engineTimers: {}, successions: {} };

/**
 * The next moment the DO must wake: earliest scheduled entry or the idle expiry. A PAUSED
 * room contributes no engine timers - that is what the freeze means; leadership succession
 * and idle expiry keep running, because phones still drop and rooms still age while a host
 * holds the room.
 */
export function nextWakeAt(schedule: AlarmSchedule, meta: RoomMeta, idleExpiryMs: number): number {
  let earliest = meta.lastActivityAt + idleExpiryMs;
  if (meta.pausedAt === null) {
    for (const entry of Object.values(schedule.engineTimers)) {
      earliest = Math.min(earliest, entry.dueAt);
    }
  }
  for (const entry of Object.values(schedule.successions)) {
    earliest = Math.min(earliest, entry.dueAt);
  }
  return earliest;
}

/** Strip secrets from a stored roster entry for the wire (protocol RosterEntry shape). */
export function toWireRosterEntry(entry: StoredRosterEntry): RosterEntry {
  const { sessionToken: _secret, ...wire } = entry;
  return wire;
}

export type StoredTeams = Record<string, TeamDoc>;
export type StoredRoster = Record<string, StoredRosterEntry>;
export type RenameLog = Record<string, number[]>;

// Room storage as one loaded bundle (the DO's load/persist unit).
export type RoomDurableState = {
  meta: RoomMeta;
  spec: RoomGameSpec;
  roster: StoredRoster;
  teams: StoredTeams;
  renames: RenameLog;
  schedule: AlarmSchedule;
};
