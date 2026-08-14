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
//   and narrated to every client as redacted event batches. Arrival order IS buzz order
//   (fairness compensation is M6, upstream of the engine).
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
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { limits } from "@jeopardy/protocol/limits";
import { createRoomRequestSchema, generateSecretToken } from "@jeopardy/protocol/room/create";
import { parseRoomClientMessage } from "@jeopardy/protocol/room/client-messages";
import { roomCloseCodes } from "@jeopardy/protocol/room/server-messages";
import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import { identityEditsLocked, stampRelayedAction, timerExpiryAction } from "./room/engine-glue.ts";
import { redactEventsFor, redactStateFor } from "./room/redact.ts";
import { emptySchedule, nextWakeAt, toWireRosterEntry } from "./room/storage.ts";
import type { GameAction } from "@jeopardy/engine/actions";
import type { GameEvent } from "@jeopardy/engine/events";
import type { GameSetup } from "@jeopardy/engine/setup";
import type { GameState } from "@jeopardy/engine/state";
import type { RoomGameSpec } from "@jeopardy/protocol/room/create";
import type { RoomClientMessage } from "@jeopardy/protocol/room/client-messages";
import type { RefusalReason, RoomErrorReason } from "@jeopardy/protocol/room/server-messages";
import type { RoomRole } from "@jeopardy/protocol/room/identity";
import type { RosterPayload, TeamDoc } from "@jeopardy/protocol/room/roster";
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
};

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

  override onStart(): void {
    // Heartbeat auto-response: phones ping to keep venue Wi-Fi NAT mappings alive; the
    // runtime answers without waking (and without billing) the DO. partyserver does not
    // wire this itself (docs/decisions/2026-08-13-partyserver.md).
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- storage bundle -------------------------------------------------------------------

  private async load(): Promise<LoadedRoom | null> {
    if (this.room !== undefined) return this.room;
    const keys = ["meta", "setup", "state", "spec", "roster", "teams", "renames", "schedule"];
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
      schedule:
        (values.get("schedule") as AlarmSchedule | undefined) ?? structuredClone(emptySchedule),
    };
    this.lastPersistedActivity = meta.lastActivityAt;
    return this.room;
  }

  private async persist(
    ...keys: ("meta" | "setup" | "state" | "spec" | "roster" | "teams" | "renames" | "schedule")[]
  ): Promise<void> {
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
    if (room === null || room === undefined) return { players: [], teams: [] };
    const players = Object.values(room.roster)
      .toSorted((a, b) => a.joinedAt - b.joinedAt)
      .map(toWireRosterEntry);
    return { players, teams: Object.values(room.teams) };
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
    });
  }

  // ---- engine pipeline ------------------------------------------------------------------

  // Apply engine actions in arrival order, persist once, narrate once. Returns accepted
  // events (callers special-case buzz feedback). Rejections: reported to `reporter` unless
  // silent (alarm-fired stale timers are EXPECTED to reject harmlessly).
  private async applyEngineActions(
    actions: GameAction[],
    options: { reporter?: Connection; silentRejections?: boolean } = {},
  ): Promise<GameEvent[]> {
    const room = await this.load();
    if (room === null) return [];
    const accepted: GameEvent[] = [];
    for (const action of actions) {
      const result = transition(room.state, action, room.setup);
      const rejection = result.events.find((event) => event.type === "action-rejected");
      if (rejection !== undefined && rejection.type === "action-rejected") {
        if (options.silentRejections !== true && options.reporter !== undefined) {
          if (action.type === "buzz") {
            // The engine narrates buzz rejections precisely (too-late, locked-out...);
            // relay that as silent per-phone feedback, never room audio.
            const buzzEvent = result.events.find((event) => event.type === "buzz-rejected");
            this.send(options.reporter, {
              type: "buzz-rejected",
              reason: buzzEvent?.type === "buzz-rejected" ? buzzEvent.reason : "not-armed",
              lockedUntil: null,
            });
          } else {
            this.sendError(options.reporter, "action-rejected", rejection.reason);
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
    room.meta.stateVersion += 1;
    room.meta.lastActivityAt = Date.now();
    this.lastPersistedActivity = room.meta.lastActivityAt;
    await this.persist("state", "meta", "schedule");
    await this.rescheduleAlarm();
    this.broadcastEngineEvents(accepted);
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

    // Everything else flows as the ordered event stream, role-redacted per connection.
    // early-buzz additionally produces private buzz-rejected feedback for the offender.
    const stream = events.filter((event) => event.type !== "buzz-won");
    for (const connection of this.getConnections<Attachment>()) {
      const attachment = connection.state;
      if (attachment === null) continue;
      const redacted = redactEventsFor(attachment.role, attachment.playerId, stream);
      if (redacted.length > 0) {
        this.send(connection, { type: "event", stateVersion: version, events: redacted });
      }
      for (const event of stream) {
        if (event.type === "early-buzz" && event.playerId === attachment.playerId) {
          this.send(connection, {
            type: "buzz-rejected",
            reason: "early-lockout",
            lockedUntil: event.lockedUntil,
          });
        }
      }
    }
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
        createdAt: now,
        lastActivityAt: now,
        stateVersion: 0,
        lifecycle: "lobby",
        playerCounter: 0,
        teamCounter: 0,
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
      );
      await this.rescheduleAlarm();
      return Response.json(
        { hostToken: meta.hostToken, expiresAt: now + limits.room.idleExpiryMs },
        { status: 201 },
      );
    }
    return Response.json({ error: "not-found" }, { status: 404 });
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
    // No server hello: the client's first move is join or resume; welcome answers it.
  }

  override async onMessage(connection: Connection<Attachment>, message: WSMessage): Promise<void> {
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
        return this.handleAction(connection, attachment, incoming.action);
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
      default:
    }
  }

  override async onClose(connection: Connection<Attachment>): Promise<void> {
    const attachment = connection.state;
    if (attachment === null || attachment.playerId === null) return;
    const room = await this.load();
    if (room === null) return;
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
      return;
    }

    if (message.role === "display" || message.role === "spectator") {
      connection.setState({ role: message.role, playerId: null });
      this.send(connection, {
        type: "welcome",
        roomCode: room.meta.code,
        role: message.role,
        playerId: null,
        sessionToken: null,
      });
      this.sendSnapshot(connection, { role: message.role, playerId: null });
      return;
    }

    // role === "player"
    if (message.nickname === undefined) {
      this.sendError(connection, "rejected", "players join with a nickname");
      return;
    }
    if (Object.keys(room.roster).length >= limits.room.playerHardCap) {
      this.refuse(connection, "room-full", roomCloseCodes.roomFull);
      return;
    }
    const teamsMode = room.setup.settings.teams.playerMode === "teams";
    if (!teamsMode && message.team !== undefined) {
      this.sendError(connection, "rejected", "room is not in teams mode");
      return;
    }

    // Resolve team intent BEFORE seating so a team refusal leaves nothing behind and the
    // phone can retry on the same socket (server-messages close-code note).
    let teamId: string | null = null;
    let createdTeam: TeamDoc | null = null;
    if (teamsMode && message.team !== undefined) {
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
      if (teamsMode && teamId === null) {
        this.sendError(connection, "rejected", "pick a team to join a running game");
        return;
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
      return;
    }

    room.roster[playerId] = entry;
    if (createdTeam !== null) room.teams[createdTeam.teamId] = createdTeam;
    await this.persist("meta", "roster", "teams");
    connection.setState({ role: "player", playerId });
    this.welcomePlayer(connection, room.meta.code, playerId, entry.sessionToken);
    this.broadcastRoster();
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
      at: Date.now(),
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
    // in one arrival-ordered batch, then the game starts. Retry-safe (already-seated
    // players are skipped), and in teams mode every player must have picked a team.
    if (stamped.action.type === "start-game") {
      const teamsMode = room.setup.settings.teams.playerMode === "teams";
      const unseated = Object.values(room.roster).filter(
        (entry) => room.state.players[entry.playerId] === undefined,
      );
      if (teamsMode && unseated.some((entry) => entry.teamId === null)) {
        this.sendError(connection, "rejected", "every player needs a team before start");
        return;
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
        this.send(other, { type: "room-closed", reason: "host-closed" });
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
    if (room.setup.settings.teams.playerMode !== "teams") {
      this.sendError(connection, "rejected", "room is not in teams mode");
      return;
    }
    if (!this.teamEditsAllowed()) {
      this.sendError(connection, "rejected", "teams are locked once the game starts");
      return;
    }
    if (Object.keys(room.teams).length >= limits.team.teamMaxCount) {
      this.sendError(connection, "rejected", "team limit reached");
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
    const playerId = attachment.playerId;
    const entry = playerId === null ? undefined : room.roster[playerId];
    if (entry === undefined) {
      this.sendError(connection, "unauthorized", "only players join teams");
      return;
    }
    if (!this.teamEditsAllowed()) {
      this.sendError(connection, "rejected", "teams are locked once the game starts");
      return;
    }
    const team = room.teams[message.teamId];
    if (team === undefined) {
      this.sendError(connection, "unknown-team");
      return;
    }
    if (team.locked) {
      this.sendError(connection, "rejected", "team is locked");
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

  // ---- alarms -----------------------------------------------------------------------------

  override async onAlarm(): Promise<void> {
    const room = await this.load();
    if (room === null) return;
    const now = Date.now();

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
      return;
    }

    // Engine timers: dispatch every due expiry action. Stale ones (the phase moved on, an
    // undo rewound time) reject inside the engine and are dropped silently - by design.
    const dueActions: GameAction[] = [];
    for (const [kind, entry] of Object.entries(room.schedule.engineTimers)) {
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
