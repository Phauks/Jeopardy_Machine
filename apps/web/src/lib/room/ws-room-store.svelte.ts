// The WebSocket room store: the same RoomStore interface, wired to a real GameRoomDO. This is
// the store every real room code gets (#lib/room/create-room-store.ts decides); local-sim
// stays for the demo room and the dev surfaces.
//
// The whole point of the seam is that a surface cannot tell the two apart, so the rules are:
// nothing here renders, nothing here writes copy, and every field of RoomView is filled from
// the protocol's own shapes (packages/protocol/src/room/) rather than reinterpreted.
//
// Message -> store effect (server -> client; server-messages.ts owns the delivery contract):
//
// | Message       | Effect                                                                    |
// | ------------- | ------------------------------------------------------------------------- |
// | welcome       | myPlayerId + sessionToken (handed to onSessionToken -> sessionStorage);    |
// |               | connection=connected                                                       |
// | refused       | view.refusal (the REASON; room-refusal.ts owns the words). Room-level      |
// |               | reasons arrive with a close; team-tier ones keep the socket                |
// | snapshot      | replaces game + roster + phase + paused wholesale, and carries the room's  |
// |               | static facts (playerMode, board material) so `sync` restores everything   |
// | event         | folds the batch through room-fold.ts and takes the state it carries; a     |
// |               | stateVersion gap of more than one asks for `sync`                          |
// | arm-window    | `arm-ack` goes back IMMEDIATELY (see the latency note below), and the     |
// |               | arming lands on view.arming with a null paint time                        |
// | buzz-won      | folded as the engine event of the same name; the room-audio callback gets  |
// |               | the SERVER-resolved sound (team-first) rather than resolving it again      |
// | buzz-rejected | myBuzz=rejected with reason + lockedUntil (per-phone, silent, local)       |
// | roster        | replaces view.roster wholesale (whole-payload sync by protocol design)     |
// | clue-content  | fills view.content for the open clue, already role-redacted server-side    |
// | paused        | view.paused                                                               |
// | room-settings | replaces view.settings wholesale - which is how a join code that just      |
// |               | became hidden leaves the projector at once                                 |
// | room-closed   | connection=closed and no reconnect; the polite screen keys off the reason  |
// | error         | kept as the last error for the console; never a thrown exception          |
//
// TIMERS. The DO owns expiries through its alarm book, so this store only RENDERS the hints
// (`pendingTimers`) and never dispatches an expiry action - a client that could forge time
// could forge a buzz window. `expireTimer` is therefore the host's "skip the wait" relay. The
// hints come from two places: `timer-set` events while a surface is watching, and
// `snapshot.timers` (remaining ms) for a surface that arrived after those events went out.
//
// LATENCY COMPENSATION, this store's half (docs/decisions/2026-08-17-buzz-latency-
// compensation.md "What clients owe"). The room ranks buzzes by REACTION TIME instead of by
// whose Wi-Fi is fastest, and it needs exactly two things from here:
//
//   1. `arm-ack`, sent the instant `arm-window` is read and before anything else happens. The
//      round trip IS the measurement - the server times its own broadcast against this reply -
//      so every millisecond spent between reading the frame and answering it is charged to
//      this phone as network latency that is not there. It is therefore the FIRST statement in
//      that branch, ahead of the state write, and it is never batched or deferred.
//   2. `timing: { armId, elapsedMs }` on the buzz, elapsed measured from the moment the armed
//      button was PAINTED (`markArmedPainted`, called by the surface) rather than from the
//      moment this frame arrived. Painting is when the player could first see the button go
//      hot, and the thumb is the quantity being ranked.
//
// Neither implies clock synchronization: both numbers are differences on one machine's own
// clock. Skipping either is safe and un-punished - the room falls back to arrival order for
// this connection, which is exactly what it did before compensation existed.
import { defaultRoomSettings } from "@jeopardy/protocol/room/room-settings";
import { parseRoomServerMessage } from "@jeopardy/protocol/room/server-messages";
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { browserRoomSocket } from "#lib/room/room-socket.ts";
import {
  emptyFold,
  foldEvent,
  pendingTimersFromRoom,
  prunePendingTimers,
} from "#lib/room/room-fold.ts";
import { roomWebSocketUrl } from "#lib/realtime/room-url.ts";
import type { PlayerMode } from "@jeopardy/protocol/settings/player-mode";
import type { Verdict } from "@jeopardy/engine/actions";
import type { GameEvent, TimerKind } from "@jeopardy/engine/events";
import type { GameState } from "@jeopardy/engine/state";
import type { RoomSettings, RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
import type {
  BoardMaterial,
  ClueContent,
  RoomServerMessage,
} from "@jeopardy/protocol/room/server-messages";
import type { RosterPayload } from "@jeopardy/protocol/room/roster";
import type { RoomSocket, RoomSocketFactory } from "#lib/room/room-socket.ts";
import type { RoomFoldState } from "#lib/room/room-fold.ts";
import type {
  IdentityPatch,
  JoinRequest,
  RoomBuzz,
  RoomStore,
  TeamPatch,
} from "#lib/room/room-store.ts";
import type {
  ClueContentView,
  RoomArmingView,
  RoomConnectionState,
  RoomContentView,
  RoomPlayerView,
  RoomRefusalView,
  RoomRoleView,
  RoomTeamView,
  RoomView,
} from "#lib/room/room-view.ts";

export type WsRoomStoreOptions = {
  roomCode: string;
  role: RoomRoleView;
  /** Creation-time credential; required for role=host (join-hand-off.ts stashes it). */
  hostToken?: string | null;
  /** The A5 resume credential from a previous join in this tab; null on a first visit. */
  sessionToken?: string | null;
  /** Where a newly minted (or invalidated) session token goes - sessionStorage, per tab. */
  onSessionToken?: ((token: string | null) => void) | null;
  /** Engine narration tap (the display's diorama beats and the console's flashes). */
  onEvent?: ((event: GameEvent) => void) | null;
  /** Room audio: fires once per arming with the sound the SERVER picked. */
  onBuzzWon?: ((buzz: RoomBuzz) => void) | null;
  /** Test seams. `connect` supplies a fake socket; `origin` builds the url without a DOM. */
  connect?: RoomSocketFactory;
  origin?: string;
  now?: () => number;
  /**
   * Reconnect backoff ladder, milliseconds. Deliberately fixed rather than jittered: a room is
   * tens of phones, not thousands, and a reproducible ladder is a testable one. The last rung
   * repeats forever - a phone in a pocket during a coffee break must still come back.
   */
  reconnectDelaysMs?: number[];
  /** Off in tests and SSR; the routes leave it on. */
  autoConnect?: boolean;
};

const defaultReconnectDelaysMs = [500, 1000, 2000, 4000, 8000, 15_000];

/** Any 44xx is the room saying "do not come back" (roomCloseCodes in server-messages.ts). */
function isTerminalCloseCode(code: number): boolean {
  return code >= 4400 && code < 4500;
}

function clueKey(roundIndex: number, category: number, row: number): string {
  return `${String(roundIndex)}:${String(category)}:${String(row)}`;
}

function toPlayerView(entry: RosterPayload["players"][number]): RoomPlayerView {
  return {
    playerId: entry.playerId,
    nickname: entry.identity.nickname,
    avatarId: entry.identity.avatarId,
    accentId: entry.identity.accentId,
    buzzSoundId: entry.identity.buzzSoundId,
    // Absent means "this player never chose", which renders exactly like an explicit null -
    // the pack's own colors. Nothing here may turn absence into a guess (identity.ts).
    skinToneId: entry.identity.skinToneId ?? null,
    teamId: entry.teamId,
    connected: entry.connected,
    joinedAt: entry.joinedAt,
  };
}

function toClueContentView(content: ClueContent): ClueContentView {
  return {
    categoryTitle: content.category,
    // Null prompt = this role does not get the text (players, unless clueTextOnPhones is on).
    // It arrives anyway so the layout can be drawn without guessing whether more is coming.
    prompt: content.prompt?.text ?? "",
    // Already resolved by the room - kind, type, alt and (when the bytes are fetchable) a url.
    // The store does no lookup of its own because a client holds no document to look in.
    media: content.prompt?.media ?? null,
    response: content.answer?.canonical ?? null,
    responseMedia: content.answer?.media ?? null,
  };
}

export class WsRoomStore implements RoomStore {
  readonly mode = "ws" as const;

  private readonly roomCode: string;
  private readonly role: RoomRoleView;
  private readonly options: WsRoomStoreOptions;
  private readonly connectSocket: RoomSocketFactory;
  private readonly now: () => number;
  private readonly reconnectDelaysMs: number[];

  private socket: RoomSocket | null = null;
  private socketOpen = false;
  /** The player's join intent, kept so a reconnect that lost its token can offer it again. */
  private pendingJoin: JoinRequest | null = null;
  private sessionToken: string | null;
  private reconnectAttempt = 0;
  private reconnectHandle: ReturnType<typeof setTimeout> | null = null;
  private done = false;
  /** Highest state version this connection has seen - the gap detector's high-water mark. */
  private stateVersion = -1;

  private connectionState = $state<RoomConnectionState>("connecting");
  private engineState = $state.raw<GameState | null>(null);
  private rosterPlayers = $state.raw<RoomPlayerView[]>([]);
  private rosterTeams = $state.raw<RoomTeamView[]>([]);
  /**
   * The audience, or null when the room has not reported one. Null is NOT zero: the DO always
   * sends `spectatorCount`, so null here means no roster has landed yet, and a console that
   * printed that as "0 watching" would be inventing a number (room-view.ts).
   */
  private spectatorCountState = $state<number | null>(null);
  private roomPhase = $state<"lobby" | "active" | "ended">("lobby");
  private playerModeState = $state<PlayerMode>("individuals");
  private myPlayerIdState = $state<string | null>(null);
  private fold = $state.raw<RoomFoldState>(emptyFold());
  /** The open arming, with the local paint time the surface stamps on it. */
  private armingState = $state.raw<RoomArmingView | null>(null);
  private pausedState = $state(false);
  private boardRounds = $state.raw<BoardMaterial["rounds"] | null>(null);
  private clueTexts = $state.raw<Record<string, ClueContentView>>({});
  private finalText = $state.raw<ClueContentView | null>(null);
  /**
   * A SHELL, and `settingsKnownState` below is what says so. `hideJoinCode: false` is the right
   * shell value (the connecting screen shows no code anyway, and streamer mode lands the moment
   * `room-settings` arrives), but the numbers beside it are the PROTOCOL's defaults and not this
   * room's - so a surface that reports settings must say "not loaded yet" rather than draw a
   * plausible fiction (owner, 2026-08-17: "I don't think the room I created shows the correct
   * settings").
   */
  private roomSettings = $state.raw<RoomSettings>({
    ...defaultRoomSettings,
    title: "",
    hostLabel: "",
  });
  private settingsKnownState = $state(false);
  private refusalState = $state.raw<RoomRefusalView | null>(null);
  /** The room's last complaint about something this client sent (console-side notice). */
  private lastErrorState = $state.raw<{ reason: string; detail: string | null } | null>(null);

  constructor(options: WsRoomStoreOptions) {
    this.options = options;
    this.roomCode = options.roomCode;
    this.role = options.role;
    this.connectSocket = options.connect ?? browserRoomSocket;
    this.now = options.now ?? Date.now;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? defaultReconnectDelaysMs;
    // "" is what sessionStorage answers for a tab that has no seat, and it is NOT a token: the
    // browser-walk found this store politely resuming with an empty string and being told the
    // frame was malformed, after which the phone's join never went out at all.
    this.sessionToken = options.sessionToken === "" ? null : (options.sessionToken ?? null);
    if (options.autoConnect !== false) this.connect();
  }

  get view(): RoomView {
    return {
      roomCode: this.roomCode,
      role: this.role,
      connection: this.connectionState,
      phase: this.roomPhase,
      roster: {
        players: this.rosterPlayers,
        teams: this.rosterTeams,
        spectatorCount: this.spectatorCountState,
      },
      playerMode: this.playerModeState,
      // Null until the wire carries a census: the DO counts connections, and a store that
      // invented one would tell a host a projector was attached to a socket nobody opened
      // (room-view.ts). The `snapshot` message gains the protocol's `connectionCensus`
      // (packages/protocol/src/room/diagnostics.ts, already served by the host-authenticated
      // GET /api/rooms/<CODE>) refreshed on join/leave - tracked in docs/design/surfaces.md.
      connections: null,
      myPlayerId: this.myPlayerIdState,
      game: this.engineState,
      content: this.contentView(),
      myBuzz: this.fold.myBuzz,
      pendingTimers: this.fold.pendingTimers,
      arming: this.armingState,
      lastJudged: this.fold.lastJudged,
      wagerRange: this.fold.wagerRange,
      finalWagerRanges: this.fold.finalWagerRanges,
      paused: this.pausedState,
      settings: this.roomSettings,
      settingsKnown: this.settingsKnownState,
      refusal: this.refusalState,
    };
  }

  /** The room's last error, for surfaces that show notices (identity-locked, rate-limited). */
  get lastError(): { reason: string; detail: string | null } | null {
    return this.lastErrorState;
  }

  // --- content -----------------------------------------------------------------------------

  /**
   * The content join, assembled from the two channels the room actually has: the snapshot's
   * board material (titles + face values, static, public) and `clue-content` messages (the
   * open clue's words, already cut to this role server-side). Null until the first snapshot,
   * which is the honest "we do not know what this room is showing yet".
   */
  private contentView(): RoomContentView | null {
    const rounds = this.boardRounds;
    if (rounds === null) return null;
    const texts = this.clueTexts;
    return {
      categoryTitles: rounds.map((round) => round.categoryTitles),
      cellValues: rounds.map((round) => round.cellValues),
      clueAt: (roundIndex, category, row) => texts[clueKey(roundIndex, category, row)] ?? null,
      final: this.finalText,
    };
  }

  // --- connection lifecycle ------------------------------------------------------------------

  /** Dial (or re-dial). Safe to call when already connected; it does nothing then. */
  connect(): void {
    if (this.done || this.socket !== null) return;
    const url =
      this.options.origin === undefined
        ? roomWebSocketUrl(this.roomCode)
        : roomWebSocketUrl(this.roomCode, this.options.origin);
    this.socketOpen = false;
    this.socket = this.connectSocket(url, {
      onOpen: () => {
        this.handleOpen();
      },
      onMessage: (data) => {
        this.handleFrame(data);
      },
      onClose: (code) => {
        this.handleClose(code);
      },
    });
  }

  private handleOpen(): void {
    this.socketOpen = true;
    this.reconnectAttempt = 0;
    this.connectionState = "connected";
    // The room says nothing first: our opening move is resume (this tab already had a seat),
    // or join. A player with neither waits on the pre-game screen until they press Join.
    if (this.sessionToken !== null) {
      this.sendMessage({ type: "resume", sessionToken: this.sessionToken });
      return;
    }
    if (this.role === "player") {
      if (this.pendingJoin !== null) this.sendJoin(this.pendingJoin);
      return;
    }
    this.sendJoin(null);
  }

  private handleClose(code: number): void {
    this.socket = null;
    this.socketOpen = false;
    if (this.done) {
      this.connectionState = "closed";
      return;
    }
    if (isTerminalCloseCode(code)) {
      // 4404/4401/4403/4409: the room turned this connection away for a reason it already
      // sent as `refused`. Coming back would only be refused again.
      this.done = true;
      this.connectionState = "closed";
      return;
    }
    this.connectionState = "reconnecting";
    const delay =
      this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ??
      1000;
    this.reconnectAttempt += 1;
    this.reconnectHandle = setTimeout(() => {
      this.reconnectHandle = null;
      this.connect();
    }, delay);
  }

  private sendMessage(payload: Record<string, unknown>): void {
    if (this.socket === null || !this.socketOpen) return;
    this.socket.send(JSON.stringify({ version: protocolVersion, ...payload }));
  }

  private sendJoin(request: JoinRequest | null): void {
    const hostToken = this.options.hostToken ?? null;
    this.sendMessage({
      type: "join",
      role: this.role,
      ...(request !== null && { nickname: request.nickname }),
      // Curated ids are omitted rather than nulled: the join schema takes "not chosen" as
      // absence, and a skin tone especially must never be sent as a value nobody picked.
      ...(request?.avatarId != null && { avatarId: request.avatarId }),
      ...(request?.accentId != null && { accentId: request.accentId }),
      ...(request?.buzzSoundId != null && { buzzSoundId: request.buzzSoundId }),
      ...(request?.skinToneId != null && { skinToneId: request.skinToneId }),
      ...(request?.team !== undefined && { team: request.team }),
      ...(hostToken !== null && hostToken !== "" && { hostToken }),
    });
  }

  /** An engine action relay: no `at`, no actor - the DO stamps both (authority.ts). */
  private sendAction(action: Record<string, unknown>): void {
    this.sendMessage({ type: "action", action });
  }

  // --- incoming ------------------------------------------------------------------------------

  private handleFrame(data: string): void {
    const parsed = parseRoomServerMessage(data);
    if (!parsed.ok) {
      // A frame this build cannot read is the server's news, not a crash: record it and keep
      // the room on screen. Version skew is the case that matters and it earns its own notice.
      this.lastErrorState = { reason: parsed.reason, detail: parsed.detail };
      return;
    }
    this.apply(parsed.message);
  }

  /** Exported through handleFrame; separate so the suite can feed messages without a socket. */
  apply(message: RoomServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.myPlayerIdState = message.playerId;
        // Host/display/spectator connections are welcomed with a null token - they hold no
        // seat and re-join by URL - so this must not overwrite a player's token with null on
        // some other role's welcome, which only ever arrives on its own connection anyway.
        this.sessionToken = message.sessionToken;
        this.options.onSessionToken?.(message.sessionToken);
        this.connectionState = "connected";
        this.refusalState = null;
        return;
      case "refused":
        this.refusalState = { reason: message.reason, at: this.now() };
        if (message.reason === "bad-session-token") {
          // This device's seat is gone (the room restarted, or the seat was kicked). Drop the
          // credential so the next dial is a fresh join rather than the same doomed resume,
          // and let the pre-game screen ask for a name again (user-flows A5).
          this.sessionToken = null;
          this.myPlayerIdState = null;
          this.options.onSessionToken?.(null);
        }
        return;
      case "snapshot":
        this.applySnapshot(message);
        return;
      case "event":
        this.applyEventBatch(message);
        return;
      case "arm-window":
        // FIRST, ahead of the state write below and ahead of anything a surface will render:
        // the reply time IS this connection's round-trip measurement, so work done before it
        // is measured as latency that is not there. The arming's own paint time is stamped
        // later, by the surface, once the hot button is actually on screen.
        this.sendMessage({ type: "arm-ack", armId: message.arm.armId });
        this.armingState = {
          armId: message.arm.armId,
          compensationMs: message.arm.compensationMs,
          rebound: message.arm.rebound,
          paintedAt: null,
        };
        return;
      case "buzz-won":
        this.noteVersion(message.stateVersion);
        this.applyEvents(
          [
            {
              type: "buzz-won",
              playerId: message.playerId,
              entityId: message.entityId,
              at: message.at,
            },
          ],
          this.engineState?.phase ?? null,
        );
        this.options.onBuzzWon?.({
          playerId: message.playerId,
          entityId: message.entityId,
          buzzSoundId: message.buzzSoundId,
        });
        return;
      case "buzz-rejected":
        if (message.reason === "unknown-player") return;
        this.fold = {
          ...this.fold,
          myBuzz: {
            status: "rejected",
            reason: message.reason,
            lockedUntil: message.lockedUntil,
          },
        };
        return;
      case "roster":
        this.applyRoster(message.roster);
        return;
      case "clue-content":
        this.applyClueContent(message.content);
        return;
      case "paused":
        this.pausedState = message.paused;
        return;
      case "room-settings":
        this.roomSettings = message.settings;
        this.settingsKnownState = true;
        return;
      case "room-closed":
        // Every reason ends this connection; the surfaces read the refusal-free "closed" state
        // plus the room phase. A kick is the one that is only ever sent to one phone.
        this.done = true;
        this.connectionState = "closed";
        this.roomPhase = message.reason === "kicked" ? this.roomPhase : "ended";
        if (message.reason === "kicked") {
          this.myPlayerIdState = null;
          this.sessionToken = null;
          this.options.onSessionToken?.(null);
        }
        return;
      case "error":
        this.lastErrorState = { reason: message.reason, detail: message.detail ?? null };
        return;
    }
  }

  private applySnapshot(message: Extract<RoomServerMessage, { type: "snapshot" }>): void {
    this.stateVersion = message.stateVersion;
    this.roomPhase = message.phase;
    this.engineState = message.game as GameState | null;
    this.playerModeState = message.playerMode;
    this.boardRounds = message.board.rounds;
    this.pausedState = message.paused;
    this.applyRoster(message.roster);
    if (message.clueContent !== null) this.applyClueContent(message.clueContent);
    // A snapshot re-founds the ephemeral layer on the state it describes. A stale buzz verdict
    // from before a reconnect would show the wrong ring, so everything derived from events is
    // dropped - except the clocks, which the room now reports (`timers`, remaining ms). Those
    // are the one part a returning client genuinely cannot rebuild: `timer-set` went out while
    // it was away, and a console reopened mid-answer used to show no countdown at all
    // (user-flows C6). Pruned by phase as well, because a timer no phase can be waiting on is
    // a phantom whichever end produced it.
    //
    // The arming resets with it. If one is still open the room re-sends `arm-window` right
    // after this snapshot (game-room-do.ts does it on join and on resume), so a phone that
    // slept through the arm is measured afresh and can still race.
    const phase = (message.game as GameState | null)?.phase ?? null;
    const timers = pendingTimersFromRoom(message.timers, this.now());
    this.armingState = null;
    this.fold =
      phase === null
        ? emptyFold()
        : { ...emptyFold(), pendingTimers: prunePendingTimers(timers, phase) };
  }

  private applyEventBatch(message: Extract<RoomServerMessage, { type: "event" }>): void {
    const gapped = this.stateVersion >= 0 && message.stateVersion > this.stateVersion + 1;
    this.noteVersion(message.stateVersion);
    const state = message.game as GameState | null;
    if (state !== null) this.engineState = state;
    if (state?.phase === "game-over") this.roomPhase = "ended";
    if (state !== null && this.roomPhase === "lobby" && state.phase !== "lobby") {
      // The room's own phase follows the engine's: `game-started` is what moves every phone
      // off the pre-game surface at once (pre-game.ts playerSurfaceFor).
      this.roomPhase = "active";
    }
    const events = message.events as GameEvent[];
    this.applyEvents(events, state?.phase ?? null);
    for (const event of events) this.options.onEvent?.(event);
    if (gapped) {
      // We missed at least one batch. The state on this message is current, but the events we
      // never saw are gone for good - so ask for the authoritative picture rather than trust a
      // fold that skipped a step.
      this.sendMessage({ type: "sync" });
    }
  }

  private noteVersion(version: number): void {
    if (version > this.stateVersion) this.stateVersion = version;
  }

  private applyEvents(events: readonly GameEvent[], phase: GameState["phase"] | null): void {
    let folded = this.fold;
    const at = this.now();
    for (const event of events) {
      folded = foldEvent(folded, event, { myPlayerId: this.myPlayerIdState, at });
    }
    if (phase !== null) {
      folded = { ...folded, pendingTimers: prunePendingTimers(folded.pendingTimers, phase) };
    }
    this.fold = folded;
  }

  private applyRoster(roster: RosterPayload): void {
    // Absent stays null rather than becoming 0: the field is optional so that a producer which
    // cannot count an audience is distinguishable from a room nobody is watching (roster.ts).
    // The DO always counts, so in practice this is null only before the first roster lands.
    this.spectatorCountState = roster.spectatorCount ?? null;
    this.rosterPlayers = roster.players.map(toPlayerView);
    this.rosterTeams = roster.teams.map((team) => ({
      teamId: team.teamId,
      name: team.name,
      colorId: team.colorId,
      buzzSoundId: team.buzzSoundId,
      leaderPlayerId: team.leaderPlayerId,
      locked: team.locked,
    }));
  }

  private applyClueContent(content: ClueContent): void {
    const view = toClueContentView(content);
    if (content.target.kind === "final") {
      this.finalText = view;
      return;
    }
    const key = clueKey(content.target.roundIndex, content.target.category, content.target.row);
    this.clueTexts = { ...this.clueTexts, [key]: view };
  }

  // --- membership ------------------------------------------------------------------------------

  join(request: JoinRequest): void {
    // Kept whatever happens next: a refused team, a dropped socket, or a room that was full a
    // moment ago all end with this phone wanting the same seat.
    this.pendingJoin = request;
    this.refusalState = null;
    this.sendJoin(request);
  }

  leave(): void {
    this.sendMessage({ type: "leave" });
    this.pendingJoin = null;
    this.myPlayerIdState = null;
    this.sessionToken = null;
    this.options.onSessionToken?.(null);
  }

  updateIdentity(patch: IdentityPatch): void {
    this.sendMessage({ type: "identity-update", ...patch });
  }

  createTeam(name: string): void {
    this.refusalState = null;
    this.sendMessage({ type: "team-create", name });
  }

  joinTeam(teamId: string): void {
    // One message whether this is a first board or a move: the room replaces the session's
    // teamId either way, so nobody is ever briefly teamless.
    this.refusalState = null;
    this.sendMessage({ type: "team-join", teamId });
  }

  assignPlayerToTeam(playerId: string, teamId: string): void {
    // The host seating SOMEBODY ELSE, on the same message a phone moves itself with: `playerId`
    // is the host-only field the DO added for exactly this (client-messages.ts team-join, and
    // handleTeamJoin refuses it from anybody but the host). A lock does not apply - it refuses
    // joiners, and the host out-ranks it.
    this.refusalState = null;
    this.sendMessage({ type: "team-join", teamId, playerId });
  }

  leaveTeam(): void {
    this.refusalState = null;
    this.sendMessage({ type: "team-leave" });
  }

  updateTeam(patch: TeamPatch, teamId?: string): void {
    // Leaders omit the id (their own team is unambiguous); the host must name the team.
    this.sendMessage({ type: "team-update", ...patch, ...(teamId !== undefined && { teamId }) });
  }

  kickFromTeam(playerId: string): void {
    this.sendMessage({ type: "team-kick", playerId });
  }

  handOffLeadership(playerId: string): void {
    this.sendMessage({ type: "team-handoff", playerId });
  }

  renamePlayer(playerId: string, nickname: string): void {
    this.sendMessage({ type: "rename-player", playerId, nickname });
  }

  kickFromRoom(playerId: string): void {
    this.sendMessage({ type: "kick-player", playerId });
  }

  // --- play (phone side) -------------------------------------------------------------------

  markArmedPainted(armId: number): void {
    const arming = this.armingState;
    // Idempotent, and only ever for the arming currently open: the FIRST paint is t0, and a
    // later frame (a re-render, a coarse clock tick) must not move the clock forward under a
    // player who has been staring at a hot button for a second already.
    if (arming === null || arming.armId !== armId || arming.paintedAt !== null) return;
    this.armingState = { ...arming, paintedAt: this.now() };
  }

  buzz(): void {
    const at = this.now();
    // Optimistic pending on the press (the pointerdown feedback contract), set BEFORE the send
    // so the presser's own confirmation never waits on anything. The room may hold the
    // announcement for up to `arming.compensationMs` while it ranks the field; it never holds
    // this.
    this.fold = { ...this.fold, myBuzz: { status: "pending", at } };
    const arming = this.armingState;
    if (arming === null || arming.paintedAt === null) {
      // No arming, or one this surface never painted: send no claim at all rather than a
      // number measured from the wrong thing. The room ranks an unstamped buzz by arrival.
      this.sendAction({ type: "buzz" });
      return;
    }
    this.sendMessage({
      type: "action",
      action: { type: "buzz" },
      timing: {
        armId: arming.armId,
        // Reaction time: paint -> press, on this device's own clock, both ends measured here.
        // Clamped to the schema's range (actionTimingSchema) so a clock that jumped backwards
        // during the clue costs the buzz its compensation rather than the whole frame.
        elapsedMs: Math.min(60_000, Math.max(0, Math.round(at - arming.paintedAt))),
      },
    });
  }

  commitWager(amount: number): void {
    this.sendAction({ type: "commit-wager", amount });
  }

  commitFinalWager(amount: number): void {
    this.sendAction({ type: "commit-final-wager", amount });
  }

  submitFinalAnswer(text: string): void {
    // Everyone-answers and the final are different actions on the same button; the phase the
    // room is in decides which one this is.
    const phase = this.engineState?.phase;
    if (phase === "all-answering") {
      this.sendAction({ type: "submit-typed-answer", text });
      return;
    }
    this.sendAction({ type: "submit-final-answer", text });
  }

  // --- host verbs -------------------------------------------------------------------------

  startGame(): void {
    // The DO seats the roster from its own copy first, in join order, then starts.
    this.sendAction({ type: "start-game" });
  }

  selectCell(category: number, row: number): void {
    this.sendAction({ type: "select-cell", category, row });
  }

  armBuzzers(): void {
    this.sendAction({ type: "arm-buzzers" });
  }

  judge(verdict: Verdict): void {
    this.sendAction({ type: "judge", verdict });
  }

  judgeEntity(entityId: string, verdict: "correct" | "wrong"): void {
    this.sendAction({ type: "judge-entity", entityId, verdict });
  }

  hostAward(entityId: string, verdict: "correct" | "wrong"): void {
    this.sendAction({ type: "host-award", entityId, verdict });
  }

  hostCommitWager(entityId: string, amount: number): void {
    // entityId is advisory: the engine binds a wager to the clue's selector, and the host is
    // exempt from the transport's "prove you are that entity" check (engine-glue.ts).
    void entityId;
    this.sendAction({ type: "commit-wager", amount });
  }

  closeBuzzWindow(): void {
    this.sendAction({ type: "buzz-timeout" });
  }

  closeAnswers(): void {
    this.sendAction({ type: "close-answers" });
  }

  cancelClue(): void {
    this.sendAction({ type: "cancel-clue" });
  }

  reopenCell(category: number, row: number): void {
    this.sendAction({ type: "reopen-cell", category, row });
  }

  scoreAdjust(entityId: string, delta: number): void {
    this.sendAction({ type: "score-adjust", entityId, delta });
  }

  scoreSet(entityId: string, score: number): void {
    this.sendAction({ type: "score-set", entityId, score });
  }

  undo(): void {
    this.sendAction({ type: "undo" });
  }

  proceed(): void {
    this.sendAction({ type: "proceed" });
  }

  endRound(): void {
    this.sendAction({ type: "end-round" });
  }

  tiebreakerNextClue(): void {
    this.sendAction({ type: "tiebreaker-next-clue" });
  }

  setPaused(paused: boolean): void {
    // A ROOM message, not an engine action: the engine has no pause concept, so the room parks
    // its alarm book and tells everyone (client-messages.ts set-pause).
    this.sendMessage({ type: "set-pause", paused });
  }

  updateRoomSettings(patch: RoomSettingsPatch): void {
    this.sendMessage({ type: "update-room-settings", settings: patch });
  }

  expireTimer(kind?: TimerKind): void {
    // The DO fires whichever timer the room is actually waiting on - a client naming a kind
    // would be a client claiming to know the room's clock, which it does not.
    void kind;
    this.sendMessage({ type: "expire-timer" });
  }

  destroy(): void {
    this.done = true;
    if (this.reconnectHandle !== null) clearTimeout(this.reconnectHandle);
    this.reconnectHandle = null;
    this.socket?.close(1000, "surface closed");
    this.socket = null;
    this.socketOpen = false;
  }
}
