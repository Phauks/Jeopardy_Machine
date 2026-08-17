// The room-store seam: ONE typed interface between the play surfaces (join/lobby/buzzer,
// display, host console) and wherever room state actually lives. Two implementations:
//
// - local-sim-store.svelte.ts - wraps @jeopardy/engine's transition() plus the fixtures/ dummy
//   dataset, timers driven client-side. What the demo room and the dev surfaces get.
// - ws-room-store.svelte.ts - the same interface over a real socket to the room's GameRoomDO.
//   What every real room code gets (docs/design/surfaces.md holds the message-to-store table).
//
// Surfaces consume ONLY this interface, so which room you are in is a factory decision
// (create-room-store.ts), never a component one - and the event fold both implementations use
// is one module (room-fold.ts), so they cannot drift into two answers about the same event.
import type { Verdict } from "@jeopardy/engine/actions";
import type { TimerKind } from "@jeopardy/engine/events";
import type { RoomSettingsPatch } from "@jeopardy/protocol/room/room-settings";
import type { RoomView } from "#lib/room/room-view.ts";

/** What a phone submits from the A2 join screen (mirrors the protocol join message fields). */
export type JoinRequest = {
  nickname: string;
  avatarId: string | null;
  accentId: string | null;
  buzzSoundId: string | null;
  /** Humans only; null = the pack's own colors, never inferred (protocol room/identity.ts). */
  skinToneId: string | null;
  /** Teams mode only: tap an existing card or found a new team (creator becomes leader). */
  team?: { kind: "join"; teamId: string } | { kind: "create"; name: string };
};

/** Sparse personal-tier edit (post-join customization); only present fields change. */
export type IdentityPatch = {
  nickname?: string;
  avatarId?: string | null;
  accentId?: string | null;
  buzzSoundId?: string | null;
  skinToneId?: string | null;
};

/** Sparse team-tier edit; leader-only (or host override naming the team). */
export type TeamPatch = {
  name?: string;
  colorId?: string | null;
  buzzSoundId?: string | null;
  locked?: boolean;
};

export type RoomStoreMode = "local-sim" | "ws";

/**
 * The room-audible buzz, resolved: the TEAM's sound in teams mode, the winner's own otherwise
 * (the owner's double-confirmation directive - the room hears the team while the display shows
 * its name and colour). A real room resolves this server-side and ships it on the buzz-won
 * message; the mock applies the same rule to its own roster. Surfaces that make noise take it
 * from here rather than resolving it a third time.
 */
export type RoomBuzz = {
  playerId: string;
  entityId: string;
  buzzSoundId: string | null;
};

/**
 * All surfaces' actions in one interface. Grouping mirrors who may call what (the M3
 * authority matrix): player actions are also always available to the host on a player's
 * behalf (guiding principle 4), host actions are refused for phones by the server - the mock
 * store does not police roles, the components simply never render the wrong controls.
 */
export type RoomStore = {
  readonly mode: RoomStoreMode;
  /** Reactive: implementations back this with runes state; reading it in effects tracks it. */
  readonly view: RoomView;

  // Connection + membership.
  join(request: JoinRequest): void;
  leave(): void;

  // Personal tier (any player, self only) + team tier (leader or host).
  updateIdentity(patch: IdentityPatch): void;
  createTeam(name: string): void;
  /**
   * Join a team, or MOVE to one from another - the same call either way, because the roster
   * stores one teamId per player and replacing it is the whole operation. Changing your mind
   * before the game starts is allowed (user-flows "Teams & leadership"), and doing it as one
   * message rather than leave-then-join means the room never sees you briefly teamless.
   */
  joinTeam(teamId: string): void;
  /** Step back to the holding area without picking another team. */
  leaveTeam(): void;
  updateTeam(patch: TeamPatch, teamId?: string): void;
  kickFromTeam(playerId: string): void;
  handOffLeadership(playerId: string): void;
  // Host supremacy over the roster.
  renamePlayer(playerId: string, nickname: string): void;
  kickFromRoom(playerId: string): void;

  // Play (phone side).
  buzz(): void;
  commitWager(amount: number): void;
  commitFinalWager(amount: number): void;
  submitFinalAnswer(text: string): void;

  // Host console. Engine-action relays: the ws store ships these as `action` messages
  // without `at` (the server stamps arrival time); the mock store stamps Date.now() itself.
  startGame(): void;
  selectCell(category: number, row: number): void;
  armBuzzers(): void;
  judge(verdict: Verdict): void;
  judgeEntity(entityId: string, verdict: "correct" | "wrong"): void;
  /** Manual mode (resolved UX question 1): no buzzers, the host awards from the console. */
  hostAward(entityId: string, verdict: "correct" | "wrong"): void;
  hostCommitWager(entityId: string, amount: number): void;
  /** "No takers" (C4 step 5): closes the buzz window, dead clue reveals per setting #42. */
  closeBuzzWindow(): void;
  /** Everyone-answers mode: host closes the typed-answer window early. */
  closeAnswers(): void;
  cancelClue(): void;
  reopenCell(category: number, row: number): void;
  scoreAdjust(entityId: string, delta: number): void;
  scoreSet(entityId: string, score: number): void;
  undo(): void;
  proceed(): void;
  endRound(): void;
  tiebreakerNextClue(): void;
  /** Freeze/unfreeze all pending timers; the display shows "one moment" (C4 pause). */
  setPaused(paused: boolean): void;
  /**
   * Change the ROOM's own settings - listing, entry/password, caps, spectators, streamer mode
   * (packages/protocol/src/room/room-settings.ts). Host-only and sparse: send the fields you
   * mean to change. Server state, broadcast to every connection, and therefore the opposite of
   * a device preference in every way that matters (src/lib/host-settings/).
   */
  updateRoomSettings(patch: RoomSettingsPatch): void;
  /**
   * Fire a pending timer's expiry action now (host force-expire; also how tests and the sim
   * panel advance time). Omitting `kind` fires whichever timer the current phase waits on.
   */
  expireTimer(kind?: TimerKind): void;

  /** Release timers and (ws) close the socket; call on route destroy. */
  destroy(): void;
};
