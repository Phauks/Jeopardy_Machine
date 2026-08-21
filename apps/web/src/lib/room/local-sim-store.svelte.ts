// The local-sim room store: the complete RoomStore implementation with no server - the
// engine's transition() is the room logic, the fixtures/ dummy dataset is the room's
// material, and timers run client-side (this store plays the role the DO's alarms play in
// production, exactly like /dev/hotseat's expiry key, but automatic). It is the default
// store while M3 lands and stays forever as the sim-panel backend and the rehearse-mode
// core (user-flows B4).
//
// Room tier vs engine tier (mirrors the M3 split in packages/protocol/src/room/roster.ts):
// the roster (identity, teams, leadership) lives HERE and never in engine state; the engine
// only learns seats at start-game. Roster edits in the lobby need no engine actions.
import { teamsAreRequired } from "@jeopardy/protocol/settings/player-mode";
import { createInitialState } from "@jeopardy/engine/state";
import { transition } from "@jeopardy/engine/transition";
import { defaultLiveRules, liveRulesOfSettings } from "@jeopardy/protocol/room/live-rules";
import { defaultRoomSettings } from "@jeopardy/protocol/room/room-settings";
import { limits } from "@jeopardy/protocol/limits";
import { foldEvent, prunePendingTimers } from "#lib/room/room-fold.ts";
import { fixtureContentView, fixtureGameSetup, fixtureRosterView } from "#lib/room/fixture-room.ts";
import type { GameAction, Verdict } from "@jeopardy/engine/actions";
import type { GameEvent, TimerKind } from "@jeopardy/engine/events";
import type { GameSetup } from "@jeopardy/engine/setup";
import type { GameState } from "@jeopardy/engine/state";
import type { LiveRules, LiveRulesPatch } from "@jeopardy/protocol/room/live-rules";
import type { RoomSettings, RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
import type { RoomFoldState } from "#lib/room/room-fold.ts";
import type {
  IdentityPatch,
  JoinRequest,
  RoomBuzz,
  RoomStore,
  TeamPatch,
} from "#lib/room/room-store.ts";
import type {
  LastJudgedView,
  MyBuzzView,
  RoomConnectionState,
  PendingTimerView,
  RoomPlayerView,
  RoomRefusalView,
  RoomRoleView,
  RoomTeamView,
  RoomView,
  WagerRangeView,
} from "#lib/room/room-view.ts";

export type LocalSimStoreOptions = {
  roomCode: string;
  role: RoomRoleView;
  /** Engine seed - the same seed and taps replay the identical mock game. */
  seed?: string;
  /**
   * Drive engine timer hints with real client-side setTimeout. Off by default so tests and
   * SSR never leak timers; the routes turn it on in the browser.
   */
  timerAutopilot?: boolean;
  /** Start with the 30-player/6-team dummy roster (default) or an empty room. */
  seedRoster?: "fixture" | "empty";
  /** Tap into every engine event - the display's diorama beats ride this. */
  onEvent?: (event: GameEvent) => void;
  /**
   * Room audio: once per arming, with the room-audible sound already resolved TEAM-first (the
   * double-confirmation directive). The real room resolves this server-side and ships it on
   * the buzz-won message; the mock applies the same rule to its own roster here, so no surface
   * has to know which store it is talking to in order to make a noise.
   */
  onBuzzWon?: (buzz: RoomBuzz) => void;
  /**
   * The room's own settings, sparse over the protocol defaults. Mock rooms are created by
   * opening a URL rather than by POST /api/rooms, so this is where a surface review (or a
   * test) says "this room is in streamer mode" or "this room allows no spectators".
   */
  settings?: Partial<RoomSettings>;
};

/** TimerKind -> the expiry action the driver owes the engine (events.ts documents the map). */
function expiryActionFor(kind: TimerKind, at: number): GameAction {
  switch (kind) {
    case "auto-arm":
      return { type: "arm-buzzers", at };
    case "selection-shot-clock":
      return { type: "selection-timeout", at };
    case "buzz-window":
      return { type: "buzz-timeout", at };
    case "answer-window":
    case "everyone-answers-window":
      return { type: "answer-timeout", at };
    case "wager-entry":
      return { type: "wager-timeout", at };
    case "final-wager":
      return { type: "final-wager-timeout", at };
    case "final-writing":
      return { type: "final-writing-timeout", at };
    case "round-time-limit":
      return { type: "round-timeout", at };
  }
}

let localSeatCounter = 0;

export class LocalSimRoomStore implements RoomStore {
  readonly mode = "local-sim" as const;

  private readonly roomCode: string;
  private readonly role: RoomRoleView;
  // NOT readonly since 2026-08-20: a host can retune the answering loop live
  // (updateGameRules), and the mock applies the patch to its own setup so the sim demonstrates
  // the real consequence rather than a moved readout. Everything the running STATE was built
  // from is still frozen - that is enforced by the patch schema, not by this field.
  private setup: GameSetup;
  private readonly content: ReturnType<typeof fixtureContentView>;
  private readonly onEvent: ((event: GameEvent) => void) | undefined;
  private readonly onBuzzWon: ((buzz: RoomBuzz) => void) | undefined;
  private readonly timerAutopilot: boolean;
  private readonly timerHandles = new Map<TimerKind, ReturnType<typeof setTimeout>>();

  // $state.raw for the engine state: transitions return fresh immutable objects, wholesale
  // reassignment is the reactivity model (same pattern as /dev/hotseat).
  private engineState = $state.raw<GameState | null>(null);
  private rosterPlayers = $state.raw<RoomPlayerView[]>([]);
  private rosterTeams = $state.raw<RoomTeamView[]>([]);
  private roomPhase = $state<"lobby" | "active" | "ended">("lobby");
  private myPlayerId = $state<string | null>(null);
  private myBuzz = $state.raw<MyBuzzView>({ status: "idle" });
  private pendingTimers = $state.raw<PendingTimerView[]>([]);
  private lastJudged = $state.raw<LastJudgedView | null>(null);
  private wagerRange = $state.raw<WagerRangeView | null>(null);
  private finalWagerRanges = $state.raw<WagerRangeView[]>([]);
  private pausedState = $state(false);
  private roomSettings = $state.raw<RoomSettings>({
    ...defaultRoomSettings,
    title: "",
    hostLabel: "",
  });
  private refusalState = $state.raw<RoomRefusalView | null>(null);
  // The non-player connections the sim is pretending exist: a projector plugged in, an audience
  // watching. Players are counted from the roster instead, because the sim already tracks their
  // connectedness (simSetConnected) and a seat outlives a dropped phone.
  private simDisplays = $state(0);
  // NULL until the sim panel plugs one in, and that is the difference between "nobody is
  // watching" and "nothing has told me" (room-view.ts, `spectatorCount`): the census below
  // counts the sockets this simulated room actually has, and the roster reports only what the
  // room has been told to claim.
  private simSpectators = $state<number | null>(null);
  // A mock room has no socket, so "connected" is a claim rather than an observation - and it
  // is the right claim until something closes the room. `closeRoom` moves it, so the console's
  // close control demonstrates the state a real close leaves behind instead of being a dead
  // button in the sim (room-view.ts, RoomConnectionState).
  private simConnection = $state<RoomConnectionState>("connected");
  // The mock room's rules, and a REAL projection of the setup it is running rather than the
  // registry defaults: the sim resolves its own rule set (this.setup below), so a demo of a
  // game whose rules say "no penalty for wrong" must show that on the console rather than the
  // default deduct. `updateGameRules` moves it exactly as the room's broadcast moves the ws
  // store's copy.
  private simRules = $state.raw<LiveRules>(defaultLiveRules);

  constructor(options: LocalSimStoreOptions) {
    this.roomCode = options.roomCode;
    this.role = options.role;
    this.setup = fixtureGameSetup(options.seed ?? `mock-${options.roomCode}`);
    this.simRules = liveRulesOfSettings(this.setup.settings);
    // Responses exist only in host-role stores - the redaction the M3 server performs is
    // reproduced here so mirror mode and phones are honest even in mock play.
    this.content = fixtureContentView(options.role === "host");
    this.onEvent = options.onEvent;
    this.onBuzzWon = options.onBuzzWon;
    this.roomSettings = { ...this.roomSettings, ...options.settings };
    this.timerAutopilot = options.timerAutopilot ?? false;
    if ((options.seedRoster ?? "fixture") === "fixture") {
      const seeded = fixtureRosterView();
      this.rosterPlayers = seeded.players;
      this.rosterTeams = seeded.teams;
    }
  }

  get view(): RoomView {
    return {
      roomCode: this.roomCode,
      role: this.role,
      connection: this.simConnection,
      rules: this.simRules,
      phase: this.roomPhase,
      roster: {
        players: this.rosterPlayers,
        teams: this.rosterTeams,
        // NULL, not 0, until something says otherwise. A mock room is one tab
        // (docs/design/surfaces.md "Known gaps"): a spectator would be a separate simulation in
        // another tab, so an untold store cannot know whether anyone is watching, and "0
        // watching" would be the console inventing a number about a room it cannot see. The sim
        // panel's "audience" control is the one thing that can tell it, and then the roster and
        // the census below report the SAME number rather than disagreeing on one screen.
        spectatorCount: this.simSpectators,
      },
      playerMode: this.setup.settings.teams.playerMode,
      myPlayerId: this.myPlayerId,
      game: this.engineState,
      content: this.content,
      myBuzz: this.myBuzz,
      pendingTimers: this.pendingTimers,
      // No arming window: this store IS the adjudicator and it crowns a winner in the same tick
      // as the press, so there is nothing to hold and no round trip to measure (contrast the ws
      // store, where the room holds the race briefly to rank it by reaction time).
      arming: null,
      lastJudged: this.lastJudged,
      wagerRange: this.wagerRange,
      finalWagerRanges: this.finalWagerRanges,
      // The census the DO would count (packages/protocol/src/room/diagnostics.ts). The sim can
      // justify every number here: one host connection (this console, or the one the simulated
      // room implies), players from the roster's own connectedness, and displays/spectators from
      // what the sim panel has been told to pretend. Crucially it does NOT count a display
      // window the host opened beside this tab: in mock mode that window is a different isolated
      // room, and the console's own window handle is what answers for it (game-screen.ts).
      connections: {
        total: 1 + this.connectedPlayerCount + this.simDisplays + (this.simSpectators ?? 0),
        host: 1,
        player: this.connectedPlayerCount,
        display: this.simDisplays,
        spectator: this.simSpectators ?? 0,
        unjoined: 0,
      },
      paused: this.pausedState,
      settings: this.roomSettings,
      // This store IS the room it describes: its settings are the ones in force, whether they
      // came from the constructor or from a host edit. Nothing is pending arrival, so nothing
      // needs to be reported as unknown (contrast ws-room-store.ts, which starts blind).
      settingsKnown: true,
      refusal: this.refusalState,
    };
  }

  private get connectedPlayerCount(): number {
    return this.rosterPlayers.filter((player) => player.connected).length;
  }

  // --- engine dispatch + event fan-out ---------------------------------------------------

  private dispatch(action: GameAction): void {
    const state = this.engineState ?? createInitialState(this.setup);
    const result = transition(state, action, this.setup);
    this.engineState = result.state;
    this.applyEvents(result.events, action.at, result.state.phase);
    for (const event of result.events) {
      this.onEvent?.(event);
      // Resolved TEAM-first, exactly as the DO resolves it before putting it on the wire.
      if (event.type === "buzz-won") {
        const team = this.rosterTeams.find((entry) => entry.teamId === event.entityId);
        const player = this.rosterPlayers.find((entry) => entry.playerId === event.playerId);
        this.onBuzzWon?.({
          playerId: event.playerId,
          entityId: event.entityId,
          buzzSoundId: team !== undefined ? team.buzzSoundId : (player?.buzzSoundId ?? null),
        });
      }
    }
    if (result.state.phase === "game-over") this.roomPhase = "ended";
  }

  /**
   * Fold a batch through the SHARED reducer (room-fold.ts) and reconcile the client-side
   * clock with the result: this store owns real setTimeout handles (it plays the DO's alarm
   * book), so every timer the fold added needs one and every timer the fold dropped needs its
   * handle cleared. The fold itself is identical to the ws store's - one implementation of
   * "what does this event mean", two ways of knowing what time it is.
   */
  private applyEvents(events: readonly GameEvent[], at: number, phase: GameState["phase"]): void {
    const before = this.foldState();
    let folded = before;
    for (const event of events) {
      folded = foldEvent(folded, event, { myPlayerId: this.myPlayerId, at });
    }
    const pruned = prunePendingTimers(folded.pendingTimers, phase);
    for (const timer of before.pendingTimers) {
      if (pruned.some((entry) => entry.kind === timer.kind)) continue;
      const handle = this.timerHandles.get(timer.kind);
      if (handle !== undefined) clearTimeout(handle);
      this.timerHandles.delete(timer.kind);
    }
    this.myBuzz = folded.myBuzz;
    this.lastJudged = folded.lastJudged;
    this.wagerRange = folded.wagerRange;
    this.finalWagerRanges = folded.finalWagerRanges;
    this.pendingTimers = pruned;
    for (const timer of pruned) {
      // firesAt, not kind: a rebound re-sets the buzz window while one is already pending, and
      // keeping the first handle would fire the new window on the old deadline.
      const unchanged = before.pendingTimers.some(
        (entry) => entry.kind === timer.kind && entry.firesAt === timer.firesAt,
      );
      if (!unchanged) this.scheduleTimer(timer);
    }
  }

  private foldState(): RoomFoldState {
    return {
      myBuzz: this.myBuzz,
      pendingTimers: this.pendingTimers,
      lastJudged: this.lastJudged,
      wagerRange: this.wagerRange,
      finalWagerRanges: this.finalWagerRanges,
    };
  }

  // --- client-side timers (the DO-alarm stand-in) ----------------------------------------

  private scheduleTimer(timer: PendingTimerView): void {
    if (!this.timerAutopilot || this.pausedState) return;
    const existing = this.timerHandles.get(timer.kind);
    if (existing !== undefined) clearTimeout(existing);
    this.timerHandles.set(
      timer.kind,
      setTimeout(() => {
        this.fireTimer(timer.kind);
      }, timer.durationMs),
    );
  }

  private fireTimer(kind: TimerKind): void {
    this.timerHandles.delete(kind);
    const pending = this.pendingTimers.find((entry) => entry.kind === kind);
    if (pending === undefined) return;
    this.pendingTimers = this.pendingTimers.filter((entry) => entry.kind !== kind);
    // A stale expiry (undo, faster action) is a harmless engine rejection by design.
    this.dispatch(expiryActionFor(kind, Date.now()));
  }

  private clearTimers(): void {
    for (const handle of this.timerHandles.values()) clearTimeout(handle);
    this.timerHandles.clear();
    this.pendingTimers = [];
  }

  expireTimer(kind?: TimerKind): void {
    const target = kind ?? this.pendingTimers.at(-1)?.kind;
    if (target !== undefined) this.fireTimer(target);
  }

  /**
   * The host's room-settings edit, mock-side. Applied with the DO's own two refusals
   * (packages/protocol/src/room/room-settings.ts): a public room needs a title, and a cap never
   * drops below the people already in the room - because nobody is ever ejected by a settings
   * change. Every field is applied verbatim, which a mock can only do because none of them is
   * a secret the room would have to keep (room-settings.ts).
   */
  updateRoomSettings(patch: RoomSettingsPatch): void {
    const next: RoomSettings = { ...this.roomSettings };
    if (patch.listing !== undefined) next.listing = patch.listing;
    if (patch.title !== undefined) next.title = patch.title;
    if (patch.hostLabel !== undefined) next.hostLabel = patch.hostLabel;
    if (patch.maxPlayers !== undefined) next.maxPlayers = patch.maxPlayers;
    if (patch.maxSpectators !== undefined) next.maxSpectators = patch.maxSpectators;
    if (patch.spectatorsAllowed !== undefined) next.spectatorsAllowed = patch.spectatorsAllowed;
    if (patch.hideJoinCode !== undefined) next.hideJoinCode = patch.hideJoinCode;
    if (next.listing === "public" && next.title.trim().length === 0) return;
    if (next.maxPlayers < this.rosterPlayers.length) return;
    this.roomSettings = next;
  }

  setPaused(paused: boolean): void {
    if (paused === this.pausedState) return;
    this.pausedState = paused;
    if (paused) {
      // Freeze: drop the real handles but keep pendingTimers so resume can reschedule with
      // their remaining time measured from now (close enough for a host pause).
      for (const handle of this.timerHandles.values()) clearTimeout(handle);
      this.timerHandles.clear();
    } else if (this.timerAutopilot) {
      const now = Date.now();
      for (const timer of this.pendingTimers) {
        const remaining = Math.max(500, timer.firesAt - now);
        this.timerHandles.set(
          timer.kind,
          setTimeout(() => {
            this.fireTimer(timer.kind);
          }, remaining),
        );
      }
    }
  }

  destroy(): void {
    this.clearTimers();
  }

  // --- roster tier (no engine involvement until start) -----------------------------------

  /** Identity edits are locked during the armed/answering window (user-flows guardrail). */
  private identityLocked(): boolean {
    const phase = this.engineState?.phase;
    return (
      phase === "armed" ||
      phase === "answering" ||
      phase === "tiebreaker-armed" ||
      phase === "tiebreaker-answering"
    );
  }

  /**
   * The room's door, mock-side. The refusals below are the SAME reasons and the same order the
   * DO applies (apps/realtime/src/game-room-do.ts): the two participant budgets are
   * independent, and a spectator is refused for its own reason so the screen can say which of
   * "the audience is full" and "this host allows no audience" happened. A refused join changes
   * nothing about the room - the phone keeps its connection and its choices.
   */
  private refuse(reason: RoomRefusalView["reason"]): void {
    this.refusalState = { reason, at: Date.now() };
  }

  /**
   * Put this mock connection in a refused state on purpose - the sim panel's refusal probes and
   * the surface tests both need to SEE the screens a real room's refusals produce, and a mock
   * room never produces them on its own (one tab, no cap it enforces, nobody to turn away).
   */
  simRefuse(reason: RoomRefusalView["reason"]): void {
    this.refuse(reason);
  }

  join(request: JoinRequest): void {
    const settings = this.roomSettings;
    if (this.role === "spectator") {
      if (!settings.spectatorsAllowed) return this.refuse("spectators-not-allowed");
      // Spectators hold no roster seat, so the mock has nothing to count them with; the budget
      // itself is the DO's to enforce against live connections.
    } else if (this.rosterPlayers.length >= settings.maxPlayers) {
      return this.refuse("room-full");
    }
    this.refusalState = null;
    localSeatCounter += 1;
    const playerId = `local-${String(localSeatCounter)}`;
    let teamId: string | null = null;
    if (request.team !== undefined) {
      if (request.team.kind === "create") {
        teamId = `team-local-${String(localSeatCounter)}`;
        this.rosterTeams = [
          ...this.rosterTeams,
          {
            teamId,
            name: request.team.name,
            colorId: request.accentId,
            buzzSoundId: request.buzzSoundId,
            leaderPlayerId: playerId,
            locked: false,
          },
        ];
      } else {
        const requestedTeamId = request.team.teamId;
        const team = this.rosterTeams.find((entry) => entry.teamId === requestedTeamId);
        // TEAM-level refusals keep the socket (server-messages.ts): the phone stays in the
        // room and picks another card, which is why the seat is not taken above this line.
        if (team === undefined) return this.refuse("unknown-team");
        if (team.locked) return this.refuse("team-locked");
        teamId = team.teamId;
      }
    }
    this.rosterPlayers = [
      ...this.rosterPlayers,
      {
        playerId,
        nickname: request.nickname,
        avatarId: request.avatarId,
        accentId: request.accentId,
        buzzSoundId: request.buzzSoundId,
        skinToneId: request.skinToneId,
        teamId,
        connected: true,
        joinedAt: Date.now(),
      },
    ];
    this.myPlayerId = playerId;
    // Late join (setting #43): a mid-game join also takes an engine seat immediately.
    if (this.roomPhase === "active" && this.engineState !== null) {
      this.dispatchJoinFor(playerId);
    }
  }

  leave(): void {
    if (this.myPlayerId === null) return;
    const leavingId = this.myPlayerId;
    this.removeFromRoster(leavingId);
    this.myPlayerId = null;
    if (this.engineState !== null && this.roomPhase === "active") {
      this.dispatch({ type: "player-leave", at: Date.now(), playerId: leavingId });
    }
  }

  private removeFromRoster(playerId: string): void {
    this.rosterPlayers = this.rosterPlayers.filter((entry) => entry.playerId !== playerId);
    // Leadership succession: longest-tenured remaining member inherits (user-flows rule).
    this.rosterTeams = this.rosterTeams.map((team) => {
      if (team.leaderPlayerId !== playerId) return team;
      const members = this.rosterPlayers
        .filter((entry) => entry.teamId === team.teamId)
        .toSorted((left, right) => left.joinedAt - right.joinedAt);
      return { ...team, leaderPlayerId: members[0]?.playerId ?? null };
    });
  }

  updateIdentity(patch: IdentityPatch): void {
    if (this.myPlayerId === null || this.identityLocked()) return;
    const myPlayerId = this.myPlayerId;
    this.rosterPlayers = this.rosterPlayers.map((player) =>
      player.playerId === myPlayerId
        ? {
            ...player,
            nickname: patch.nickname ?? player.nickname,
            avatarId: patch.avatarId !== undefined ? patch.avatarId : player.avatarId,
            accentId: patch.accentId !== undefined ? patch.accentId : player.accentId,
            buzzSoundId: patch.buzzSoundId !== undefined ? patch.buzzSoundId : player.buzzSoundId,
            skinToneId: patch.skinToneId !== undefined ? patch.skinToneId : player.skinToneId,
          }
        : player,
    );
  }

  createTeam(name: string): void {
    if (this.myPlayerId === null) return;
    // The cap is refused HERE, not only in the form that offers the button: the pre-game
    // screen is live, so the last slot can be taken by someone else between the render that
    // enabled the control and the tap. Refusing in the store is what makes that a notice on a
    // working screen instead of a 21st team appearing locally and vanishing on reconcile.
    if (this.rosterTeams.length >= limits.team.teamMaxCount) return this.refuse("teams-full");
    const myPlayerId = this.myPlayerId;
    const teamId = `team-local-${String(Date.now() % 1_000_000)}`;
    this.rosterTeams = [
      ...this.rosterTeams,
      { teamId, name, colorId: null, buzzSoundId: null, leaderPlayerId: myPlayerId, locked: false },
    ];
    this.assignTeam(myPlayerId, teamId);
  }

  joinTeam(teamId: string): void {
    if (this.myPlayerId === null) return;
    const team = this.rosterTeams.find((entry) => entry.teamId === teamId);
    if (team === undefined) return this.refuse("unknown-team");
    if (team.locked) return this.refuse("team-locked");
    this.refusalState = null;
    // The same call whether you have a team or not - assignTeam REPLACES teamId, so joining
    // from another team is a move, not an error. That is what makes "change your mind" work on
    // the pre-game screen without a leave-then-join dance the room could be interrupted during.
    this.assignTeam(this.myPlayerId, teamId);
  }

  leaveTeam(): void {
    if (this.myPlayerId === null) return;
    this.refusalState = null;
    this.assignTeam(this.myPlayerId, null);
  }

  private assignTeam(playerId: string, teamId: string | null): void {
    this.rosterPlayers = this.rosterPlayers.map((player) =>
      player.playerId === playerId ? { ...player, teamId } : player,
    );
  }

  updateTeam(patch: TeamPatch, teamId?: string): void {
    if (this.identityLocked()) return;
    const targetId = teamId ?? this.myTeamId();
    if (targetId === null) return;
    this.rosterTeams = this.rosterTeams.map((team) =>
      team.teamId === targetId
        ? {
            ...team,
            name: patch.name ?? team.name,
            colorId: patch.colorId !== undefined ? patch.colorId : team.colorId,
            buzzSoundId: patch.buzzSoundId !== undefined ? patch.buzzSoundId : team.buzzSoundId,
            locked: patch.locked ?? team.locked,
          }
        : team,
    );
  }

  private myTeamId(): string | null {
    const me = this.rosterPlayers.find((entry) => entry.playerId === this.myPlayerId);
    return me?.teamId ?? null;
  }

  kickFromTeam(playerId: string): void {
    // Kicked players return to team selection (they keep their room seat).
    this.assignTeam(playerId, null);
  }

  handOffLeadership(playerId: string): void {
    const target = this.rosterPlayers.find((entry) => entry.playerId === playerId);
    if (target?.teamId === null || target === undefined) return;
    const teamId = target.teamId;
    this.rosterTeams = this.rosterTeams.map((team) =>
      team.teamId === teamId ? { ...team, leaderPlayerId: playerId } : team,
    );
  }

  /**
   * The host seating somebody else (console roster panel). Deliberately ignores the team's
   * lock - the lock refuses JOINERS, and the host out-ranks every team decision - but keeps
   * the lobby-only rule, because after start-game the engine's seats are truth.
   */
  assignPlayerToTeam(playerId: string, teamId: string): void {
    if (this.roomPhase !== "lobby") return;
    const team = this.rosterTeams.find((entry) => entry.teamId === teamId);
    if (team === undefined) return this.refuse("unknown-team");
    if (this.rosterPlayers.every((entry) => entry.playerId !== playerId)) return;
    this.refusalState = null;
    this.assignTeam(playerId, teamId);
    // An empty team the host has just filled gets its first member as leader, exactly as a
    // self-join would (the DO does the same in handleTeamJoin).
    if (team.leaderPlayerId === null) {
      this.rosterTeams = this.rosterTeams.map((entry) =>
        entry.teamId === teamId ? { ...entry, leaderPlayerId: playerId } : entry,
      );
    }
  }

  renamePlayer(playerId: string, nickname: string): void {
    this.rosterPlayers = this.rosterPlayers.map((player) =>
      player.playerId === playerId ? { ...player, nickname } : player,
    );
  }

  kickFromRoom(playerId: string): void {
    this.removeFromRoster(playerId);
    if (this.engineState !== null && this.roomPhase === "active") {
      this.dispatch({ type: "player-leave", at: Date.now(), playerId });
    }
  }

  // --- play actions ----------------------------------------------------------------------

  markArmedPainted(armId: number): void {
    // Nothing to record: a simulated room has no arming window and no network to compensate
    // for. Its buzz is adjudicated in the same tick as the press, so there is no ranking to
    // influence and no round trip to measure - which is why `view.arming` is null here and a
    // surface's paint report lands nowhere. Present so the seam has one shape, not two
    // (docs/decisions/2026-08-17-buzz-latency-compensation.md is about real rooms only).
    void armId;
  }

  buzz(): void {
    if (this.myPlayerId === null) return;
    // Optimistic pending is set BEFORE the transition (pointerdown feedback contract);
    // in the mock the verdict lands synchronously in the same tick via applyEvent.
    this.myBuzz = { status: "pending", at: Date.now() };
    this.dispatch({ type: "buzz", at: Date.now(), playerId: this.myPlayerId });
  }

  commitWager(amount: number): void {
    this.dispatch({ type: "commit-wager", at: Date.now(), amount });
  }

  commitFinalWager(amount: number): void {
    const entityId = this.myEntityId();
    if (entityId === null) return;
    this.dispatch({ type: "commit-final-wager", at: Date.now(), entityId, amount });
  }

  submitFinalAnswer(text: string): void {
    const state = this.engineState;
    if (state === null || this.myPlayerId === null) return;
    if (state.phase === "all-answering") {
      this.dispatch({
        type: "submit-typed-answer",
        at: Date.now(),
        playerId: this.myPlayerId,
        text,
      });
      return;
    }
    const entityId = this.myEntityId();
    if (entityId === null) return;
    this.dispatch({ type: "submit-final-answer", at: Date.now(), entityId, text });
  }

  private myEntityId(): string | null {
    const state = this.engineState;
    if (state === null || this.myPlayerId === null) return null;
    const player = state.players[this.myPlayerId];
    if (player === undefined) return null;
    return player.teamId ?? player.id;
  }

  // --- host actions ----------------------------------------------------------------------

  private dispatchJoinFor(playerId: string): void {
    const player = this.rosterPlayers.find((entry) => entry.playerId === playerId);
    if (player === undefined) return;
    const team =
      player.teamId === null
        ? undefined
        : this.rosterTeams.find((entry) => entry.teamId === player.teamId);
    // Teams mode REQUIRES a teamId on every seat, so an unteamed player (fixture late joiners,
    // solo-minded guests) becomes a solo team of one named after them - the same seating policy
    // the real room applies at start-game. Mixed does NOT: a teamless player there chose to
    // play solo, and their scoring entity is themselves (@jeopardy/protocol
    // settings/groups/teams.ts, teamsAreRequired).
    const seatTeam =
      team !== undefined
        ? { teamId: team.teamId, teamName: team.name }
        : teamsAreRequired(this.setup.settings.teams.playerMode)
          ? { teamId: player.playerId, teamName: player.nickname }
          : {};
    this.dispatch({
      type: "player-join",
      at: Date.now(),
      playerId: player.playerId,
      name: player.nickname,
      ...seatTeam,
    });
  }

  startGame(): void {
    if (this.engineState === null) this.engineState = createInitialState(this.setup);
    // Seats materialize from the roster exactly once, at start (the M3 contract: the lobby
    // rearranges teams freely because the engine has not met anyone yet).
    for (const player of this.rosterPlayers) this.dispatchJoinFor(player.playerId);
    this.dispatch({ type: "start-game", at: Date.now() });
    // Only when the ENGINE actually started. Found by the 2026-08-16 host-loop walk: pressing
    // Start in an empty room left the engine in `lobby` (it has nobody to seat) while the ROOM
    // went active anyway - which took the projector off the staged lobby and onto a board that
    // could not be played, with nothing on either screen saying why. The room's phase now
    // follows the engine's, and the console refuses the button instead.
    if (this.engineState.phase !== "lobby") this.roomPhase = "active";
  }

  selectCell(category: number, row: number): void {
    this.dispatch({ type: "select-cell", at: Date.now(), category, row });
  }

  armBuzzers(): void {
    this.dispatch({ type: "arm-buzzers", at: Date.now() });
  }

  judge(verdict: Verdict): void {
    this.dispatch({ type: "judge", at: Date.now(), verdict });
  }

  judgeEntity(entityId: string, verdict: "correct" | "wrong"): void {
    this.dispatch({ type: "judge-entity", at: Date.now(), entityId, verdict });
  }

  hostAward(entityId: string, verdict: "correct" | "wrong"): void {
    this.dispatch({ type: "host-award", at: Date.now(), entityId, verdict });
  }

  hostCommitWager(entityId: string, amount: number): void {
    // The console types a wager on a player's behalf (C4 step 6); the engine validates the
    // amount against the same range the phone would get. entityId is advisory in the mock:
    // commit-wager always applies to the current wagering entity.
    void entityId;
    this.dispatch({ type: "commit-wager", at: Date.now(), amount });
  }

  closeBuzzWindow(): void {
    this.dispatch({ type: "buzz-timeout", at: Date.now() });
  }

  closeAnswers(): void {
    this.dispatch({ type: "close-answers", at: Date.now() });
  }

  cancelClue(): void {
    this.dispatch({ type: "cancel-clue", at: Date.now() });
  }

  reopenCell(category: number, row: number): void {
    this.dispatch({ type: "reopen-cell", at: Date.now(), category, row });
  }

  scoreAdjust(entityId: string, delta: number): void {
    this.dispatch({ type: "score-adjust", at: Date.now(), entityId, delta });
  }

  scoreSet(entityId: string, score: number): void {
    this.dispatch({ type: "score-set", at: Date.now(), entityId, score });
  }

  undo(): void {
    this.dispatch({ type: "undo", at: Date.now() });
  }

  proceed(): void {
    this.dispatch({ type: "proceed", at: Date.now() });
  }

  endRound(): void {
    this.dispatch({ type: "end-round", at: Date.now() });
  }

  endGame(): void {
    this.dispatch({ type: "end-game", at: Date.now() });
  }

  /**
   * The mock applies the patch to its OWN setup rather than pretending, so the sim panel
   * demonstrates the real consequence: lengthen the answer clock here and the next mock clue
   * genuinely runs the longer one. That is the whole value of the sim - a control that only
   * moved a readout would be a picture of the feature rather than the feature.
   */
  updateGameRules(patch: LiveRulesPatch): void {
    this.setup = {
      ...this.setup,
      settings: {
        ...this.setup.settings,
        buzzing: { ...this.setup.settings.buzzing, ...patch.buzzing },
        scoring: { ...this.setup.settings.scoring, ...patch.scoring },
      },
    };
    this.simRules = liveRulesOfSettings(this.setup.settings);
  }

  /**
   * A mock room is one tab with nobody else in it, so there is nothing to close FOR anyone -
   * but the console's control must still do something visible or the sim panel would be
   * demonstrating a dead button. The honest mock is the state a real close leaves behind:
   * this connection reads as closed, which is exactly what a `room-closed` frame produces on
   * the ws store (ws-room-store.svelte.ts).
   */
  closeRoom(): void {
    this.simConnection = "closed";
  }

  tiebreakerNextClue(): void {
    this.dispatch({ type: "tiebreaker-next-clue", at: Date.now() });
  }

  // --- simulation controls (the M4 sim panel's backend; owner directive "Development
  // simulation", UI level). Dev-only surfaces call these; they are not part of RoomStore. --

  /** Buzz as a specific seated player (sim panel rows, buzz races). */
  simBuzz(playerId: string, at = Date.now()): void {
    this.dispatch({ type: "buzz", at, playerId });
  }

  /**
   * A staggered mass buzz race among connected seated players (excluding me): arrival order
   * is shuffled deterministically by the engine seed's business - here we just spread the
   * timestamps so server-arrival ordering has something to order.
   */
  simBuzzRace(spreadMs = 120): void {
    const state = this.engineState;
    if (state === null) return;
    const baseAt = Date.now();
    const contenders = Object.values(state.players).filter(
      (player) => player.connected && player.id !== this.myPlayerId,
    );
    contenders.forEach((player, index) => {
      this.dispatch({
        type: "buzz",
        at: baseAt + Math.round((index * spreadMs) / Math.max(1, contenders.length - 1)),
        playerId: player.id,
      });
    });
  }

  /**
   * Attach or unplug simulated projectors and audience - the census the host console reads to
   * answer "is anything on the big screen" (RoomView.connections). Displays hold no seat and are
   * in neither participant budget, so this touches the roster's PLAYERS not at all; naming an
   * audience does reach `roster.spectatorCount`, because a room that can count watchers reports
   * the same number in both places.
   */
  simSetConnections(patch: { displays?: number; spectators?: number }): void {
    if (patch.displays !== undefined) this.simDisplays = Math.max(0, Math.trunc(patch.displays));
    if (patch.spectators !== undefined) {
      this.simSpectators = Math.max(0, Math.trunc(patch.spectators));
    }
  }

  /** Phone-sleep / Wi-Fi-blip simulation: flips roster health, seats stay (A5 behavior). */
  simSetConnected(playerId: string, connected: boolean): void {
    this.rosterPlayers = this.rosterPlayers.map((player) =>
      player.playerId === playerId ? { ...player, connected } : player,
    );
  }

  /** Commit fixture wagers + answers for every entity still outstanding in the final. */
  simCompleteFinal(): void {
    const state = this.engineState;
    if (state === null || state.final === null) return;
    const at = Date.now();
    if (state.phase === "final-wagers") {
      for (const entityId of state.final.eligible) {
        if (state.final.wagers[entityId] === undefined) {
          const score = state.scores[entityId] ?? 0;
          this.dispatch({
            type: "commit-final-wager",
            at,
            entityId,
            amount: Math.max(0, Math.floor(score / 2)),
          });
        }
      }
      return;
    }
    if (state.phase === "final-writing") {
      for (const entityId of state.final.eligible) {
        if (state.final.answers[entityId] === undefined) {
          this.dispatch({
            type: "submit-final-answer",
            at,
            entityId,
            text: `Simulated answer from ${entityId}`,
          });
        }
      }
    }
  }
}
