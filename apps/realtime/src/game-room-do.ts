// GameRoomDO - the authoritative per-room server. One instance per game room, addressed by
// idFromName(roomCode); every client (host console, board display, player phones, bots)
// holds a WebSocket to it through the single origin (docs/decisions/2026-08-13-single-
// origin-binding.md). Responsibilities:
//
// - Explicit lifecycle: rooms exist only after the typed /initialize RPC (from the web
//   Worker's create route); connecting NEVER creates - uninitialized codes get refused with
//   no-such-room. An idle-expiry alarm wipes the room and frees its code.
// - The engine feed: relayed actions are stamped with server arrival time + session
//   identity (room/engine-glue.ts), run through @jeopardy/engine's transition, persisted,
//   and narrated to every client as redacted event batches.
// - Buzz latency compensation (M6, docs/decisions/2026-08-17-buzz-latency-compensation.md):
//   while an arming is open, buzzes are HELD for a few milliseconds in room/arm-window.ts,
//   ranked by credited reaction time, and only then fed to the engine as an ordered list.
//   The engine never learns any of this happened - reordering is upstream of it, which is
//   what boundary 2.1 requires. With the setting off, arrival order is the order, exactly
//   as it was in M3.
// - Timer hints -> alarms: the engine's timer-set events become scheduled expiry actions in
//   a multiplexed alarm book (room/storage.ts) alongside leadership-succession checks and
//   the expiry deadline; the ONE runtime alarm always sits at the earliest entry.
// - Hibernation safety: all room truth lives in ctx.storage; connection identity lives in
//   WebSocket attachments (partyserver's setState); in-memory fields are caches or
//   best-effort (the message rate limiter) and survive eviction by being reloadable.
//
// Transport is partyserver (decision: docs/decisions/2026-08-13-partyserver.md): it owns
// connection lifecycle, hibernation bookkeeping, and routing; ALL room semantics live here
// and in the pure modules under room/ (which never import partyserver).
import { gameActionSchema } from "@jeopardy/engine/actions";
import { createInitialState } from "@jeopardy/engine/state";
import { plainRoundSetup, setupFromGameDefinition } from "@jeopardy/engine/setup";
import { transition } from "@jeopardy/engine/transition";
import { resolvePreset } from "@jeopardy/protocol";
import { teamsAreOffered, teamsAreRequired } from "@jeopardy/protocol/settings/player-mode";
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { limits } from "@jeopardy/protocol/limits";
import { createRoomRequestSchema, generateSecretToken } from "@jeopardy/protocol/room/create";
import { parseRoomClientMessage } from "@jeopardy/protocol/room/client-messages";
import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
import { updateRoomSettingsRequestSchema } from "@jeopardy/protocol/room/room-settings";
import { roomCloseCodes } from "@jeopardy/protocol/room/server-messages";
import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  adjudicateArmWindow,
  openArmWindow,
  queueBuzz,
  recordRoundTrip,
} from "./room/arm-window.ts";
import {
  boardMaterial,
  clueContentFor,
  packOf,
  resolveCellContent,
  resolveFinalContent,
} from "./room/content.ts";
import { buildRoomDiagnostics } from "./room/diagnostics.ts";
import { liveRulesOf } from "./room/live-rules.ts";
import {
  identityEditsLocked,
  stampRelayedAction,
  timerExpiryAction,
  timerLiveInPhase,
} from "./room/engine-glue.ts";
import { redactEventsFor, redactStateFor } from "./room/redact.ts";
import {
  deleteRegistryRow,
  endRegistryRow,
  relistRegistryRow,
  touchRegistryRow,
} from "./room/registry-writer.ts";
import {
  emptySchedule,
  nextWakeAt,
  roomSettingsPayload,
  runningTimers,
  toWireRosterEntry,
} from "./room/storage.ts";
import type { GameAction } from "@jeopardy/engine/actions";
import type { GameEvent } from "@jeopardy/engine/events";
import type { GameSetup } from "@jeopardy/engine/setup";
import type { GameState } from "@jeopardy/engine/state";
import type { ConnectionCensus } from "@jeopardy/protocol/room/diagnostics";
import type { RoomGameSpec } from "@jeopardy/protocol/room/create";
import type { ActionTiming, RoomClientMessage } from "@jeopardy/protocol/room/client-messages";
import type { RefusalReason, RoomErrorReason } from "@jeopardy/protocol/room/server-messages";
import type { RoomRole } from "@jeopardy/protocol/room/identity";
import type { RosterPayload, TeamDoc } from "@jeopardy/protocol/room/roster";
import type { RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
import type { ArmWindow } from "./room/arm-window.ts";
import type { RegistryListing, RegistrySnapshot } from "./room/registry-writer.ts";
import type {
  AlarmSchedule,
  RenameLog,
  RoomMeta,
  StoredRoster,
  StoredRosterEntry,
  StoredTeams,
} from "./room/storage.ts";

// What a connection remembers about itself across hibernation (WebSocket attachment).
type Attachment = { role: RoomRole; playerId: string | null };

// Floor between throttled registry writes. A lobby refreshes every
// limits.lobby.listingRefreshMs, so reporting faster than this could never be seen anyway -
// while a 100-phone join stampede would otherwise cost 100 D1 writes for one visible number.
const registrySyncIntervalMs = 5000;

// The loaded room bundle; null = the DO woke for a room that was never initialized (or has
// expired) and must refuse everything except /initialize.
type LoadedRoom = {
  meta: RoomMeta;
  setup: GameSetup;
  state: GameState;
  spec: RoomGameSpec;
  roster: StoredRoster;
  teams: StoredTeams;
  renames: RenameLog;
  schedule: AlarmSchedule;
  // The open arming's held buzzes and round-trip samples; null between armings (M6).
  armWindow: ArmWindow | null;
};

type RoomStorageKey =
  | "meta"
  | "setup"
  | "state"
  | "spec"
  | "roster"
  | "teams"
  | "renames"
  | "schedule"
  | "armWindow";

function setupFromSpec(spec: RoomGameSpec, seed: string): GameSetup {
  if (spec.kind === "definition") return setupFromGameDefinition(spec.body, seed);
  return {
    settings: resolvePreset(spec.preset, spec.overrides),
    rounds: spec.rounds.map(plainRoundSetup),
    hasFinalClue: spec.hasFinalClue,
    seed,
  };
}

export class GameRoomDO extends Server {
  // Hibernation is non-negotiable (architecture doc §3): between clues the DO must be
  // evictable while sockets stay connected, or we pay wall-clock duration for whole games.
  static override options = { hibernate: true };

  // In-memory cache of the storage bundle; undefined = not loaded this wake. Safe because
  // the DO is single-threaded and this class is the only writer.
  private room: LoadedRoom | null | undefined;
  // Best-effort per-connection rate limiter. In-memory ON PURPOSE: persisting per-message
  // counters would cost a write per frame; losing the window across hibernation just resets
  // the meter, which only ever errs in the client's favor.
  private messageStamps = new Map<string, number[]>();
  private lastPersistedActivity = 0;
  // Coalescing stamp for registry writes (see syncRegistry).
  private lastRegistrySyncAt = 0;

  override onStart(): void {
    // Heartbeat auto-response: phones ping to keep venue Wi-Fi NAT mappings alive; the
    // runtime answers without waking (and without billing) the DO. partyserver does not
    // wire this itself (docs/decisions/2026-08-13-partyserver.md).
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- storage bundle -------------------------------------------------------------------

  private async load(): Promise<LoadedRoom | null> {
    if (this.room !== undefined) return this.room;
    const keys: RoomStorageKey[] = [
      "meta",
      "setup",
      "state",
      "spec",
      "roster",
      "teams",
      "renames",
      "schedule",
      "armWindow",
    ];
    const values = await this.ctx.storage.get<unknown>(keys);
    const meta = values.get("meta") as RoomMeta | undefined;
    if (meta === undefined) {
      this.room = null;
      return null;
    }
    this.room = {
      meta,
      setup: values.get("setup") as GameSetup,
      state: values.get("state") as GameState,
      spec: values.get("spec") as RoomGameSpec,
      roster: (values.get("roster") as StoredRoster | undefined) ?? {},
      teams: (values.get("teams") as StoredTeams | undefined) ?? {},
      renames: (values.get("renames") as RenameLog | undefined) ?? {},
      // Spread over the empty book rather than replacing it: a room stored before a new
      // schedule field existed (the M6 buzz deadline) must come back with that field defined
      // rather than undefined, or the first comparison against it is a silent no-op.
      schedule: {
        ...structuredClone(emptySchedule),
        ...(values.get("schedule") as Partial<AlarmSchedule> | undefined),
      },
      armWindow: (values.get("armWindow") as ArmWindow | undefined) ?? null,
    };
    this.lastPersistedActivity = meta.lastActivityAt;
    return this.room;
  }

  private async persist(...keys: RoomStorageKey[]): Promise<void> {
    const room = this.room;
    if (room === null || room === undefined) return;
    const entries: Record<string, unknown> = {};
    for (const key of keys) entries[key] = room[key];
    await this.ctx.storage.put(entries);
  }

  // Activity is bumped in memory on every touch but persisted coalesced (60s), so a buzz
  // storm costs one write, not hundreds. Worst case a room expires <60s early after 2h of
  // silence - invisible in practice, and every state-changing write persists meta anyway.
  private async touchActivity(): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    room.meta.lastActivityAt = Date.now();
    if (room.meta.lastActivityAt - this.lastPersistedActivity > 60_000) {
      this.lastPersistedActivity = room.meta.lastActivityAt;
      await this.persist("meta");
    }
  }

  // ---- registry projection --------------------------------------------------------------

  private registrySnapshot(room: LoadedRoom): RegistrySnapshot {
    return {
      code: room.meta.code,
      phase: room.meta.lifecycle,
      playerCount: Object.keys(room.roster).length,
      // Counted from live connections, not the roster - a spectator never takes a seat, which
      // is the entire reason the two budgets exist (packages/protocol/src/room/room-settings.ts).
      spectatorCount: this.spectatorCount(),
      lastSeenAt: Date.now(),
      expiresAt: room.meta.lastActivityAt + limits.room.idleExpiryMs,
    };
  }

  // Report this room to the D1 registry that backs the public lobby. Coalesced like activity
  // persistence: a 100-phone join stampede must not cost 100 D1 writes, so ordinary roster
  // churn is throttled while phase changes (lobby -> active -> ended) always go through -
  // those are what a browser actually reads. Failures are swallowed inside the writer: the
  // row is a cache, and a stale row can never let anyone into a dead room.
  private async syncRegistry(options: { force?: boolean } = {}): Promise<void> {
    const room = this.room;
    if (room === null || room === undefined) return;
    const now = Date.now();
    if (options.force !== true && now - this.lastRegistrySyncAt < registrySyncIntervalMs) return;
    this.lastRegistrySyncAt = now;
    await touchRegistryRow(this.env.DB, this.registrySnapshot(room));
  }

  private async rescheduleAlarm(): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    await this.ctx.storage.setAlarm(nextWakeAt(room.schedule, room.meta, limits.room.idleExpiryMs));
  }

  // ---- send helpers ---------------------------------------------------------------------

  private send(connection: Connection, payload: Record<string, unknown>): void {
    connection.send(JSON.stringify({ version: protocolVersion, ...payload }));
  }

  private sendError(connection: Connection, reason: RoomErrorReason, detail?: string): void {
    this.send(connection, { type: "error", reason, ...(detail !== undefined && { detail }) });
  }

  private refuse(connection: Connection, reason: RefusalReason, closeCode?: number): void {
    this.send(connection, { type: "refused", reason });
    if (closeCode !== undefined) connection.close(closeCode, reason);
  }

  private wireRoster(): RosterPayload {
    const room = this.room;
    if (room === null || room === undefined) return { players: [], teams: [], spectatorCount: 0 };
    const players = Object.values(room.roster)
      .toSorted((a, b) => a.joinedAt - b.joinedAt)
      .map(toWireRosterEntry);
    // The audience travels as a COUNT, from live connections - spectators hold no roster seat
    // and no identity, so this is the only fact about them that exists. Always sent by this
    // server (the field is optional on the wire so "not reported" stays expressible for a
    // producer that cannot count, never so that a real room can go quiet about its audience).
    return { players, teams: Object.values(room.teams), spectatorCount: this.spectatorCount() };
  }

  private broadcastRoster(): void {
    const payload = { type: "roster", roster: this.wireRoster() };
    for (const connection of this.getConnections<Attachment>()) {
      if (connection.state !== null) this.send(connection, payload);
    }
  }

  private sendSnapshot(connection: Connection, attachment: Attachment): void {
    const room = this.room;
    if (room === null || room === undefined) return;
    const lifecycle = room.meta.lifecycle;
    this.send(connection, {
      type: "snapshot",
      stateVersion: room.meta.stateVersion,
      phase: lifecycle,
      game: redactStateFor(attachment.role, room.state),
      roster: this.wireRoster(),
      // The room's static facts travel with every snapshot, so `sync` restores a client
      // completely rather than leaving it with live state and no board to draw it on.
      playerMode: room.setup.settings.teams.playerMode,
      board: boardMaterial(room.spec, room.setup),
      paused: room.meta.pausedAt !== null,
      // A phone that reconnects mid-clue must land on the screen it left, so an open clue
      // ships its (redacted) content with the snapshot rather than waiting for the next one.
      clueContent: this.clueContentForRole(attachment.role),
      // ...and the countdown it left, or a console that reopens on a different laptop
      // mid-answer paints a clue with no clock on it (user-flows C6, hardened in M6).
      timers: runningTimers(room.schedule, room.meta, room.state.phase, Date.now()),
    });
    // Reconnecting INTO an open arming: the returning client gets the arm id at once, so it
    // can ack (which measures the new socket's round trip) and stamp a buzz. Its own elapsed
    // claim will be nonsense - it never saw the original arm - but the claim can only ever
    // make a press look slower, so the server estimate governs and the seat still races.
    if (room.armWindow !== null && this.buzzHoldingOpen(room)) {
      this.send(connection, this.armWindowPayload(room.armWindow));
    }
  }

  // ---- clue content ----------------------------------------------------------------------

  // What the room's CURRENT clue says, cut to one role (room/content.ts owns the redaction
  // table). Null when no clue is open, when the game shipped board material only (the
  // compact spec used by bots/tests), or when the item cannot be resolved.
  private clueContentForRole(role: RoomRole) {
    const room = this.room;
    if (room === null || room === undefined) return null;
    const clue = room.state.clue;
    const resolved =
      clue === null
        ? room.state.final === null
          ? null
          : resolveFinalContent(room.spec)
        : resolveCellContent(room.spec, {
            roundIndex: clue.roundIndex,
            category: clue.category,
            row: clue.row,
          });
    if (resolved === null) return null;
    return clueContentFor(role, resolved, {
      clueTextOnPhones: room.setup.settings.join.clueTextOnPhones,
      // The pack is what turns a media id into something a surface can paint. Without it every
      // picture clue reached the room as words only (owner, 2026-08-19).
      pack: packOf(room.spec),
    });
  }

  // Push the open clue to every connection, each seeing only its role's share. Sent when a
  // clue is presented and when the final round opens - the two moments a screen needs words.
  private broadcastClueContent(): void {
    for (const connection of this.getConnections<Attachment>()) {
      const attachment = connection.state;
      if (attachment === null) continue;
      const content = this.clueContentForRole(attachment.role);
      if (content !== null) this.send(connection, { type: "clue-content", content });
    }
  }

  // ---- engine pipeline ------------------------------------------------------------------

  // Apply engine actions in the order given, persist once, narrate once. Returns accepted
  // events (callers special-case buzz feedback). Rejections: reported to `reporter` unless
  // silent (alarm-fired stale timers are EXPECTED to reject harmlessly).
  //
  // `reporters` is the per-action override the adjudicated buzz batch needs: one arming's
  // presses arrive on many sockets, and every loser must hear "too late" on ITS OWN socket
  // rather than on whichever connection happened to trigger the flush.
  private async applyEngineActions(
    actions: GameAction[],
    options: {
      reporter?: Connection;
      reporters?: (Connection | undefined)[];
      silentRejections?: boolean;
    } = {},
  ): Promise<GameEvent[]> {
    const room = await this.load();
    if (room === null) return [];
    const accepted: GameEvent[] = [];
    for (const [index, action] of actions.entries()) {
      const reporter = options.reporters?.[index] ?? options.reporter;
      const result = transition(room.state, action, room.setup);
      const rejection = result.events.find((event) => event.type === "action-rejected");
      if (rejection !== undefined && rejection.type === "action-rejected") {
        if (options.silentRejections !== true && reporter !== undefined) {
          if (action.type === "buzz") {
            // The engine narrates buzz rejections precisely (too-late, locked-out...);
            // relay that as silent per-phone feedback, never room audio.
            const buzzEvent = result.events.find((event) => event.type === "buzz-rejected");
            this.send(reporter, {
              type: "buzz-rejected",
              reason: buzzEvent?.type === "buzz-rejected" ? buzzEvent.reason : "not-armed",
              lockedUntil: null,
            });
          } else {
            this.sendError(reporter, "action-rejected", rejection.reason);
          }
        }
        continue;
      }
      room.state = result.state;
      accepted.push(...result.events);
      // The engine's timer hints become alarm-book entries; the driver owes the named
      // expiry action when the clock runs out. Stale entries fire as harmless rejections.
      for (const event of result.events) {
        if (event.type === "timer-set") {
          room.schedule.engineTimers[event.kind] = {
            dueAt: event.at + event.durationMs,
            actionType: timerExpiryAction[event.kind],
          };
        }
        if (event.type === "game-started") room.meta.lifecycle = "active";
        if (event.type === "game-over") room.meta.lifecycle = "ended";
      }
    }
    if (accepted.length === 0) return [];
    // Drop book entries the new phase can no longer be waiting on. They used to linger and
    // fire as harmless rejections, which was fine until snapshots started reporting the room's
    // live timers (M6): a phantom countdown on a reconnecting host's console is worse than a
    // wasted alarm, and this removes both.
    for (const kind of Object.keys(room.schedule.engineTimers)) {
      if (!timerLiveInPhase(room.state.phase, kind)) delete room.schedule.engineTimers[kind];
    }
    const armed = accepted.find((event) => event.type === "buzzers-armed");
    if (armed !== undefined && armed.type === "buzzers-armed") this.openArmingWindow(room, armed);
    const lifecycleChanged = accepted.some(
      (event) => event.type === "game-started" || event.type === "game-over",
    );
    room.meta.stateVersion += 1;
    room.meta.lastActivityAt = Date.now();
    this.lastPersistedActivity = room.meta.lastActivityAt;
    await this.persist("state", "meta", "schedule", "armWindow");
    await this.rescheduleAlarm();
    this.broadcastEngineEvents(accepted);
    // A phase change is exactly what a lobby browser reads ("in lobby" vs "playing"), so it
    // is never throttled; ordinary play traffic rides the coalescing window.
    await this.syncRegistry({ force: lifecycleChanged });
    return accepted;
  }

  private broadcastEngineEvents(events: GameEvent[]): void {
    const room = this.room;
    if (room === null || room === undefined) return;
    const version = room.meta.stateVersion;

    // buzz-won gets its own room-level message carrying the resolved ROOM-audible sound:
    // the team's sound in teams mode (owner directive "double confirmation"), the winner's
    // personal sound otherwise. Exactly one per arming - the engine guarantees it.
    for (const event of events) {
      if (event.type !== "buzz-won") continue;
      const team = room.teams[event.entityId];
      const winner = room.roster[event.playerId];
      const payload = {
        type: "buzz-won",
        stateVersion: version,
        playerId: event.playerId,
        entityId: event.entityId,
        teamId: team?.teamId ?? null,
        buzzSoundId: team !== undefined ? team.buzzSoundId : (winner?.identity.buzzSoundId ?? null),
        at: event.at,
      };
      for (const connection of this.getConnections<Attachment>()) {
        if (connection.state !== null) this.send(connection, payload);
      }
    }

    // The arming's id and its holding window, to everyone joined: a phone needs it to stamp
    // its buzz and to ack (which is what measures its round trip), a display needs the window
    // length to size the beat before the winner appears.
    if (room.armWindow !== null && events.some((event) => event.type === "buzzers-armed")) {
      const payload = this.armWindowPayload(room.armWindow);
      for (const connection of this.getConnections<Attachment>()) {
        if (connection.state !== null) this.send(connection, payload);
      }
    }

    // Authored text rides its own channel (the engine never sees content), pushed at the two
    // moments a screen needs words: a clue opening and the final round starting.
    if (
      events.some(
        (event) =>
          event.type === "clue-presented" ||
          event.type === "final-wagers-open" ||
          event.type === "final-writing-open",
      )
    ) {
      this.broadcastClueContent();
    }

    // Everything else flows as the ordered event stream, role-redacted per connection, WITH
    // the state it produced (server-messages.ts explains why the events alone are not enough
    // for a client to hold state). The state redaction is memoized per ROLE: it is identical
    // for every phone in the room, and a 100-player buzz would otherwise redact it 100 times.
    //
    // buzz-rejected is filtered OUT of that stream and delivered privately instead: the wire
    // contract calls it "per-phone silent feedback, never room audio" (protocol room/server-
    // messages.ts), and it was leaking to the whole room for the one case that reaches here -
    // a locked-out player mashing after the arm, which the engine ACCEPTS (it re-triggers the
    // penalty) rather than rejecting. M6 finding: the room heard about every mash and the
    // masher heard nothing.
    const stream = events.filter(
      (event) => event.type !== "buzz-won" && event.type !== "buzz-rejected",
    );
    const stateByRole = new Map<RoomRole, unknown>();
    //
    // One private message per press, whichever way the engine narrated it: an early-buzz
    // carries the lockout deadline the phone draws its penalty ring from, and a bare
    // buzz-rejected (locked out, not the captain) carries the reason alone. A press that
    // produced BOTH - the mash that re-triggers a running penalty - is one press and gets one
    // message, the one with the deadline on it.
    const feedback = new Map<string, { reason: string; lockedUntil: number | null }>();
    for (const event of events) {
      if (event.type === "early-buzz") {
        feedback.set(event.playerId, { reason: "early-lockout", lockedUntil: event.lockedUntil });
      }
    }
    for (const event of events) {
      if (event.type !== "buzz-rejected" || feedback.has(event.playerId)) continue;
      feedback.set(event.playerId, { reason: event.reason, lockedUntil: null });
    }
    for (const connection of this.getConnections<Attachment>()) {
      const attachment = connection.state;
      if (attachment === null) continue;
      const redacted = redactEventsFor(attachment.role, attachment.playerId, stream);
      if (redacted.length > 0) {
        if (!stateByRole.has(attachment.role)) {
          stateByRole.set(attachment.role, redactStateFor(attachment.role, room.state));
        }
        this.send(connection, {
          type: "event",
          stateVersion: version,
          events: redacted,
          game: stateByRole.get(attachment.role) ?? null,
        });
      }
      const mine = attachment.playerId === null ? undefined : feedback.get(attachment.playerId);
      if (mine !== undefined) this.send(connection, { type: "buzz-rejected", ...mine });
    }
  }

  // ---- buzz latency compensation ---------------------------------------------------------
  //
  // The M6 headline (docs/decisions/2026-08-17-buzz-latency-compensation.md). Three moves:
  // arming opens a window and tells every client its id; each client acks immediately, which
  // measures its round trip over exactly the path its buzz will take; buzzes are held for a
  // few milliseconds and fed to the engine ranked by credited reaction time. The arithmetic
  // and its threat model live in @jeopardy/protocol's room/buzz-fairness.ts; this class owns
  // only the clock, the sockets and the storage.

  /** 0 = compensation is off for this room, and buzzes go to the engine as they arrive. */
  private compensationWindowMs(room: LoadedRoom): number {
    const buzzing = room.setup.settings.buzzing;
    return buzzing.latencyCompensation ? buzzing.compensationWindowMs : 0;
  }

  // Open the window for an arming. Called from applyEngineActions the moment the engine says
  // buzzers-armed, so armedAt is within a millisecond of the broadcast that follows it - which
  // is what every client's t0 and every round-trip sample is measured against.
  private openArmingWindow(
    room: LoadedRoom,
    armed: Extract<GameEvent, { type: "buzzers-armed" }>,
  ): void {
    room.meta.armCounter = (room.meta.armCounter ?? 0) + 1;
    room.schedule.buzzAdjudicateAt = null;
    room.armWindow = openArmWindow({
      armId: room.meta.armCounter,
      armedAt: Date.now(),
      rebound: armed.rebound,
      windowMs: this.compensationWindowMs(room),
    });
  }

  private armWindowPayload(window: ArmWindow): Record<string, unknown> {
    return {
      type: "arm-window",
      arm: {
        armId: window.armId,
        at: window.armedAt,
        compensationMs: window.windowMs,
        rebound: window.rebound,
      },
    };
  }

  /** True while this arming's buzzes are being HELD rather than fed straight to the engine. */
  private buzzHoldingOpen(room: LoadedRoom): boolean {
    if (room.armWindow === null || room.armWindow.windowMs <= 0) return false;
    return room.state.phase === "armed" || room.state.phase === "tiebreaker-armed";
  }

  // A client answering the arm broadcast: arrival minus broadcast IS this connection's round
  // trip, measured end to end with the server's own clock. Deliberately NOT persisted on its
  // own - the sample rides the next buzz write (a 100-phone room would otherwise pay 100
  // storage writes for a number that is worthless the moment the arming ends). If eviction
  // beats the first buzz, the sample is lost and the room simply compensates nobody, which is
  // the conservative direction.
  private async handleArmAck(
    connection: Connection<Attachment>,
    armId: number,
    receivedAt: number,
  ): Promise<void> {
    const room = await this.load();
    if (room === null || room.armWindow === null) return;
    if (room.armWindow.armId !== armId) return; // an ack for a previous arming proves nothing
    recordRoundTrip(room.armWindow, connection.id, receivedAt);
  }

  // Hold this buzz instead of adjudicating it now. The phone already gave its own player
  // optimistic feedback (user-flows A4), so the only thing waiting buys is the chance to put
  // the presses in the right order - and the deadline shrinks as soon as somebody is credibly
  // fast (room/arm-window.ts).
  private async holdBuzz(
    connection: Connection<Attachment>,
    room: LoadedRoom,
    playerId: string,
    receivedAt: number,
    timing: ActionTiming | undefined,
  ): Promise<void> {
    const window = room.armWindow;
    if (window === null) return;
    queueBuzz(window, {
      playerId,
      connectionId: connection.id,
      arrivalAt: receivedAt,
      // A claim stamped with a DIFFERENT arming is not a claim about this race (the room
      // re-armed while the press was in flight); it is dropped, not trusted and not punished.
      claimedElapsedMs:
        timing !== undefined && timing.armId === window.armId ? timing.elapsedMs : null,
      sequence: window.pending.length,
    });
    room.schedule.buzzAdjudicateAt = window.adjudicateAt;
    await this.persist("armWindow", "schedule");
    await this.rescheduleAlarm();
  }

  // Close the window and hand the engine the ordered list. Called when the deadline fires,
  // and BEFORE any other action reaches the engine - a host's "no takers" or an expiring
  // buzz-window timer must never resolve a clue whose presses are still in the holding pen.
  private async flushArmWindow(): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const window = room.armWindow;
    if (window === null || window.pending.length === 0) return;
    const ordered = adjudicateArmWindow(window);
    window.pending = [];
    window.adjudicateAt = null;
    room.schedule.buzzAdjudicateAt = null;
    await this.persist("armWindow", "schedule");

    const byConnectionId = new Map<string, Connection<Attachment>>();
    for (const connection of this.getConnections<Attachment>()) {
      byConnectionId.set(connection.id, connection);
    }
    await this.applyEngineActions(
      ordered.map((buzz) => ({ type: "buzz" as const, at: buzz.at, playerId: buzz.playerId })),
      { reporters: ordered.map((buzz) => byConnectionId.get(buzz.connectionId)) },
    );
  }

  // ---- initialize RPC -------------------------------------------------------------------

  // Non-WebSocket requests reach the DO only through the cross-script binding (the realtime
  // Worker's public router forwards nothing but /room/<CODE>/ws upgrades), so /initialize
  // is unreachable from the open internet by construction.
  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/initialize") {
      const body = createRoomRequestSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return Response.json({ error: "bad-request" }, { status: 400 });
      const existing = await this.load();
      if (existing !== null) return Response.json({ error: "already-active" }, { status: 409 });

      const now = Date.now();
      const seed = body.data.seed ?? generateSecretToken();
      const setup = setupFromSpec(body.data.game, seed);
      const meta: RoomMeta = {
        code: this.name,
        hostToken: generateSecretToken(),
        // Opening positions, not commitments: every one of these is editable while the room
        // runs (handleUpdateRoomSettings), which is why they live on meta rather than setup.
        settings: {
          listing: body.data.listing,
          maxPlayers: body.data.maxPlayers,
          maxSpectators: body.data.maxSpectators,
          spectatorsAllowed: body.data.spectatorsAllowed,
          hideJoinCode: body.data.hideJoinCode,
        },
        title: body.data.title ?? "",
        hostLabel: body.data.hostLabel ?? "",
        createdAt: now,
        lastActivityAt: now,
        stateVersion: 0,
        lifecycle: "lobby",
        pausedAt: null,
        playerCounter: 0,
        teamCounter: 0,
        armCounter: 0,
      };
      this.room = {
        meta,
        setup,
        state: createInitialState(setup),
        spec: body.data.game,
        roster: {},
        teams: {},
        renames: {},
        schedule: structuredClone(emptySchedule),
        armWindow: null,
      };
      this.lastPersistedActivity = now;
      await this.persist(
        "meta",
        "setup",
        "state",
        "spec",
        "roster",
        "teams",
        "renames",
        "schedule",
        "armWindow",
      );
      await this.rescheduleAlarm();
      return Response.json(
        {
          hostToken: meta.hostToken,
          expiresAt: now + limits.room.idleExpiryMs,
          // The settings the server actually recorded, so the create route echoes truth
          // rather than re-deriving it from the body it happened to send.
          settings: roomSettingsPayload(meta),
        },
        { status: 201 },
      );
    }
    // Host-authenticated ops surface (owner request 2026-08-14). Both endpoints ride the
    // cross-script binding from the web Worker's /api/rooms/<CODE> route, which forwards the
    // caller's host token in this header - the DO verifies it here rather than trusting the
    // web Worker, so "internal traffic" is never itself an authorization.
    if (request.method === "GET" && url.pathname === "/diagnostics") {
      const room = await this.load();
      if (room === null) return Response.json({ error: "no-such-room" }, { status: 404 });
      if (!this.hostTokenMatches(request, room)) {
        return Response.json({ error: "bad-host-token" }, { status: 403 });
      }
      return Response.json(
        buildRoomDiagnostics({
          meta: room.meta,
          roster: room.roster,
          teams: room.teams,
          schedule: room.schedule,
          connections: this.connectionCensus(),
          bundle: {
            meta: room.meta,
            setup: room.setup,
            state: room.state,
            spec: room.spec,
            roster: room.roster,
            teams: room.teams,
            renames: room.renames,
            schedule: room.schedule,
            armWindow: room.armWindow,
          },
        }),
      );
    }
    if (request.method === "POST" && url.pathname === "/close") {
      // The host closing a room they created from a surface that holds no socket (the
      // harness's per-room Delete, later the console's "end game"). Same semantics as the
      // close-room client message: everyone gets the polite screen, the lobby delists, and
      // the storage wipe waits for the ordinary expiry alarm so an accidental close is still
      // recoverable state and the code stays spent until it ages out.
      const room = await this.load();
      if (room === null) return Response.json({ error: "no-such-room" }, { status: 404 });
      if (!this.hostTokenMatches(request, room)) {
        return Response.json({ error: "bad-host-token" }, { status: 403 });
      }
      await this.closeRoom(room);
      return Response.json({ closed: true, code: room.meta.code });
    }
    if (request.method === "POST" && url.pathname === "/settings") {
      // The host changing the room from a surface that holds no socket (the harness's Room
      // settings panel over PATCH /api/rooms/<CODE>, later the console when it is offline).
      // Identical body to the update-room-settings client message, applied through the same
      // function, so the two doors cannot drift into meaning different things.
      const room = await this.load();
      if (room === null) return Response.json({ error: "no-such-room" }, { status: 404 });
      if (!this.hostTokenMatches(request, room)) {
        return Response.json({ error: "bad-host-token" }, { status: 403 });
      }
      const body = updateRoomSettingsRequestSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!body.success) return Response.json({ error: "bad-request" }, { status: 400 });
      const applied = await this.applyRoomSettings(room, body.data.settings);
      if (!applied.ok) return Response.json({ error: applied.reason }, { status: 409 });
      return Response.json({ code: room.meta.code, settings: roomSettingsPayload(room.meta) });
    }
    if (request.method === "GET" && url.pathname === "/registry-snapshot") {
      // Ops/debug + the registry reconcile story: what this DO believes about itself right
      // now. Reachable only through the cross-script binding (the public router forwards
      // nothing but /room/<CODE>/ws upgrades), and it carries no secrets.
      const room = await this.load();
      if (room === null) return Response.json({ error: "no-such-room" }, { status: 404 });
      return Response.json(this.registrySnapshot(room));
    }
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  // Constant-time-ish comparison is not needed here (the token is 128 bits of randomness and
  // an attacker cannot reach this endpoint without already being inside the binding), but a
  // missing header must never match a room, so the empty case is rejected explicitly.
  private hostTokenMatches(request: Request, room: LoadedRoom): boolean {
    const offered = request.headers.get(hostTokenHeader);
    return offered !== null && offered !== "" && offered === room.meta.hostToken;
  }

  // Who is attached right now, by the role they joined as. `unjoined` is a socket that
  // upgraded and has sent neither join nor resume - the state a refused or still-typing
  // client sits in, and the one worth seeing when a phone "connects" but nothing happens.
  private connectionCensus(): ConnectionCensus {
    const census: ConnectionCensus = {
      total: 0,
      host: 0,
      player: 0,
      display: 0,
      spectator: 0,
      unjoined: 0,
    };
    for (const connection of this.getConnections<Attachment>()) {
      census.total += 1;
      const role = connection.state?.role;
      if (role === undefined || role === null) census.unjoined += 1;
      else census[role] += 1;
    }
    return census;
  }

  // ---- connection lifecycle -------------------------------------------------------------

  override async onConnect(
    connection: Connection<Attachment>,
    _ctx: ConnectionContext,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) {
      // Creation is explicit; a code without an initialized room answers no-such-room and
      // the briefly-woken DO evicts holding nothing (decision doc, room lifecycle).
      this.refuse(connection, "no-such-room", roomCloseCodes.noSuchRoom);
      return;
    }
    await this.touchActivity();
    // Somebody is here again: cancel the empty-room countdown. Deliberately on CONNECT rather
    // than on join - a phone that reconnected and is still choosing a nickname is not an
    // abandoned room, and a whole venue coming back from a Wi-Fi outage must keep its game.
    if (room.schedule.emptyRoomAt !== null) {
      room.schedule.emptyRoomAt = null;
      await this.persist("schedule");
      await this.rescheduleAlarm();
    }
    // No server hello: the client's first move is join or resume; welcome answers it.
  }

  override async onMessage(connection: Connection<Attachment>, message: WSMessage): Promise<void> {
    // Stamped FIRST, before parsing, rate limiting, or any await: this is the arrival time a
    // buzz is adjudicated on and the arm-ack that measures a round trip, and a few
    // milliseconds of our own bookkeeping would be indistinguishable from a few milliseconds
    // of somebody's Wi-Fi.
    const receivedAt = Date.now();
    if (typeof message !== "string") {
      this.sendError(connection, "malformed", "binary frames are not supported");
      return;
    }
    if (message.length > limits.wire.clientMessageMaxBytes) {
      this.sendError(connection, "malformed", "message exceeds the size limit");
      return;
    }
    // The message-rate cap protects the room from misbehaving phones; the HOST is exempt -
    // it authenticated with the creation token and legitimately bursts past 10/s (keyboard
    // judging, undo runs, the sound check arming every team in sequence).
    if (connection.state?.role !== "host" && !this.admitMessage(connection.id)) {
      this.sendError(connection, "rate-limited", "slow down");
      return;
    }
    const room = await this.load();
    if (room === null) {
      this.refuse(connection, "no-such-room", roomCloseCodes.noSuchRoom);
      return;
    }
    const parsed = parseRoomClientMessage(message);
    if (!parsed.ok) {
      this.sendError(connection, parsed.reason, parsed.detail);
      return;
    }
    await this.touchActivity();

    const incoming = parsed.message;
    const attachment = connection.state;
    if (attachment === null) {
      if (incoming.type === "join") return this.handleJoin(connection, incoming);
      if (incoming.type === "resume") return this.handleResume(connection, incoming);
      this.sendError(connection, "not-joined", "join or resume first");
      return;
    }
    switch (incoming.type) {
      case "join":
        // A joined connection re-joining is a client bug, except the team-retry path
        // (player refused team-locked/unknown-team has no attachment yet, so it lands above).
        this.sendError(connection, "rejected", "already joined");
        return;
      case "resume":
        this.sendError(connection, "rejected", "already joined");
        return;
      case "action":
        return this.handleAction(connection, attachment, incoming.action, {
          receivedAt,
          timing: incoming.timing,
        });
      case "arm-ack":
        return this.handleArmAck(connection, incoming.armId, receivedAt);
      case "sync":
        this.sendSnapshot(connection, attachment);
        return;
      case "leave":
        return this.handleLeave(connection, attachment);
      case "identity-update":
        return this.handleIdentityUpdate(connection, attachment, incoming);
      case "rename-player":
        return this.handleRenamePlayer(connection, attachment, incoming);
      case "kick-player":
        return this.handleKickPlayer(connection, attachment, incoming);
      case "team-create":
        return this.handleTeamCreate(connection, attachment, incoming);
      case "team-join":
        return this.handleTeamJoin(connection, attachment, incoming);
      case "team-update":
        return this.handleTeamUpdate(connection, attachment, incoming);
      case "team-kick":
        return this.handleTeamKick(connection, attachment, incoming);
      case "team-handoff":
        return this.handleTeamHandoff(connection, attachment, incoming);
      case "set-pause":
        return this.handleSetPause(connection, attachment, incoming.paused);
      case "expire-timer":
        return this.handleExpireTimer(connection, attachment);
      case "update-room-settings":
        return this.handleUpdateRoomSettings(connection, attachment, incoming);
      case "update-game-rules":
        return this.handleUpdateGameRules(connection, attachment, incoming);
      case "close-room":
        return this.handleCloseRoom(connection, attachment);
      default:
    }
  }

  override async onClose(connection: Connection<Attachment>): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    // Runs for EVERY close, whatever the role and whether or not the socket ever joined: the
    // empty-room grace is about the room having nobody in it, and a host console closing its
    // tab empties a room exactly as thoroughly as the last phone leaving.
    await this.noteDeparture(connection.id);
    const attachment = connection.state;
    if (attachment === null || attachment.playerId === null) return;
    const entry = room.roster[attachment.playerId];
    if (entry === undefined) return;
    if (this.seatHasOtherConnections(attachment.playerId, connection.id)) return;
    entry.connected = false;
    // Leader-disconnect succession: after the grace, leadership passes to the
    // longest-tenured connected member (user-flows "Teams & leadership"). Scheduled, not
    // immediate, so a phone-sleep blip keeps the crown.
    for (const team of Object.values(room.teams)) {
      if (team.leaderPlayerId === attachment.playerId) {
        room.schedule.successions[team.teamId] = {
          dueAt: Date.now() + limits.team.leaderDisconnectGraceMs,
          leaderPlayerId: attachment.playerId,
        };
      }
    }
    await this.persist("roster", "schedule");
    await this.rescheduleAlarm();
    this.broadcastRoster();
  }

  // A connection went away: if it was the last one, start the empty-room countdown. The room
  // is NOT closed here - a grace window is the whole point, because "everyone left" and "the
  // venue's Wi-Fi hiccuped" look identical for the first few minutes (docs/decisions/
  // 2026-08-14-room-controls-and-staging.md).
  private async noteDeparture(closingConnectionId: string): Promise<void> {
    const room = this.room;
    if (room === null || room === undefined) return;
    // An already-ended room needs no countdown: it is over, and the idle alarm owns the wipe.
    if (room.meta.lifecycle === "ended" || room.schedule.emptyRoomAt !== null) return;
    for (const other of this.getConnections<Attachment>()) {
      // The closing socket may still be enumerated during its own close event, so it is
      // excluded by id rather than trusted to have disappeared already.
      if (other.id !== closingConnectionId) return;
    }
    room.schedule.emptyRoomAt = Date.now() + limits.room.emptyRoomGraceMs;
    await this.persist("schedule");
    await this.rescheduleAlarm();
  }

  private seatHasOtherConnections(playerId: string, exceptConnectionId: string): boolean {
    for (const connection of this.getConnections<Attachment>()) {
      if (connection.id !== exceptConnectionId && connection.state?.playerId === playerId) {
        return true;
      }
    }
    return false;
  }

  private admitMessage(connectionId: string): boolean {
    const now = Date.now();
    const stamps = (this.messageStamps.get(connectionId) ?? []).filter((at) => now - at < 1000);
    if (stamps.length >= limits.wire.clientMessagesPerSecondMax) return false;
    stamps.push(now);
    this.messageStamps.set(connectionId, stamps);
    return true;
  }

  // ---- join / resume / leave ------------------------------------------------------------

  private async handleJoin(
    connection: Connection<Attachment>,
    message: Extract<RoomClientMessage, { type: "join" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;

    if (message.role === "host") {
      if (message.hostToken !== room.meta.hostToken) {
        this.refuse(connection, "bad-host-token", roomCloseCodes.badToken);
        return;
      }
      connection.setState({ role: "host", playerId: null });
      this.send(connection, {
        type: "welcome",
        roomCode: room.meta.code,
        role: "host",
        playerId: null,
        sessionToken: null,
      });
      this.sendSnapshot(connection, { role: "host", playerId: null });
      this.sendRoomSettings(connection);
      this.sendGameRules(connection);
      return;
    }

    if (message.role === "display" || message.role === "spectator") {
      // The SPECTATOR budget, independent of the player one (docs/decisions/2026-08-14-room-
      // controls-and-staging.md): an audience must never be able to fill a room the players
      // came to play in, and each refusal says which door it was. Displays are exempt - the
      // projector is the host's own screen, not a member of the audience.
      if (message.role === "spectator") {
        if (!room.meta.settings.spectatorsAllowed) {
          this.refuse(connection, "spectators-not-allowed", roomCloseCodes.joinRefused);
          return;
        }
        if (this.spectatorCount() >= room.meta.settings.maxSpectators) {
          this.refuse(connection, "spectators-full", roomCloseCodes.roomFull);
          return;
        }
      }
      connection.setState({ role: message.role, playerId: null });
      this.send(connection, {
        type: "welcome",
        roomCode: room.meta.code,
        role: message.role,
        playerId: null,
        sessionToken: null,
      });
      this.sendSnapshot(connection, { role: message.role, playerId: null });
      this.sendRoomSettings(connection);
      this.sendGameRules(connection);
      return;
    }

    // role === "player"
    if (message.nickname === undefined) {
      this.sendError(connection, "rejected", "players join with a nickname");
      return;
    }
    // The host's own cap first (it is the one they set and the one the lobby advertises), then
    // the operational hard cap nobody can lift. Both answer room-full: a phone turned away
    // does not care which ceiling it hit, only that this room has no seat for it.
    if (
      Object.keys(room.roster).length >=
      Math.min(room.meta.settings.maxPlayers, limits.room.playerHardCap)
    ) {
      this.refuse(connection, "room-full", roomCloseCodes.roomFull);
      return;
    }
    // Offered vs required, the two questions a boolean used to blur (@jeopardy/protocol
    // settings/groups/teams.ts). A team is only nonsense in individuals mode; in mixed it is
    // one of two legitimate ways to be here.
    const teamsOffered = teamsAreOffered(room.setup.settings.teams.playerMode);
    const teamsRequired = teamsAreRequired(room.setup.settings.teams.playerMode);
    if (!teamsOffered && message.team !== undefined) {
      this.sendError(connection, "rejected", "this room plays as individuals");
      return;
    }

    // Resolve team intent BEFORE seating so a team refusal leaves nothing behind and the
    // phone can retry on the same socket (server-messages close-code note).
    let teamId: string | null = null;
    let createdTeam: TeamDoc | null = null;
    if (teamsOffered && message.team !== undefined) {
      if (message.team.kind === "join") {
        const team = room.teams[message.team.teamId];
        if (team === undefined) {
          this.refuse(connection, "unknown-team");
          return;
        }
        if (team.locked) {
          this.refuse(connection, "team-locked");
          return;
        }
        teamId = team.teamId;
      } else {
        if (Object.keys(room.teams).length >= limits.team.teamMaxCount) {
          this.sendError(connection, "rejected", "team limit reached");
          return;
        }
        room.meta.teamCounter += 1;
        createdTeam = {
          teamId: `t-${String(room.meta.teamCounter)}`,
          name: message.team.name,
          colorId: null,
          buzzSoundId: null,
          leaderPlayerId: null, // set after the seat id is minted below
          locked: false,
        };
        teamId = createdTeam.teamId;
      }
    }

    room.meta.playerCounter += 1;
    const playerId = `p-${String(room.meta.playerCounter)}`;
    const entry: StoredRosterEntry = {
      playerId,
      identity: {
        nickname: this.dedupeNickname(message.nickname),
        avatarId: message.avatarId ?? null,
        accentId: message.accentId ?? null,
        buzzSoundId: message.buzzSoundId ?? null,
        // Absent stays ABSENT rather than becoming null: "this client never sent a tone" and
        // "this player chose the pack's own colors" are different facts, and nothing here may
        // turn the first into the second (packages/protocol/src/room/identity.ts).
        ...(message.skinToneId !== undefined && { skinToneId: message.skinToneId }),
      },
      teamId,
      connected: true,
      joinedAt: Date.now(),
      sessionToken: generateSecretToken(),
    };
    if (createdTeam !== null) createdTeam.leaderPlayerId = playerId;

    // Mid-game joins feed the engine NOW (late-join policy #43 decides); lobby joins wait
    // for start-game, so the lobby can rearrange teams without engine actions.
    if (room.meta.lifecycle === "active") {
      if (teamsRequired && teamId === null) {
        // Same policy as start-game: a straggler joins as a solo team rather than being
        // bounced off a running game. REQUIRED, not offered: in mixed mode arriving without a
        // team is the choice to play solo, and manufacturing a team of one would overrule it.
        room.meta.teamCounter += 1;
        createdTeam = {
          teamId: `t-${String(room.meta.teamCounter)}`,
          name: message.nickname.slice(0, limits.team.teamNameMaxLength),
          colorId: null,
          buzzSoundId: null,
          leaderPlayerId: playerId,
          locked: false,
        };
        teamId = createdTeam.teamId;
        entry.teamId = teamId;
      }
      const joinAction: GameAction = {
        type: "player-join",
        at: Date.now(),
        playerId,
        name: entry.identity.nickname,
        ...(teamId !== null && { teamId }),
        ...(createdTeam !== null && { teamName: createdTeam.name }),
      };
      const result = transition(room.state, joinAction, room.setup);
      const rejection = result.events.find((event) => event.type === "action-rejected");
      if (rejection !== undefined && rejection.type === "action-rejected") {
        if (rejection.reason === "late-join-disabled") {
          this.refuse(connection, "late-join-disabled", roomCloseCodes.joinRefused);
        } else {
          this.sendError(connection, "rejected", rejection.reason);
        }
        return;
      }
      room.state = result.state;
      room.meta.stateVersion += 1;
      room.roster[playerId] = entry;
      if (createdTeam !== null) room.teams[createdTeam.teamId] = createdTeam;
      await this.persist("state", "meta", "roster", "teams");
      connection.setState({ role: "player", playerId });
      this.welcomePlayer(connection, room.meta.code, playerId, entry.sessionToken);
      this.broadcastEngineEvents(result.events);
      this.broadcastRoster();
      await this.syncRegistry();
      return;
    }

    room.roster[playerId] = entry;
    if (createdTeam !== null) room.teams[createdTeam.teamId] = createdTeam;
    await this.persist("meta", "roster", "teams");
    connection.setState({ role: "player", playerId });
    this.welcomePlayer(connection, room.meta.code, playerId, entry.sessionToken);
    this.broadcastRoster();
    // The lobby's "7/100" is the one number a browser judges a room by, so a roster change
    // reports itself (coalesced - see syncRegistry).
    await this.syncRegistry();
  }

  private welcomePlayer(
    connection: Connection<Attachment>,
    roomCode: string,
    playerId: string,
    sessionToken: string,
  ): void {
    this.send(connection, {
      type: "welcome",
      roomCode,
      role: "player",
      playerId,
      sessionToken,
    });
    this.sendSnapshot(connection, { role: "player", playerId });
    this.sendRoomSettings(connection);
    this.sendGameRules(connection);
  }

  // Every accepted join ends with the room's settings, so no surface has to ask: a phone knows
  // immediately whether to show the code, and a display that joined mid-stream paints the
  // right screen on its first frame rather than after the next host edit.
  private sendRoomSettings(connection: Connection<Attachment>): void {
    const room = this.room;
    if (room === null || room === undefined) return;
    this.send(connection, {
      type: "room-settings",
      settings: roomSettingsPayload(room.meta),
      at: Date.now(),
    });
  }

  private async handleResume(
    connection: Connection<Attachment>,
    message: Extract<RoomClientMessage, { type: "resume" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const entry = Object.values(room.roster).find(
      (candidate) => candidate.sessionToken === message.sessionToken,
    );
    if (entry === undefined) {
      this.refuse(connection, "bad-session-token", roomCloseCodes.badToken);
      return;
    }
    entry.connected = true;
    // A returning leader inside the grace window keeps the crown: cancel the succession.
    for (const [teamId, succession] of Object.entries(room.schedule.successions)) {
      if (succession.leaderPlayerId === entry.playerId) {
        delete room.schedule.successions[teamId];
      }
    }
    await this.persist("roster", "schedule");
    connection.setState({ role: "player", playerId: entry.playerId });
    this.welcomePlayer(connection, room.meta.code, entry.playerId, entry.sessionToken);
    this.broadcastRoster();
  }

  private async handleLeave(
    connection: Connection<Attachment>,
    attachment: Attachment,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.playerId !== null) {
      await this.removePlayer(attachment.playerId, { feedEngine: true });
    }
    connection.close(1000, "left");
  }

  // Shared removal path for leave and host kicks: seat presence in the engine flips off
  // (scores survive - removing an entity would corrupt rotation), roster entry and resume
  // token disappear, team leadership passes immediately if the leaver held it.
  private async removePlayer(playerId: string, options: { feedEngine: boolean }): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const entry = room.roster[playerId];
    if (entry === undefined) return;
    if (options.feedEngine && room.state.players[playerId]?.connected === true) {
      await this.applyEngineActions([{ type: "player-leave", at: Date.now(), playerId }], {
        silentRejections: true,
      });
    }
    delete room.roster[playerId];
    delete room.renames[playerId];
    for (const team of Object.values(room.teams)) {
      if (team.leaderPlayerId === playerId) {
        team.leaderPlayerId = this.pickSuccessor(team.teamId, playerId);
        delete room.schedule.successions[team.teamId];
      }
    }
    await this.persist("roster", "renames", "teams", "schedule");
    this.broadcastRoster();
    await this.syncRegistry();
  }

  /** Longest-tenured CONNECTED member of the team, excluding the departing leader. */
  private pickSuccessor(teamId: string, excludingPlayerId: string): string | null {
    const room = this.room;
    if (room === null || room === undefined) return null;
    const members = Object.values(room.roster)
      .filter(
        (entry) =>
          entry.teamId === teamId && entry.playerId !== excludingPlayerId && entry.connected,
      )
      .toSorted((a, b) => a.joinedAt - b.joinedAt);
    return members[0]?.playerId ?? null;
  }

  // ---- relayed engine actions -----------------------------------------------------------

  private async handleAction(
    connection: Connection<Attachment>,
    attachment: Attachment,
    raw: Record<string, unknown>,
    context: { receivedAt: number; timing: ActionTiming | undefined },
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host" && attachment.role !== "player") {
      this.sendError(connection, "unauthorized", "displays and spectators observe only");
      return;
    }
    const playerId = attachment.playerId;
    const entityId = playerId === null ? null : (room.roster[playerId]?.teamId ?? playerId);
    const stamped = stampRelayedAction(raw, {
      role: attachment.role,
      playerId,
      entityId,
      at: context.receivedAt,
      state: room.state,
    });
    if (!stamped.ok) {
      this.sendError(
        connection,
        stamped.reason === "unauthorized" ? "unauthorized" : "malformed",
        stamped.detail,
      );
      return;
    }

    // start-game seats the roster first: the lobby's team arrangement becomes engine truth
    // in one arrival-ordered batch, then the game starts. Retry-safe (already-seated players
    // are skipped).
    //
    // Unteamed players in a teams-mode room are seated as SOLO TEAMS OF ONE (policy agreed
    // with the M4 surfaces 2026-08-14, replacing the earlier refusal). Refusing to start was
    // the wrong instinct: it hands the host a blocking error at the worst possible moment -
    // the room is full, the night has started, and one person did not tap a card. A solo team
    // is a correct, undoable outcome, and the host can still merge or rename afterwards.
    // A buzz during an open arming is HELD, not adjudicated (see the compensation section):
    // the engine still gets one ordered list, it just gets it a few milliseconds later and in
    // the order the thumbs moved rather than the order the packets landed.
    if (stamped.action.type === "buzz" && playerId !== null && this.buzzHoldingOpen(room)) {
      await this.holdBuzz(connection, room, playerId, context.receivedAt, context.timing);
      return;
    }
    // Anything else resolves the held presses first. A host's "no takers", a judge verdict, an
    // undo - none of them may reach the engine ahead of a buzz that was pressed before them.
    await this.flushArmWindow();

    if (stamped.action.type === "start-game") {
      // Only when teams are REQUIRED. Mixed mode's whole point is that the people who did not
      // join a team meant it, and seating them as teams of one would put a fake team on the
      // scoreboard for every soloist in the room.
      if (
        teamsAreRequired(room.setup.settings.teams.playerMode) &&
        (await this.seatStragglersAsSoloTeams())
      ) {
        this.broadcastRoster();
      }
      const seatActions: GameAction[] = Object.values(room.roster)
        .toSorted((a, b) => a.joinedAt - b.joinedAt)
        .filter((entry) => room.state.players[entry.playerId] === undefined)
        .map((entry) => {
          const seat: Extract<GameAction, { type: "player-join" }> = {
            type: "player-join",
            at: Date.now(),
            playerId: entry.playerId,
            name: entry.identity.nickname,
          };
          if (entry.teamId !== null) {
            seat.teamId = entry.teamId;
            seat.teamName = room.teams[entry.teamId]?.name;
          }
          return seat;
        });
      await this.applyEngineActions([...seatActions, stamped.action], { reporter: connection });
      return;
    }

    await this.applyEngineActions([stamped.action], { reporter: connection });
  }

  // Give every teamless player their own team, named after them - the teams-mode fallback
  // used at start-game and on a teams-mode late join. Broadcasts nothing itself: both callers
  // follow with a roster broadcast or an engine batch that carries the change.
  private async seatStragglersAsSoloTeams(): Promise<boolean> {
    const room = this.room;
    if (room === null || room === undefined) return false;
    let created = false;
    for (const entry of Object.values(room.roster).toSorted((a, b) => a.joinedAt - b.joinedAt)) {
      if (entry.teamId !== null) continue;
      if (Object.keys(room.teams).length >= limits.team.teamMaxCount) break;
      room.meta.teamCounter += 1;
      const team: TeamDoc = {
        teamId: `t-${String(room.meta.teamCounter)}`,
        name: entry.identity.nickname.slice(0, limits.team.teamNameMaxLength),
        colorId: null,
        buzzSoundId: null,
        leaderPlayerId: entry.playerId,
        locked: false,
      };
      room.teams[team.teamId] = team;
      entry.teamId = team.teamId;
      created = true;
    }
    if (created) await this.persist("meta", "roster", "teams");
    return created;
  }

  // ---- identity + roster administration ---------------------------------------------------

  // Rename rate limiting (shared by player nicknames and team names): burst per sliding
  // window from limits.player; the log key is the renamed thing's id.
  private renameAdmitted(key: string): boolean {
    const room = this.room;
    if (room === null || room === undefined) return false;
    const now = Date.now();
    const stamps = (room.renames[key] ?? []).filter(
      (at) => now - at < limits.player.renameWindowMs,
    );
    if (stamps.length >= limits.player.renameBurstMax) return false;
    stamps.push(now);
    room.renames[key] = stamps;
    return true;
  }

  private dedupeNickname(nickname: string): string {
    const room = this.room;
    if (room === null || room === undefined) return nickname;
    const taken = new Set(
      Object.values(room.roster).map((entry) => entry.identity.nickname.toLowerCase()),
    );
    if (!taken.has(nickname.toLowerCase())) return nickname;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${nickname.slice(0, limits.player.nicknameMaxLength - 3)} ${String(suffix)}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private async handleIdentityUpdate(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "identity-update" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const playerId = attachment.playerId;
    const entry = playerId === null ? undefined : room.roster[playerId];
    if (entry === undefined) {
      this.sendError(connection, "unauthorized", "only players have identities to edit");
      return;
    }
    if (identityEditsLocked(room.meta.lifecycle === "active" ? room.state : null)) {
      this.sendError(connection, "identity-locked", "wait for the clue to resolve");
      return;
    }
    if (message.nickname !== undefined && message.nickname !== entry.identity.nickname) {
      if (!this.renameAdmitted(entry.playerId)) {
        this.sendError(connection, "rate-limited", "too many renames; wait a minute");
        return;
      }
      entry.identity.nickname = this.dedupeNickname(message.nickname);
    }
    if (message.avatarId !== undefined) entry.identity.avatarId = message.avatarId;
    if (message.accentId !== undefined) entry.identity.accentId = message.accentId;
    if (message.buzzSoundId !== undefined) entry.identity.buzzSoundId = message.buzzSoundId;
    // The tone was accepted by the schema and dropped on the floor here until the 2026-08-17
    // reconcile - a phone could pick one, see it locally, and have the room forget it.
    if (message.skinToneId !== undefined) entry.identity.skinToneId = message.skinToneId;
    await this.persist("roster", "renames");
    this.broadcastRoster();
  }

  private async handleRenamePlayer(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "rename-player" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host") {
      this.sendError(connection, "unauthorized", "rename-player is host-only");
      return;
    }
    const entry = room.roster[message.playerId];
    if (entry === undefined) {
      this.sendError(connection, "unknown-player");
      return;
    }
    // Host supremacy: no rate limit, no armed-window lock (the host knows what is on screen).
    entry.identity.nickname = this.dedupeNickname(message.nickname);
    await this.persist("roster");
    this.broadcastRoster();
  }

  private async handleKickPlayer(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "kick-player" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host") {
      this.sendError(connection, "unauthorized", "kick-player is host-only");
      return;
    }
    if (room.roster[message.playerId] === undefined) {
      this.sendError(connection, "unknown-player");
      return;
    }
    for (const other of this.getConnections<Attachment>()) {
      if (other.state?.playerId === message.playerId) {
        // Its own reason, not host-closed: the kicked phone shows "the host removed you",
        // while everyone else's room continues (user-flows A5, the polite screen).
        this.send(other, { type: "room-closed", reason: "kicked" });
        other.close(roomCloseCodes.roomClosed, "kicked by host");
      }
    }
    await this.removePlayer(message.playerId, { feedEngine: true });
  }

  // ---- team tier --------------------------------------------------------------------------

  // Team membership is lobby-fluid and game-frozen: after start-game the engine's seats are
  // truth and the roster tier only carries presentation, so membership edits (create/join/
  // kick) reject mid-game. Full mid-game team lifecycle ships with team mode in M5.
  private teamEditsAllowed(): boolean {
    return this.room !== null && this.room !== undefined && this.room.meta.lifecycle === "lobby";
  }

  private async handleTeamCreate(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "team-create" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const playerId = attachment.playerId;
    const entry = playerId === null ? undefined : room.roster[playerId];
    if (entry === undefined) {
      this.sendError(connection, "unauthorized", "only players create teams");
      return;
    }
    if (!teamsAreOffered(room.setup.settings.teams.playerMode)) {
      this.sendError(connection, "rejected", "this room plays as individuals");
      return;
    }
    if (!this.teamEditsAllowed()) {
      this.sendError(connection, "rejected", "teams are locked once the game starts");
      return;
    }
    if (Object.keys(room.teams).length >= limits.team.teamMaxCount) {
      // A TEAM-tier refusal, not an error: the catalog gives it its own reason (`teams-full`)
      // precisely so the phone can say "join one of the teams that already exist" instead of
      // showing a player a generic rejection. The socket survives, as every team refusal does.
      this.refuse(connection, "teams-full");
      return;
    }
    this.detachFromTeam(entry);
    room.meta.teamCounter += 1;
    const team: TeamDoc = {
      teamId: `t-${String(room.meta.teamCounter)}`,
      name: message.name,
      colorId: null,
      buzzSoundId: null,
      leaderPlayerId: entry.playerId,
      locked: false,
    };
    room.teams[team.teamId] = team;
    entry.teamId = team.teamId;
    await this.persist("meta", "roster", "teams", "schedule");
    this.broadcastRoster();
  }

  private async handleTeamJoin(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "team-join" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    // WHO is being seated. A phone may only ever move itself; the HOST may name any player,
    // which is how the console's roster panel rebalances teams (user-flows C2 "drag to
    // rebalance", host supremacy under guiding principle 4).
    const isHost = attachment.role === "host";
    if (message.playerId !== undefined && !isHost && message.playerId !== attachment.playerId) {
      this.sendError(connection, "unauthorized", "only the host seats other players");
      return;
    }
    const playerId = message.playerId ?? attachment.playerId;
    const entry = playerId === null ? undefined : room.roster[playerId];
    if (entry === undefined) {
      this.sendError(
        connection,
        isHost ? "unknown-player" : "unauthorized",
        isHost ? undefined : "only players join teams",
      );
      return;
    }
    if (!this.teamEditsAllowed()) {
      this.sendError(connection, "rejected", "teams are locked once the game starts");
      return;
    }
    const team = room.teams[message.teamId];
    // The same two team-tier refusals a JOIN-time team intent earns (handleJoin above), for
    // the same reason and in the same words: the phone keeps its socket and picks another
    // card. They were plain errors here until the 2026-08-17 reconcile, which meant tapping a
    // locked team on the pre-game screen produced a console notice and no sentence on screen.
    if (team === undefined) {
      this.refuse(connection, "unknown-team");
      return;
    }
    // A lock stops JOINERS, not the host: it is the leader's anti-nuisance tool, and the host
    // out-ranks every team decision (docs/design/user-flows.md "Teams & leadership").
    if (team.locked && !isHost) {
      this.refuse(connection, "team-locked");
      return;
    }
    this.detachFromTeam(entry);
    entry.teamId = team.teamId;
    if (team.leaderPlayerId === null) team.leaderPlayerId = entry.playerId;
    await this.persist("roster", "teams", "schedule");
    this.broadcastRoster();
  }

  // Leaving a team (for another or on room exit) passes its leadership if held; an emptied
  // team keeps existing with a null leader (first joiner becomes leader - user-flows).
  private detachFromTeam(entry: StoredRosterEntry): void {
    const room = this.room;
    if (room === null || room === undefined || entry.teamId === null) return;
    const team = room.teams[entry.teamId];
    entry.teamId = null;
    if (team !== undefined && team.leaderPlayerId === entry.playerId) {
      team.leaderPlayerId = this.pickSuccessor(team.teamId, entry.playerId);
      delete room.schedule.successions[team.teamId];
    }
  }

  // Resolve which team a leader-tier message targets and whether the sender may steer it:
  // the host names any team; a player must be that team's leader.
  private authorizeTeamAdministration(
    connection: Connection<Attachment>,
    attachment: Attachment,
    explicitTeamId: string | undefined,
  ): TeamDoc | null {
    const room = this.room;
    if (room === null || room === undefined) return null;
    if (attachment.role === "host") {
      const team = explicitTeamId === undefined ? undefined : room.teams[explicitTeamId];
      if (team === undefined) {
        this.sendError(connection, "unknown-team", "host must name the team");
        return null;
      }
      return team;
    }
    const playerId = attachment.playerId;
    const entry = playerId === null ? undefined : room.roster[playerId];
    const team =
      entry?.teamId === null || entry === undefined ? undefined : room.teams[entry.teamId];
    if (team === undefined) {
      this.sendError(connection, "unknown-team", "you are not on a team");
      return null;
    }
    if (explicitTeamId !== undefined && explicitTeamId !== team.teamId) {
      this.sendError(connection, "unauthorized", "leaders steer only their own team");
      return null;
    }
    if (team.leaderPlayerId !== playerId) {
      this.sendError(connection, "unauthorized", "team changes are leader-only");
      return null;
    }
    return team;
  }

  private async handleTeamUpdate(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "team-update" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const team = this.authorizeTeamAdministration(connection, attachment, message.teamId);
    if (team === null) return;
    if (identityEditsLocked(room.meta.lifecycle === "active" ? room.state : null)) {
      this.sendError(connection, "identity-locked", "wait for the clue to resolve");
      return;
    }
    if (message.name !== undefined && message.name !== team.name) {
      if (attachment.role !== "host" && !this.renameAdmitted(team.teamId)) {
        this.sendError(connection, "rate-limited", "too many renames; wait a minute");
        return;
      }
      team.name = message.name;
    }
    if (message.colorId !== undefined) team.colorId = message.colorId;
    if (message.buzzSoundId !== undefined) team.buzzSoundId = message.buzzSoundId;
    if (message.locked !== undefined) team.locked = message.locked;
    await this.persist("teams", "renames");
    this.broadcastRoster();
  }

  private async handleTeamKick(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "team-kick" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const target = room.roster[message.playerId];
    if (target === undefined || target.teamId === null) {
      this.sendError(connection, "unknown-player");
      return;
    }
    const team = this.authorizeTeamAdministration(connection, attachment, target.teamId);
    if (team === null) return;
    if (!this.teamEditsAllowed()) {
      this.sendError(connection, "rejected", "teams are locked once the game starts");
      return;
    }
    if (message.playerId === attachment.playerId) {
      this.sendError(connection, "rejected", "leaders leave by handing off first");
      return;
    }
    // Kicked players return to team selection (they may join another team, or the same one
    // unless the leader locks it - the lock is the anti-nuisance tool, not a ban list).
    this.detachFromTeam(target);
    await this.persist("roster", "teams", "schedule");
    this.broadcastRoster();
  }

  private async handleTeamHandoff(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "team-handoff" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const target = room.roster[message.playerId];
    if (target === undefined || target.teamId === null) {
      this.sendError(connection, "unknown-player");
      return;
    }
    const team = this.authorizeTeamAdministration(connection, attachment, target.teamId);
    if (team === null) return;
    team.leaderPlayerId = target.playerId;
    delete room.schedule.successions[team.teamId];
    await this.persist("teams", "schedule");
    this.broadcastRoster();
  }

  // ---- host room controls -------------------------------------------------------------------

  // Freeze/resume the room. Pausing converts every running engine timer into the time it had
  // LEFT; resuming turns that back into a deadline, so a five-minute break never silently
  // expires the clue somebody was mid-answer on. The engine is untouched throughout - it has
  // no pause concept, and inventing one there would mean a new action in every replay log.
  private async handleSetPause(
    connection: Connection<Attachment>,
    attachment: Attachment,
    paused: boolean,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host") {
      this.sendError(connection, "unauthorized", "pause is host-only");
      return;
    }
    const alreadyPaused = room.meta.pausedAt !== null;
    if (alreadyPaused === paused) return; // idempotent: a double-tap is not an error
    const now = Date.now();
    if (paused) {
      room.meta.pausedAt = now;
      for (const entry of Object.values(room.schedule.engineTimers)) {
        entry.remainingMs = Math.max(entry.dueAt - now, 0);
      }
    } else {
      room.meta.pausedAt = null;
      for (const entry of Object.values(room.schedule.engineTimers)) {
        if (entry.remainingMs !== undefined) {
          entry.dueAt = now + entry.remainingMs;
          delete entry.remainingMs;
        }
      }
    }
    await this.persist("meta", "schedule");
    await this.rescheduleAlarm();
    this.broadcastToJoined({ type: "paused", paused, at: now });
  }

  // "Skip the wait": fire whichever timer the room is currently waiting on. Ordinary expiries
  // are server-driven through the alarm book - a client can never forge time - so this is the
  // host reaching for the same lever early (guiding principle 4), not a new authority: the
  // host may already relay each *-timeout action by name (authority.ts).
  private async handleExpireTimer(
    connection: Connection<Attachment>,
    attachment: Attachment,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host") {
      this.sendError(connection, "unauthorized", "forcing a timer is host-only");
      return;
    }
    // Same rule as a relayed action: held presses resolve first. A host reaching for "skip
    // the wait" during an armed window would otherwise fire the buzz-window timeout and kill
    // a clue that somebody had already rung in on (M6).
    await this.flushArmWindow();
    // The alarm book keeps STALE entries on purpose (a phase moved on, an undo rewound time)
    // - they fire as harmless engine rejections. So "the timer the room is on" is the first
    // entry the engine still accepts, not simply the earliest deadline: walk them in due
    // order, dropping what the engine rejects, and stop at the one that actually does
    // something. Rejections stay silent here; only "nothing to skip" reaches the host.
    const pending = Object.entries(room.schedule.engineTimers).toSorted(
      ([, left], [, right]) => left.dueAt - right.dueAt,
    );
    for (const [kind, entry] of pending) {
      delete room.schedule.engineTimers[kind];
      const candidate = gameActionSchema.safeParse({ type: entry.actionType, at: Date.now() });
      if (!candidate.success) continue;
      // oxlint-disable-next-line no-await-in-loop
      const accepted = await this.applyEngineActions([candidate.data], {
        silentRejections: true,
      });
      if (accepted.length > 0) return;
    }
    await this.persist("schedule");
    this.sendError(connection, "rejected", "the room is not waiting on a timer");
  }

  // End the room deliberately. Everyone gets the polite screen with a reason they can show
  // verbatim (user-flows A5); the room is marked ended so the lobby delists it, and the
  // storage wipe waits for the ordinary expiry alarm - a host who closes by accident still
  // has the state, and the code stays spent until it ages out.
  private async handleCloseRoom(
    connection: Connection<Attachment>,
    attachment: Attachment,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host") {
      this.sendError(connection, "unauthorized", "closing the room is host-only");
      return;
    }
    await this.closeRoom(room);
  }

  // The close itself, shared by the host's close-room message and the token-authenticated
  // /close RPC (the harness's per-room Delete). One body so the two doors cannot drift into
  // meaning different things.
  private async closeRoom(
    room: LoadedRoom,
    reason: "host-closed" | "expired" = "host-closed",
  ): Promise<void> {
    room.meta.lifecycle = "ended";
    await this.persist("meta");
    await endRegistryRow(this.env.DB, room.meta.code, Date.now());
    for (const other of this.getConnections<Attachment>()) {
      this.send(other, { type: "room-closed", reason });
      other.close(roomCloseCodes.roomClosed, reason);
    }
  }

  private broadcastToJoined(payload: Record<string, unknown>): void {
    for (const connection of this.getConnections<Attachment>()) {
      if (connection.state !== null) this.send(connection, payload);
    }
  }

  // ---- room settings --------------------------------------------------------------------------

  // Apply a host's settings patch: validate against the room as it stands, mutate, persist,
  // tell EVERYONE, and re-project the lobby row. One implementation for both doors (the
  // update-room-settings message and the /settings RPC) - docs/decisions/2026-08-14-room-
  // controls-and-staging.md.
  //
  // Two refusals, and both are about not surprising people:
  // - going PUBLIC without a title would put an unnamed row in a server browser (the create
  //   path refuses the same thing);
  // - lowering a cap BELOW the people already inside would either eject them or leave the room
  //   permanently over its own limit. Nobody is ever kicked by a settings edit; the host
  //   lowers the number after they leave, or kicks deliberately.
  private async applyRoomSettings(
    room: LoadedRoom,
    patch: RoomSettingsPatch,
  ): Promise<{ ok: true } | { ok: false; reason: "title-required" | "below-current" }> {
    const meta = room.meta;
    const title = patch.title ?? meta.title;
    if ((patch.listing ?? meta.settings.listing) === "public" && title === "") {
      return { ok: false, reason: "title-required" };
    }
    if (patch.maxPlayers !== undefined && patch.maxPlayers < Object.keys(room.roster).length) {
      return { ok: false, reason: "below-current" };
    }
    if (patch.maxSpectators !== undefined && patch.maxSpectators < this.spectatorCount()) {
      return { ok: false, reason: "below-current" };
    }

    if (patch.listing !== undefined) meta.settings.listing = patch.listing;
    if (patch.maxPlayers !== undefined) meta.settings.maxPlayers = patch.maxPlayers;
    if (patch.maxSpectators !== undefined) meta.settings.maxSpectators = patch.maxSpectators;
    if (patch.spectatorsAllowed !== undefined) {
      meta.settings.spectatorsAllowed = patch.spectatorsAllowed;
    }
    if (patch.hideJoinCode !== undefined) meta.settings.hideJoinCode = patch.hideJoinCode;
    if (patch.title !== undefined) meta.title = patch.title;
    if (patch.hostLabel !== undefined) meta.hostLabel = patch.hostLabel;
    await this.persist("meta");
    this.broadcastRoomSettings();
    // Going private must leave the lobby AT ONCE rather than at the next sweep - a browsable
    // door onto a room its host just closed to strangers is the one drift that matters here.
    // (Nobody already connected is ever removed by an edit: turning spectators off, or
    // lowering a cap, changes who may come in next, not who is already watching.)
    await this.syncRegistryListing(room);
    return { ok: true };
  }

  private async handleUpdateRoomSettings(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "update-room-settings" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host") {
      this.sendError(connection, "unauthorized", "room settings are host-only");
      return;
    }
    const applied = await this.applyRoomSettings(room, message.settings);
    if (!applied.ok) {
      this.sendError(
        connection,
        "rejected",
        applied.reason === "title-required"
          ? "a public room needs a title - it is the row people read in the lobby"
          : "a cap cannot be set below the participants already in the room",
      );
    }
  }

  /**
   * Retune the rules of a running game (owner, 2026-08-20: the answer timer "should be
   * settable by the host").
   *
   * `setup` is the engine's static input and is written once at initialize - deliberately, and
   * that stays true of everything the running state was BUILT from. What moves here is only
   * the subset the engine reads fresh each time it needs it (@jeopardy/protocol
   * room/live-rules.ts holds the list and the argument), so a change between clues, or during
   * one, means the next read simply sees the new number. Nothing in flight becomes a
   * description of a game that never happened.
   *
   * Persisted immediately: a room that is evicted a second after the host lengthens the answer
   * clock must come back with the longer clock, or the setting silently reverts at the worst
   * possible moment.
   */
  private async handleUpdateGameRules(
    connection: Connection<Attachment>,
    attachment: Attachment,
    message: Extract<RoomClientMessage, { type: "update-game-rules" }>,
  ): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    if (attachment.role !== "host") {
      this.sendError(connection, "unauthorized", "game rules are host-only");
      return;
    }
    const { buzzing, scoring } = message.rules;
    room.setup = {
      ...room.setup,
      settings: {
        ...room.setup.settings,
        buzzing: { ...room.setup.settings.buzzing, ...buzzing },
        scoring: { ...room.setup.settings.scoring, ...scoring },
      },
    };
    await this.persist("setup");
    this.broadcastGameRules();
  }

  /**
   * The rules every surface is playing by. Broadcast to EVERY connection rather than answered
   * to the host, for the same reason room settings are: a phone's answer clock and the
   * console's copy of the rule have to change together, or one of them is lying to the room.
   */
  private broadcastGameRules(): void {
    const room = this.room;
    if (room === null || room === undefined) return;
    const payload = { type: "game-rules", rules: liveRulesOf(room.setup), at: Date.now() };
    for (const connection of this.getConnections<Attachment>()) this.send(connection, payload);
  }

  /** The same facts to one connection, on join - so a phone draws the right clock immediately. */
  private sendGameRules(connection: Connection<Attachment>): void {
    const room = this.room;
    if (room === null || room === undefined) return;
    this.send(connection, { type: "game-rules", rules: liveRulesOf(room.setup), at: Date.now() });
  }

  // Every connection, joined or not: a socket still choosing a role has already been handed
  // the room code, and a display that has not finished joining must not paint a code that is
  // now hidden.
  private broadcastRoomSettings(): void {
    const room = this.room;
    if (room === null || room === undefined) return;
    const payload = {
      type: "room-settings",
      settings: roomSettingsPayload(room.meta),
      at: Date.now(),
    };
    for (const connection of this.getConnections<Attachment>()) this.send(connection, payload);
  }

  // The lobby row's listing facts, pushed on a settings change. Forced past the coalescing
  // window on purpose: "this room is no longer public" is exactly the write a browser must
  // never read late.
  private async syncRegistryListing(room: LoadedRoom): Promise<void> {
    const listing: RegistryListing = {
      code: room.meta.code,
      listing: room.meta.settings.listing,
      title: room.meta.title,
      hostLabel: room.meta.hostLabel,
      playerCap: room.meta.settings.maxPlayers,
      spectatorCap: room.meta.settings.maxSpectators,
      spectatorsAllowed: room.meta.settings.spectatorsAllowed,
      lastSeenAt: Date.now(),
    };
    await relistRegistryRow(this.env.DB, listing);
  }

  /** Spectators hold no roster seat, so their budget is counted from live connections. */
  private spectatorCount(): number {
    let count = 0;
    for (const connection of this.getConnections<Attachment>()) {
      if (connection.state?.role === "spectator") count += 1;
    }
    return count;
  }

  // ---- alarms -----------------------------------------------------------------------------

  override async onAlarm(): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const now = Date.now();
    const code = room.meta.code;

    // Idle expiry first: a dead room fires nothing else, frees its code, and later joins
    // get no-such-room (the storage wipe IS the un-initialization).
    if (now >= room.meta.lastActivityAt + limits.room.idleExpiryMs) {
      for (const connection of this.getConnections<Attachment>()) {
        this.send(connection, { type: "room-closed", reason: "expired" });
        connection.close(roomCloseCodes.roomClosed, "room expired");
      }
      this.room = null;
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      // The code is free for reuse now, so its lobby row must go with it - a row outliving
      // its room would advertise a door that answers no-such-room. If this write fails the
      // web Worker's sweep collects the row on expires_at anyway (registry-writer.ts).
      await deleteRegistryRow(this.env.DB, code);
      return;
    }

    // Empty-room expiry: the second, much shorter deadline (limits.room.emptyRoomGraceMs).
    // Idle expiry above protects a room that is OCCUPIED but dormant; this one answers
    // "everyone left" and hands the code back to the pool sooner. It CLOSES the room (ended
    // lifecycle, lobby row marked ended) rather than wiping storage: the wipe stays with the
    // idle alarm, so a host who comes back to a room that emptied out still finds its state
    // and its code still spent. A reconnect before this point cleared the deadline in
    // onConnect, which is why the check is re-made here against live connections too.
    if (room.schedule.emptyRoomAt !== null && room.schedule.emptyRoomAt <= now) {
      room.schedule.emptyRoomAt = null;
      const stillEmpty = [...this.getConnections<Attachment>()].length === 0;
      await this.persist("schedule");
      if (stillEmpty) {
        await this.closeRoom(room, "expired");
        await this.rescheduleAlarm();
        return;
      }
    }

    // Held buzzes first, ALWAYS - not only when their own deadline is what woke us. The
    // buzz-window timeout is the dangerous neighbour: firing it while presses sit in the
    // holding pen would kill a clue somebody legitimately rang in on.
    await this.flushArmWindow();

    // Engine timers: dispatch every due expiry action. Stale ones (the phase moved on, an
    // undo rewound time) reject inside the engine and are dropped silently - by design.
    // A PAUSED room dispatches none: its timers hold their remaining time until resume.
    const dueActions: GameAction[] = [];
    for (const [kind, entry] of Object.entries(
      room.meta.pausedAt === null ? room.schedule.engineTimers : {},
    )) {
      if (entry.dueAt <= now) {
        delete room.schedule.engineTimers[kind];
        const candidate = gameActionSchema.safeParse({ type: entry.actionType, at: now });
        if (candidate.success) dueActions.push(candidate.data);
      }
    }
    if (dueActions.length > 0) {
      await this.applyEngineActions(dueActions, { silentRejections: true });
    }

    // Leadership succession: grace elapsed and the leader is still gone -> longest-tenured
    // connected member takes over; the original returning later rejoins as a member.
    let rosterChanged = false;
    for (const [teamId, succession] of Object.entries(room.schedule.successions)) {
      if (succession.dueAt > now) continue;
      delete room.schedule.successions[teamId];
      const team = room.teams[teamId];
      if (team === undefined || team.leaderPlayerId !== succession.leaderPlayerId) continue;
      const leader = room.roster[succession.leaderPlayerId];
      if (leader !== undefined && leader.connected) continue;
      team.leaderPlayerId = this.pickSuccessor(teamId, succession.leaderPlayerId);
      rosterChanged = true;
    }
    if (rosterChanged) {
      await this.persist("teams");
      this.broadcastRoster();
    }
    await this.persist("schedule");
    await this.rescheduleAlarm();
  }
}
