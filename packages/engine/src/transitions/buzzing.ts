// Arming and buzz adjudication (#11-#13) - the locked core of the game (boundary 2.1 in
// docs/design/expansion-and-boundaries.md). Ordering truth: actions arrive in ONE sequence
// (the DO's arrival order in production, the array order in fixtures) and the first valid
// buzz after arming wins - exactly one buzz-won event fires per arming (owner directive:
// only the winning buzz is heard).
//
// M6 landed latency fairness compensation exactly where this comment promised it: UPSTREAM.
// The DO holds the buzzes of one arming for a few milliseconds, ranks them by credited
// reaction time (packages/protocol/src/room/buzz-fairness.ts), and feeds THIS function the
// ordered list with each action's `at` rewritten to the credited press time. Nothing here
// changed and nothing here may: the state machine stays single, unbranched and clockless
// (docs/design/expansion-and-boundaries.md boundary 2.1).
import { closeClue } from "../flow.ts";
import { entityForPlayer } from "../state.ts";
import type { GameAction } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { GameState } from "../state.ts";

export function handleArmBuzzers(
  draft: GameState,
  action: Extract<GameAction, { type: "arm-buzzers" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  // Everyone-answers mode (#22): the same host gesture opens the typed-answer window.
  if (draft.phase === "reading" && setup.settings.answerMode.everyoneAnswers !== "off") {
    const clue = draft.clue;
    if (clue === null) return "no-clue";
    draft.phase = "all-answering";
    clue.answersOpenedAt = action.at;
    events.push({ type: "answers-open", at: action.at });
    events.push({
      type: "timer-set",
      kind: "everyone-answers-window",
      durationMs: setup.settings.buzzing.answerWindowMs,
      at: action.at,
    });
    return null;
  }

  if (draft.phase === "reading") {
    const clue = draft.clue;
    if (clue === null) return "no-clue";
    draft.phase = "armed";
    clue.armedAt = action.at;
    clue.armingCount += 1;
    clue.buzzWinner = null;
    events.push({ type: "buzzers-armed", rebound: clue.armingCount > 1, armedAt: action.at });
    const buzzWindow = setup.settings.buzzing.buzzWindowMs;
    if (buzzWindow !== null) {
      events.push({
        type: "timer-set",
        kind: "buzz-window",
        durationMs: buzzWindow,
        at: action.at,
      });
    }
    return null;
  }

  if (draft.phase === "tiebreaker-reading") {
    const tiebreaker = draft.tiebreaker;
    if (tiebreaker === null) return "no-tiebreaker";
    draft.phase = "tiebreaker-armed";
    tiebreaker.armedAt = action.at;
    tiebreaker.buzzWinner = null;
    events.push({ type: "buzzers-armed", rebound: false, armedAt: action.at });
    const buzzWindow = setup.settings.buzzing.buzzWindowMs;
    if (buzzWindow !== null) {
      events.push({
        type: "timer-set",
        kind: "buzz-window",
        durationMs: buzzWindow,
        at: action.at,
      });
    }
    return null;
  }

  return "not-reading";
}

/** The participant key early-buzz penalties attach to: the team under #36, the phone otherwise. */
function earlyLockoutKey(setup: GameSetup, playerId: string, entityId: string): string {
  const teamsMode = setup.settings.teams.playerMode === "teams";
  return teamsMode && setup.settings.teams.teamWideEarlyBuzzPenalty ? entityId : playerId;
}

export function handleBuzz(
  draft: GameState,
  action: Extract<GameAction, { type: "buzz" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  const entityId = entityForPlayer(draft, action.playerId);
  if (entityId === null) {
    events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "unknown-player" });
    return "unknown-player";
  }

  // Tiebreaker buzzing: participants only, no early-buzz penalty (the sudden-death clue is
  // host-paced theater, not a skill window).
  if (draft.phase === "tiebreaker-armed") {
    const tiebreaker = draft.tiebreaker;
    if (tiebreaker === null) return "no-tiebreaker";
    if (!tiebreaker.participants.includes(entityId) || tiebreaker.eliminated.includes(entityId)) {
      events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "locked-out" });
      return "locked-out";
    }
    if (tiebreaker.buzzWinner !== null) {
      events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "too-late" });
      return "too-late";
    }
    tiebreaker.buzzWinner = { playerId: action.playerId, entityId };
    draft.phase = "tiebreaker-answering";
    events.push({ type: "buzz-won", playerId: action.playerId, entityId, at: action.at });
    return null;
  }

  if (draft.phase === "reading" || draft.phase === "tiebreaker-reading") {
    // Early buzz (#12): each press re-triggers the lockout; 0ms turns the penalty off.
    const lockoutMs = setup.settings.buzzing.earlyBuzzLockoutMs;
    if (lockoutMs > 0 && draft.clue !== null && draft.phase === "reading") {
      const key = earlyLockoutKey(setup, action.playerId, entityId);
      const lockedUntil = action.at + lockoutMs;
      draft.clue.earlyLockedUntil[key] = lockedUntil;
      events.push({ type: "early-buzz", playerId: action.playerId, entityId, lockedUntil });
      return null;
    }
    events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "not-armed" });
    return "not-armed";
  }

  // Losing the race by arriving after adjudication: the winner is already answering. This
  // is the mass-buzz normal case - silent per-phone feedback, never room audio.
  if (draft.phase === "answering" || draft.phase === "tiebreaker-answering") {
    events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "too-late" });
    return "too-late";
  }

  if (draft.phase !== "armed") {
    events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "not-armed" });
    return "not-armed";
  }

  const clue = draft.clue;
  if (clue === null) return "no-clue";

  if (clue.buzzWinner !== null) {
    events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "too-late" });
    return "too-late";
  }
  if (clue.lockedOutEntities.includes(entityId)) {
    events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "locked-out" });
    return "locked-out";
  }
  // Rotating captain (#35): only the team's current captain may buzz this clue.
  if (
    setup.settings.teams.playerMode === "teams" &&
    setup.settings.teams.teamBuzzer === "rotating-captain"
  ) {
    const team = draft.teams[entityId];
    if (team !== undefined && team.memberIds.length > 0) {
      const captain = team.memberIds[team.captainRotation % team.memberIds.length];
      if (captain !== action.playerId) {
        events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "not-captain" });
        return "not-captain";
      }
    }
  }
  // Early-buzz lockout still running (#12): the press re-triggers it (mashing keeps you out,
  // exactly like the TV hardware).
  const key = earlyLockoutKey(setup, action.playerId, entityId);
  const lockedUntil = clue.earlyLockedUntil[key];
  if (lockedUntil !== undefined && action.at < lockedUntil) {
    const lockoutMs = setup.settings.buzzing.earlyBuzzLockoutMs;
    const extended = action.at + lockoutMs;
    clue.earlyLockedUntil[key] = extended;
    // Both events, because they say different things to different listeners: early-buzz
    // carries the NEW deadline (the presser's phone draws the penalty ring from it - without
    // this the re-trigger was invisible to the person mashing, M6 finding), buzz-rejected is
    // the per-phone "that did not count" the wire contract already promises.
    events.push({
      type: "early-buzz",
      playerId: action.playerId,
      entityId,
      lockedUntil: extended,
    });
    events.push({ type: "buzz-rejected", playerId: action.playerId, reason: "early-lockout" });
    return null;
  }

  clue.buzzWinner = { playerId: action.playerId, entityId };
  draft.phase = "answering";
  events.push({ type: "buzz-won", playerId: action.playerId, entityId, at: action.at });
  events.push({
    type: "timer-set",
    kind: "answer-window",
    durationMs: setup.settings.buzzing.answerWindowMs,
    at: action.at,
  });
  return null;
}

export function handleBuzzTimeout(
  draft: GameState,
  action: Extract<GameAction, { type: "buzz-timeout" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase === "armed") {
    // Nobody rang in (#13): dead clue, control unchanged (TV: a triple stumper does not
    // move the pick).
    closeClue(draft, setup, events, action.at, "dead");
    return null;
  }
  if (draft.phase === "tiebreaker-armed") {
    const tiebreaker = draft.tiebreaker;
    if (tiebreaker === null) return "no-tiebreaker";
    // Dead tiebreaker clue: back to reading; the host deals the next one.
    draft.phase = "tiebreaker-reading";
    tiebreaker.armedAt = null;
    tiebreaker.eliminated = [];
    return null;
  }
  return "not-armed";
}
