// The WebSocket room store: the SAME RoomStore interface, wired to the M3 GameRoomDO at
// reconcile. Every method body below is a stub documenting exactly which room protocol
// message it will send; the incoming side is one message handler switch (table below).
// Field names in room-view.ts already match the protocol shapes, so wiring is mechanical.
//
// Message -> store mapping (server -> client; packages/protocol/src/room/server-messages.ts):
//
// | Message       | Store effect                                                             |
// | ------------- | ------------------------------------------------------------------------ |
// | welcome       | myPlayerId + sessionToken (sessionStorage, user-flows A2); connection=connected |
// | refused       | room-level reasons -> connection=closed + friendly error; team-level     |
// |               | reasons keep the socket, surface on the join screen for a retry          |
// | snapshot      | replace view.game (role-redacted GameState) + roster wholesale; recompute |
// |               | pendingTimers from the snapshot's engine phase                           |
// | event         | fold GameEvent[] into the same applyEvent logic the local-sim store uses  |
// |               | (timer-set -> pendingTimers, judged -> lastJudged, wager-cell-hit ->     |
// |               | wagerRange, final-wagers-open -> finalWagerRanges); a stateVersion gap    |
// |               | of more than one sends `sync`                                            |
// | buzz-won      | myBuzz=won when playerId is mine; the ROOM audio driver keys off this    |
// |               | message's buzzSoundId alone (only-winner-heard is server-resolved)       |
// | buzz-rejected | myBuzz=rejected with reason + lockedUntil (per-phone, silent, local)     |
// | roster        | replace view.roster wholesale (whole-payload sync by protocol design)    |
// | room-settings | replace view.settings wholesale - sent on join and on every host edit,   |
// |               | which is how a join code that just became hidden leaves the projector    |
// | room-closed   | connection=closed, show the polite end screen                            |
// | error         | identity-locked / rate-limited surface as toasts; action-rejected is a   |
// |               | console-side notice (the engine state did not change)                    |
//
// Client -> server (client-messages.ts): join/resume/action/team-*/identity-update/
// rename-player/kick-player/sync/leave - each store method names its message inline.
//
// Divergences to resolve at reconcile (also listed in docs/design/surfaces.md):
// - Clue text/content: the M3 snapshot carries no content join (the engine never sees text).
//   view.content must come from a content channel - snapshot extension or a one-time fetch
//   of the room's game definition, host-redacted server-side.
// - Timers: M3 sends timer-set hints inside `event` frames but the DO owns expiries via
//   alarms; this store only RENDERS pendingTimers, never dispatches expiry actions.
// - `expireTimer` becomes a host-only action relay (the force-expire console affordance).
// - `paused` needs a room-level message (not yet in the M3 catalog) - flagged for reconcile.
import { defaultRoomSettings } from "@jeopardy/protocol/room/room-settings";
import type { Verdict } from "@jeopardy/engine/actions";
import type { TimerKind } from "@jeopardy/engine/events";
import type { RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
import type { IdentityPatch, JoinRequest, RoomStore, TeamPatch } from "#lib/room/room-store.ts";
import type { RoomRoleView, RoomView } from "#lib/room/room-view.ts";

export type WsRoomStoreOptions = {
  roomCode: string;
  role: RoomRoleView;
};

function notWired(method: string, message: string): never {
  throw new Error(
    `ws room store is a reconcile-time stub: ${method}() will send the room ${message} message once the M3 GameRoomDO lands (see docs/design/surfaces.md)`,
  );
}

export class WsRoomStore implements RoomStore {
  readonly mode = "ws" as const;
  private readonly staticView: RoomView;

  constructor(options: WsRoomStoreOptions) {
    // Until the socket opens (reconcile), the view is a permanent "connecting" shell so a
    // route accidentally constructing this store renders a spinner, not a crash.
    this.staticView = {
      roomCode: options.roomCode,
      role: options.role,
      connection: "connecting",
      phase: "lobby",
      roster: { players: [], teams: [] },
      teamsMode: false,
      myPlayerId: null,
      game: null,
      content: null,
      myBuzz: { status: "idle" },
      pendingTimers: [],
      lastJudged: null,
      wagerRange: null,
      finalWagerRanges: [],
      // Null until the room says otherwise: the census is the DO's to count, and a shell that
      // invented one would tell a host a projector was attached to a socket that is not open.
      // Wiring: the `snapshot` message gains the protocol's `connectionCensus`
      // (packages/protocol/src/room/diagnostics.ts) - the same counts the host-authenticated
      // GET /api/rooms/<CODE> already returns - and is refreshed on join/leave broadcasts.
      connections: null,
      paused: false,
      // The room's defaults until the socket says otherwise. `hideJoinCode: false` is the
      // right shell value: the connecting screen shows no code anyway, and a room that turns
      // out to be in streamer mode hides it the moment `room-settings` arrives.
      settings: {
        ...defaultRoomSettings,
        entry: "open",
        title: "",
        hostLabel: "",
      },
      refusal: null,
    };
  }

  get view(): RoomView {
    return this.staticView;
  }

  join(request: JoinRequest): void {
    void request;
    notWired("join", "`join` (role, nickname, avatarId, accentId, buzzSoundId, team intent)");
  }

  leave(): void {
    notWired("leave", "`leave`");
  }

  updateIdentity(patch: IdentityPatch): void {
    void patch;
    notWired("updateIdentity", "`identity-update` (sparse personal-tier fields)");
  }

  createTeam(name: string): void {
    void name;
    notWired("createTeam", "`team-create`");
  }

  joinTeam(teamId: string): void {
    void teamId;
    // The same message whether this is a first join or a move between teams: the server
    // replaces the session's teamId either way, so there is no separate "move" verb.
    notWired("joinTeam", "`team-join`");
  }

  leaveTeam(): void {
    notWired("leaveTeam", "`team-leave`");
  }

  updateTeam(patch: TeamPatch, teamId?: string): void {
    void patch;
    void teamId;
    notWired("updateTeam", "`team-update` (host names the teamId, leaders omit it)");
  }

  kickFromTeam(playerId: string): void {
    void playerId;
    notWired("kickFromTeam", "`team-kick`");
  }

  handOffLeadership(playerId: string): void {
    void playerId;
    notWired("handOffLeadership", "`team-handoff`");
  }

  renamePlayer(playerId: string, nickname: string): void {
    void playerId;
    void nickname;
    notWired("renamePlayer", "`rename-player` (host only)");
  }

  kickFromRoom(playerId: string): void {
    void playerId;
    notWired("kickFromRoom", "`kick-player` (host only)");
  }

  // Engine-action relays ride the `action` message WITHOUT `at` and WITHOUT actor identity -
  // the DO stamps arrival time and the session's playerId (authority.ts), which is the
  // server-arrival buzz-ordering contract. The mock store stamping Date.now() is the one
  // behavioral difference between the two implementations.

  buzz(): void {
    notWired("buzz", "`action` {type:'buzz'} (server stamps at + playerId)");
  }

  commitWager(amount: number): void {
    void amount;
    notWired("commitWager", "`action` {type:'commit-wager', amount}");
  }

  commitFinalWager(amount: number): void {
    void amount;
    notWired(
      "commitFinalWager",
      "`action` {type:'commit-final-wager', amount} (server stamps entityId)",
    );
  }

  submitFinalAnswer(text: string): void {
    void text;
    notWired(
      "submitFinalAnswer",
      "`action` {type:'submit-final-answer'|'submit-typed-answer', text}",
    );
  }

  startGame(): void {
    notWired("startGame", "`action` {type:'start-game'} (host; server replays roster joins first)");
  }

  selectCell(category: number, row: number): void {
    void category;
    void row;
    notWired("selectCell", "`action` {type:'select-cell', category, row}");
  }

  armBuzzers(): void {
    notWired("armBuzzers", "`action` {type:'arm-buzzers'} (host)");
  }

  judge(verdict: Verdict): void {
    void verdict;
    notWired("judge", "`action` {type:'judge', verdict} (host)");
  }

  judgeEntity(entityId: string, verdict: "correct" | "wrong"): void {
    void entityId;
    void verdict;
    notWired("judgeEntity", "`action` {type:'judge-entity', entityId, verdict} (host)");
  }

  hostAward(entityId: string, verdict: "correct" | "wrong"): void {
    void entityId;
    void verdict;
    notWired("hostAward", "`action` {type:'host-award', entityId, verdict} (host, manual mode)");
  }

  hostCommitWager(entityId: string, amount: number): void {
    void entityId;
    void amount;
    notWired(
      "hostCommitWager",
      "`action` {type:'commit-wager', amount} (host, on a player's behalf)",
    );
  }

  closeBuzzWindow(): void {
    notWired("closeBuzzWindow", "`action` {type:'buzz-timeout'} (host 'no takers')");
  }

  closeAnswers(): void {
    notWired("closeAnswers", "`action` {type:'close-answers'} (host)");
  }

  cancelClue(): void {
    notWired("cancelClue", "`action` {type:'cancel-clue'} (host)");
  }

  reopenCell(category: number, row: number): void {
    void category;
    void row;
    notWired("reopenCell", "`action` {type:'reopen-cell', category, row} (host)");
  }

  scoreAdjust(entityId: string, delta: number): void {
    void entityId;
    void delta;
    notWired("scoreAdjust", "`action` {type:'score-adjust', entityId, delta} (host)");
  }

  scoreSet(entityId: string, score: number): void {
    void entityId;
    void score;
    notWired("scoreSet", "`action` {type:'score-set', entityId, score} (host)");
  }

  undo(): void {
    notWired("undo", "`action` {type:'undo'} (host)");
  }

  proceed(): void {
    notWired("proceed", "`action` {type:'proceed'} (host)");
  }

  endRound(): void {
    notWired("endRound", "`action` {type:'end-round'} (host)");
  }

  tiebreakerNextClue(): void {
    notWired("tiebreakerNextClue", "`action` {type:'tiebreaker-next-clue'} (host)");
  }

  setPaused(paused: boolean): void {
    void paused;
    notWired("setPaused", "a room-level pause message NOT yet in the M3 catalog (reconcile flag)");
  }

  updateRoomSettings(patch: RoomSettingsPatch): void {
    void patch;
    // Both doors already exist server-side (the host-only client message and PATCH
    // /api/rooms/<CODE>); this store sends the message one, since the console holds the socket.
    notWired("updateRoomSettings", "`update-room-settings` {settings} (host only)");
  }

  expireTimer(kind?: TimerKind): void {
    void kind;
    notWired(
      "expireTimer",
      "a host force-expire action relay (the DO owns real expiries via alarms)",
    );
  }

  destroy(): void {
    // Nothing to release until the socket exists; the wired version closes it here.
  }
}
