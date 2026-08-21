// The client's view of a room - the read side of the room-store seam (docs/design/surfaces.md).
// Field names deliberately mirror the M3 room protocol shapes (packages/protocol/src/room/
// roster.ts + server-messages.ts in the main tree) so the ws store implementation is a
// field-for-field mapping at reconcile, not a rename exercise: playerId/teamId/colorId/
// leaderPlayerId/locked/connected/joinedAt and the personal identity quartet
// nickname/avatarId/accentId/buzzSoundId are the protocol's own names.
import type { GamePhase, GameState } from "@jeopardy/engine/state";
import type { TimerKind } from "@jeopardy/engine/events";
import type { PlayerMode } from "@jeopardy/protocol/settings/player-mode";
import type { ResolvedMedia } from "@jeopardy/protocol/room/server-messages";
import type { RefusalReason } from "@jeopardy/protocol/room/server-messages";
import type { ConnectionCensus } from "@jeopardy/protocol/room/diagnostics";
import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";

export type RoomConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

/** Mirrors the protocol's roomPhaseSchema: the room tier, not the engine's GamePhase. */
export type RoomPhaseView = "lobby" | "active" | "ended";

export type RoomRoleView = "host" | "display" | "player" | "spectator";

export type RoomPlayerView = {
  playerId: string;
  nickname: string;
  /** Curated-set ids (avatar manifest / accent palette / buzz-sound catalog); null = default. */
  avatarId: string | null;
  accentId: string | null;
  buzzSoundId: string | null;
  /**
   * The human models' skin tone, or null for "not chosen" - which renders in the pack's own
   * colors and is never filled in on the player's behalf
   * (packages/protocol/src/room/identity.ts). Pets carry null always; the control is not shown
   * for them (avatarTakesSkinTone in #lib/avatars/avatar-manifest.ts).
   */
  skinToneId: string | null;
  teamId: string | null;
  connected: boolean;
  joinedAt: number;
};

export type RoomTeamView = {
  teamId: string;
  name: string;
  /** Accent-palette id (protocol colorId) - team color always resolves through the manifest. */
  colorId: string | null;
  /** The room-audible buzz sound in teams mode (leader-picked; the double-confirmation rule). */
  buzzSoundId: string | null;
  leaderPlayerId: string | null;
  locked: boolean;
};

export type RoomRosterView = {
  players: RoomPlayerView[];
  teams: RoomTeamView[];
  /**
   * How many spectators are watching, or NULL when this room has not reported its audience.
   *
   * Spectators hold no seat and give no identity, so a count is the only honest thing there is
   * to show (the protocol's `rosterPayload.spectatorCount`, filled from live connections by the
   * DO). Null is not zero and must not render as zero: "nobody is watching" and "nobody has
   * counted" are different facts, and a console that prints the second as the first is
   * inventing a number - the same rule the lobby's capacity lines follow
   * (src/lib/lobby/room-capacity.ts).
   */
  spectatorCount: number | null;
};

/**
 * This phone's buzz feedback channel - the per-connection messages (buzz-won / buzz-rejected)
 * plus the optimistic local press. "pending" is the instant pointerdown state that the server
 * verdict resolves; in mock mode the verdict is synchronous so pending is never observed.
 */
export type MyBuzzView =
  | { status: "idle" }
  | { status: "pending"; at: number }
  | { status: "won"; at: number }
  | {
      status: "rejected";
      reason: "not-armed" | "early-lockout" | "too-late" | "locked-out" | "not-captain";
      /** Early-lockout only: when this phone's buzzer unlocks (the visible penalty ring). */
      lockedUntil: number | null;
    };

/** A pending engine timer hint (timer-set event), kept so surfaces can render rings/bars. */
export type PendingTimerView = {
  kind: TimerKind;
  durationMs: number;
  firesAt: number;
};

/**
 * The arming the room is currently running, as the protocol's `arm-window` message describes
 * it - and the one field the protocol cannot supply: when THIS client painted it.
 *
 * The room ranks buzzes by reaction time rather than by arrival order
 * (docs/decisions/2026-08-17-buzz-latency-compensation.md), and the quantity being ranked is
 * the human's thumb: the clock starts when the player could first see the button go hot, not
 * when the message arrived. So `paintedAt` is stamped by the SURFACE, on the frame the armed
 * state actually reached the screen (`RoomStore.markArmedPainted`), and stays null until then -
 * a buzz with no paint behind it carries no timing at all, which the room ranks by arrival,
 * exactly as it did before compensation existed.
 */
export type RoomArmingView = {
  armId: number;
  /** How long the room may hold buzzes before crowning a winner; 0 = compensation is off. */
  compensationMs: number;
  /** True for a re-arm after a wrong answer, so a surface can word it differently. */
  rebound: boolean;
  /** Local clock at the moment this client painted the armed state; null until it has. */
  paintedAt: number | null;
};

/** The judged-flash payload (A4 "Score delta flash"): cleared when the next clue opens. */
export type LastJudgedView = {
  entityId: string;
  verdict: "correct" | "wrong" | "no-penalty" | "timeout";
  delta: number;
  at: number;
};

/** Wager bounds for the entity currently wagering (from wager-cell-hit / final-wagers-open). */
export type WagerRangeView = {
  entityId: string;
  minimum: number;
  maximum: number;
  label: string;
};

/**
 * The content join the engine deliberately never sees (a clue is coordinates + value to it):
 * prompts for display surfaces, responses for the host console only. The ws store fills this
 * from whatever content channel M3's reconcile defines (see docs/design/surfaces.md - the
 * snapshot does not carry clue text yet, a noted divergence); responses stay null for
 * non-host roles so a mirrored or player device never holds answers, even in memory.
 */
export type ClueContentView = {
  categoryTitle: string;
  prompt: string;
  /**
   * The clue's picture, sound, video or attachment, already resolved by the room into
   * something a surface can paint - kind, type, alt text and a URL when the bytes are
   * fetchable (@jeopardy/protocol room/server-messages.ts, resolvedMediaSchema). Null when the
   * clue is words only, which is most of them.
   */
  media: ResolvedMedia | null;
  /** Host consoles only; null everywhere else (mirror-mode safety starts at the data layer). */
  response: string | null;
  /**
   * The ANSWER's media, host-only for the same reason the answer text is: a picture that gives
   * the answer away must never reach a display or a phone.
   */
  responseMedia: ResolvedMedia | null;
};

export type RoomContentView = {
  /** categoryTitles[roundIndex][categoryIndex]. */
  categoryTitles: string[][];
  /** Resolved face values, cellValues[roundIndex][categoryIndex][rowIndex] - board rendering
   * needs them and the engine state carries only played/hidden status. */
  cellValues: number[][][];
  clueAt: (roundIndex: number, category: number, row: number) => ClueContentView | null;
  final: ClueContentView | null;
};

export type RoomView = {
  roomCode: string;
  role: RoomRoleView;
  connection: RoomConnectionState;
  phase: RoomPhaseView;
  roster: RoomRosterView;
  /**
   * How this room seats people (rules row 34, frozen when the room was created).
   *
   * The MODE, not a boolean, since 2026-08-19: "mixed" is a room where teams exist AND playing
   * solo is a legitimate choice, and that is two different answers a surface needs to give
   * different screens. Ask through the protocol's predicates rather than comparing here -
   * `teamsAreOffered` decides whether to draw team machinery at all, `teamsAreRequired` decides
   * whether a teamless player is unfinished or is simply a soloist.
   */
  playerMode: PlayerMode;
  /** This connection's seat; null for host/display/spectator connections. */
  myPlayerId: string | null;
  /**
   * The engine state as this role is allowed to see it (M3 redacts wager positions and
   * uncommitted final entries for non-host roles); null until start-game creates it.
   */
  game: GameState | null;
  content: RoomContentView | null;
  myBuzz: MyBuzzView;
  pendingTimers: PendingTimerView[];
  /**
   * The open arming, or null when the buzzers are not armed (and on stores that hold no
   * window - a local simulation adjudicates a buzz the instant it is pressed, so there is
   * nothing to measure and nothing to hold).
   */
  arming: RoomArmingView | null;
  lastJudged: LastJudgedView | null;
  wagerRange: WagerRangeView | null;
  finalWagerRanges: WagerRangeView[];
  /**
   * WHO IS ACTUALLY ON A SOCKET, by the role they joined as - the protocol's own census type
   * (packages/protocol/src/room/diagnostics.ts), counts only, never people.
   *
   * The console's first question at 19:55 is "is anything on the projector", and the roster
   * cannot answer it: a display holds no seat by design (the projector is the host's own screen,
   * not a participant). `connections.display` is the answer, and it counts displays this console
   * never opened - a Chromecast, a co-host's laptop, a second projector.
   *
   * NULL means "this store cannot know", which is the honest answer in mock mode: the local sim
   * is one isolated room per tab, so a display window opened beside it is a different room and
   * counting it would be a lie. The console falls back to the window handle it owns
   * (src/lib/room/game-screen.ts), which is first-hand either way. The ws store fills this from
   * the room's snapshot when M3 carries it (docs/design/surfaces.md, the mapping table).
   */
  connections: ConnectionCensus | null;
  /** Host pause (C4): a driver concern, not an engine phase - timers freeze, display dims. */
  paused: boolean;
  /**
   * The ROOM's own settings, as the protocol's `room-settings` message carries them - who may
   * come in, how many, and whether the join code is safe to show
   * (packages/protocol/src/room/room-settings.ts). The protocol type verbatim, not a copy:
   * every connection is sent this on join and again on every host edit, so a surface that
   * respects it cannot drift from the room that owns it. Nothing here is a secret - and since
   * 2026-08-20 there is no room secret at all for one of these fields to have been.
   */
  settings: RoomSettings;
  /**
   * Has the ROOM actually told us the settings above, or are they still the shell a store
   * carries so surfaces can render before the first message lands?
   *
   * False means "not loaded yet" and a surface that edits or reports room settings must SAY so
   * rather than draw the protocol defaults - a host who reads "40 players, spectators on" off a
   * console that has heard nothing from the room has been told something untrue about their own
   * room (owner, 2026-08-17: "I don't think the room I created shows the correct settings").
   * The local-sim store is the authority for its own room and reports true; the ws store
   * reports false until the `room-settings` message arrives.
   */
  settingsKnown: boolean;
  /**
   * Why the room turned this connection away, in the protocol's own vocabulary, or null. The
   * REASON travels rather than a sentence, so the copy lives in one place
   * (room-refusal.ts) and the phone, the console and the tests all say the same thing.
   */
  refusal: RoomRefusalView | null;
};

export type RoomRefusalView = {
  reason: RefusalReason;
  /** Stamp so a repeated refusal (tap the same locked team twice) re-announces itself. */
  at: number;
};

/** Everything the buzzer screen can be, per the A4 states table (docs/design/user-flows.md). */
export type BuzzerStage =
  | { kind: "waiting"; pickerName: string | null }
  | { kind: "reading" }
  | { kind: "armed" }
  | { kind: "you-won" }
  | { kind: "other-won"; winnerName: string }
  | { kind: "locked-out"; lockedUntil: number }
  | { kind: "judged"; delta: number; verdict: LastJudgedView["verdict"] }
  | { kind: "wager"; range: WagerRangeView; trueDoubleValue: number; label: string }
  | { kind: "wager-other"; name: string; label: string }
  | { kind: "final-wager"; range: WagerRangeView | null; committed: boolean }
  | { kind: "final-answer"; categoryTitle: string | null; submitted: boolean }
  | { kind: "final-reveal" }
  | { kind: "between-rounds"; next: "round" | "final" | "game-over" }
  | { kind: "game-over"; placement: number | null }
  | { kind: "lobby" };

/** The scoring entity a player acts as (mirror of the engine's entityForPlayer, on the view). */
export function viewEntityForPlayer(view: RoomView, playerId: string): string | null {
  const game = view.game;
  if (game === null) return null;
  const player = game.players[playerId];
  if (player === undefined) return null;
  return player.teamId ?? player.id;
}

export function entityDisplayName(view: RoomView, entityId: string): string {
  const team = view.roster.teams.find((entry) => entry.teamId === entityId);
  if (team !== undefined) return team.name;
  const player = view.roster.players.find((entry) => entry.playerId === entityId);
  if (player !== undefined) return player.nickname;
  // Engine-only participants (sim bots joined without roster entries) still have a name there.
  return view.game?.players[entityId]?.name ?? view.game?.teams[entityId]?.name ?? entityId;
}

/** 1-based placement of my entity at game over; ties share a number (engine standings rule). */
function placementFor(view: RoomView, entityId: string | null): number | null {
  const game = view.game;
  if (game === null || entityId === null) return null;
  const myScore = game.scores[entityId];
  if (myScore === undefined) return null;
  const higher = game.entityOrder.filter((entry) => (game.scores[entry] ?? 0) > myScore).length;
  return higher + 1;
}

const judgedFlashMs = 2500;

/**
 * Derive the buzzer screen's stage from the view - one pure function so every A4 row is a
 * unit-testable mapping instead of template conditionals. Order matters: the judged flash
 * briefly outranks the underlying phase, and the personal lockout outranks "armed".
 */
export function buzzerStageFor(view: RoomView, now: number): BuzzerStage {
  const game = view.game;
  const myPlayerId = view.myPlayerId;
  if (game === null || view.phase === "lobby") return { kind: "lobby" };
  const myEntityId = myPlayerId === null ? null : viewEntityForPlayer(view, myPlayerId);
  const phase: GamePhase = game.phase;

  // The score-delta flash (A4 "Judged") shows briefly for MY entity's verdicts, then falls
  // through to whatever the room is doing now.
  const lastJudged = view.lastJudged;
  if (
    lastJudged !== null &&
    lastJudged.entityId === myEntityId &&
    now - lastJudged.at < judgedFlashMs &&
    (phase === "awaiting-selection" || phase === "reading" || phase === "round-break")
  ) {
    return { kind: "judged", delta: lastJudged.delta, verdict: lastJudged.verdict };
  }

  switch (phase) {
    case "awaiting-selection": {
      const controlName =
        game.controlEntity === null ? null : entityDisplayName(view, game.controlEntity);
      return { kind: "waiting", pickerName: controlName };
    }
    case "reading":
    case "tiebreaker-reading":
      return { kind: "reading" };
    case "armed":
    case "tiebreaker-armed": {
      // My early-buzz penalty (A4 "You buzzed early"): visible ring until lockedUntil.
      if (view.myBuzz.status === "rejected" && view.myBuzz.reason === "early-lockout") {
        const until = view.myBuzz.lockedUntil ?? now;
        if (until > now) return { kind: "locked-out", lockedUntil: until };
      }
      return { kind: "armed" };
    }
    case "answering":
    case "tiebreaker-answering": {
      const winner = phase === "answering" ? game.clue?.buzzWinner : game.tiebreaker?.buzzWinner;
      if (winner === null || winner === undefined) return { kind: "reading" };
      if (myEntityId !== null && winner.entityId === myEntityId) return { kind: "you-won" };
      return { kind: "other-won", winnerName: entityDisplayName(view, winner.entityId) };
    }
    case "wagering": {
      const selector = game.clue?.selectedBy ?? null;
      const label = view.wagerRange?.label ?? "Double Down";
      if (selector !== null && selector === myEntityId && view.wagerRange !== null) {
        // "True DD" shortcut: everything you have or the clue row's worth, whichever is more -
        // exactly the wager maximum the engine computed.
        return {
          kind: "wager",
          range: view.wagerRange,
          trueDoubleValue: view.wagerRange.maximum,
          label,
        };
      }
      return {
        kind: "wager-other",
        name: selector === null ? "Someone" : entityDisplayName(view, selector),
        label,
      };
    }
    case "wager-answering": {
      const selector = game.clue?.selectedBy ?? null;
      if (selector !== null && selector === myEntityId) return { kind: "you-won" };
      return {
        kind: "other-won",
        winnerName: selector === null ? "Someone" : entityDisplayName(view, selector),
      };
    }
    case "all-answering":
    case "all-judging":
      // Everyone-answers rides the final-answer input surface (typed answer + deadline bar).
      return {
        kind: "final-answer",
        categoryTitle: null,
        submitted: myEntityId !== null && game.clue?.submissions[myEntityId] !== undefined,
      };
    case "final-wagers": {
      const committed = myEntityId !== null && game.final?.wagers[myEntityId] !== undefined;
      const range = view.finalWagerRanges.find((entry) => entry.entityId === myEntityId) ?? null;
      return { kind: "final-wager", range, committed };
    }
    case "final-writing": {
      const submitted = myEntityId !== null && game.final?.answers[myEntityId] !== undefined;
      return {
        kind: "final-answer",
        categoryTitle: view.content?.final?.categoryTitle ?? null,
        submitted,
      };
    }
    case "final-reveal":
      return { kind: "final-reveal" };
    case "round-break":
      return { kind: "between-rounds", next: game.breakNextStage ?? "round" };
    case "game-over":
      return { kind: "game-over", placement: placementFor(view, myEntityId) };
    case "lobby":
      return { kind: "lobby" };
  }
}

export type StandingRow = {
  entityId: string;
  name: string;
  score: number;
  hasControl: boolean;
  /** Accent hex for the score chip: team color in teams mode, player accent otherwise. */
  colorId: string | null;
};

/** Scores in entity order for the strip surfaces (display, buzzer, console, hotseat). */
export function standingsFor(view: RoomView): StandingRow[] {
  const game = view.game;
  if (game === null) return [];
  return game.entityOrder.map((entityId) => {
    const team = view.roster.teams.find((entry) => entry.teamId === entityId);
    const player = view.roster.players.find((entry) => entry.playerId === entityId);
    return {
      entityId,
      name: entityDisplayName(view, entityId),
      score: game.scores[entityId] ?? 0,
      hasControl: game.controlEntity === entityId,
      colorId: team?.colorId ?? player?.accentId ?? null,
    };
  });
}
