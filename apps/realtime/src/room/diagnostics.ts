// The DO inspector's projection: everything a HOST may learn about a live room, and nothing
// else (owner request 2026-08-14, "provide more information about the DO objects"; wire shape
// in @jeopardy/protocol/room/diagnostics).
//
// Pure and partyserver-free like every module under room/ (docs/decisions/2026-08-13-
// partyserver.md): the DO counts its own connections and hands the census in. That split is
// also what makes the redaction testable - the only inputs are room storage, and the only
// output is this shape, so "does a session token reach the wire" is a unit question.
//
// Redaction is by CONSTRUCTION, not by filtering: nothing here reads meta.hostToken,
// meta.password, entry.sessionToken, or any authored clue text. The storage sizes are
// measured from serialized values and the values themselves are discarded.
import { limits } from "@jeopardy/protocol/limits";
import { nextWakeAt } from "./storage.ts";
import type { ConnectionCensus, RoomDiagnostics } from "@jeopardy/protocol/room/diagnostics";
import type { AlarmSchedule, RoomMeta, StoredRoster, StoredTeams } from "./storage.ts";

export type DiagnosticsInput = {
  meta: RoomMeta;
  roster: StoredRoster;
  teams: StoredTeams;
  schedule: AlarmSchedule;
  connections: ConnectionCensus;
  // The loaded storage bundle, keyed as it is persisted. Sizes only - see the header.
  bundle: Record<string, unknown>;
};

export function buildRoomDiagnostics(input: DiagnosticsInput): RoomDiagnostics {
  const { meta, roster, teams, schedule } = input;
  const players = Object.values(roster);
  const expiresAt = meta.lastActivityAt + limits.room.idleExpiryMs;
  return {
    code: meta.code,
    lifecycle: meta.lifecycle,
    visibility: meta.visibility,
    title: meta.title,
    hostLabel: meta.hostLabel,
    hasPassword: meta.password !== null,
    createdAt: meta.createdAt,
    lastActivityAt: meta.lastActivityAt,
    expiresAt,
    paused: meta.pausedAt !== null,
    stateVersion: meta.stateVersion,
    connections: input.connections,
    roster: {
      players: players.length,
      connected: players.filter((entry) => entry.connected).length,
      teams: Object.keys(teams).length,
    },
    alarm: {
      // The runtime alarm is always min() of the book (storage.ts), so recomputing it here is
      // the same arithmetic the scheduler used - not a second opinion that can drift.
      nextWakeAt: nextWakeAt(schedule, meta, limits.room.idleExpiryMs),
      entries: alarmEntries(schedule, expiresAt, meta.pausedAt !== null),
    },
    storage: storageSizes(input.bundle),
  };
}

// The alarm book flattened for reading, earliest first. A PAUSED room's engine timers are
// deliberately included and marked by their frozen dueAt: "why did my clue timer not fire"
// is exactly the question this answers, and the pause flag sits right above it.
function alarmEntries(
  schedule: AlarmSchedule,
  expiresAt: number,
  paused: boolean,
): RoomDiagnostics["alarm"]["entries"] {
  const entries: RoomDiagnostics["alarm"]["entries"] = [
    { source: "idle-expiry", label: paused ? "room (paused)" : "room", dueAt: expiresAt },
  ];
  for (const [kind, entry] of Object.entries(schedule.engineTimers)) {
    entries.push({ source: "engine-timer", label: kind.slice(0, 60), dueAt: entry.dueAt });
  }
  for (const [teamId, entry] of Object.entries(schedule.successions)) {
    entries.push({ source: "team-succession", label: teamId.slice(0, 60), dueAt: entry.dueAt });
  }
  // The schema caps the array; a room cannot realistically exceed it (one timer per kind plus
  // one succession per team), but a cap that can be hit is a 500 waiting to happen.
  return entries.toSorted((left, right) => left.dueAt - right.dueAt).slice(0, 64);
}

// Approximate bytes per storage key, measured as serialized JSON characters of what the DO
// already holds in memory - no extra storage reads, and precise enough for its only question:
// which key is growing. (The action log inside "state" is the one that ever will.)
function storageSizes(bundle: Record<string, unknown>): RoomDiagnostics["storage"] {
  const keys = Object.entries(bundle)
    .map(([key, value]) => ({
      key: key.slice(0, 40),
      bytes: value === undefined ? 0 : JSON.stringify(value).length,
    }))
    .toSorted((left, right) => right.bytes - left.bytes);
  return { totalBytes: keys.reduce((total, entry) => total + entry.bytes, 0), keys };
}
