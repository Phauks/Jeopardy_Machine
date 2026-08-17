// What the ONE pre-game surface is showing - as regions that change state, never as screens
// that replace each other.
//
// THIS REPLACES `playerRouteStageFor`. That function returned one of character | team | lobby |
// playing and the route rendered exactly one of four components, so choosing a colour hid the
// teams and joining a team hid your character. The standing UI law adopted on 2026-08-16
// (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md) forbids precisely that:
//
//   "state changes in place; it does not swap screens ... No wizard chains. The pre-game is
//    ONE surface whose regions fill in."
//
// So the derivation below answers a different shape of question. Not "which screen" but "what
// is true of each region that is already on screen": is the character region editing a draft or
// the room's copy of you, can the teams region be acted on yet, are you leading the team you are
// in. Every region is mounted from the first paint in every one of these states; nothing here
// can make one disappear.
//
// The ONE surface swap left is pre-game -> buzzer, and it is the exception the law names: the
// game itself changing state, not navigation.
import { limits } from "@jeopardy/protocol/limits";
import type { RoomPlayerView, RoomView } from "#lib/room/room-view.ts";

/** The two player surfaces. Not a chain: a room is either being set up, or it is being played. */
export type PlayerSurface = "pre-game" | "buzzer";

/**
 * Which surface this phone is looking at.
 *
 * A phone with no seat stays on the pre-game surface whatever the room is doing - a late
 * arrival picks a character exactly like everyone else did, and there is nothing for a buzzer
 * to buzz with until they have. Once seated, the room's own phase decides, so the host starting
 * the game moves every phone at once and no click handler is involved.
 */
export function playerSurfaceFor(view: RoomView): PlayerSurface {
  if (view.myPlayerId === null) return "pre-game";
  return view.phase === "lobby" ? "pre-game" : "buzzer";
}

/**
 * Where the character region's edits go.
 *
 * "draft" - no seat yet, so the controls write to local state and travel with the join.
 * "live"  - seated, so the same controls write straight through to the room.
 *
 * The controls themselves are identical in both, which is the point: taking a seat changes what
 * a tap MEANS, not what is on screen. Before the rework these were two different components on
 * two different screens.
 */
export type IdentityMode = "draft" | "live";

export type TeamsRegionState = {
  /** Teams are a room setting; in individuals mode the region says so instead of vanishing. */
  shown: boolean;
  /** Team actions need a seat - you cannot board anything until you are in the room. */
  actionable: boolean;
  /** The team this phone is on, or null for the holding area. */
  myTeamId: string | null;
  /** Leaders get rename and the administrative overflow on their own team. */
  leadsTeam: boolean;
  /** The room already holds every team it can (limits.team.teamMaxCount). */
  atTeamCap: boolean;
  /** Create is offered only when it could actually succeed. */
  canCreateTeam: boolean;
  /** True once you are on a team - the create/move copy differs between the two. */
  hasTeam: boolean;
};

export type PreGameRegions = {
  /** This phone holds a seat in the room. */
  seated: boolean;
  identityMode: IdentityMode;
  /** The room is already playing - joining now goes straight to the buzzer. */
  lateJoin: boolean;
  teams: TeamsRegionState;
};

export function preGameRegionsFor(view: RoomView): PreGameRegions {
  const me = myPlayer(view);
  const seated = me !== null;
  const myTeamId = me?.teamId ?? null;
  const atTeamCap = view.roster.teams.length >= limits.team.teamMaxCount;
  return {
    seated,
    identityMode: seated ? "live" : "draft",
    lateJoin: view.phase !== "lobby",
    teams: {
      shown: view.teamsMode,
      actionable: seated,
      myTeamId,
      leadsTeam:
        me !== null &&
        view.roster.teams.some(
          (team) => team.teamId === myTeamId && team.leaderPlayerId === me.playerId,
        ),
      atTeamCap,
      canCreateTeam: seated && !atTeamCap,
      hasTeam: myTeamId !== null,
    },
  };
}

/** This connection's roster row, or null when it has no seat. */
export function myPlayer(view: RoomView): RoomPlayerView | null {
  const myPlayerId = view.myPlayerId;
  if (myPlayerId === null) return null;
  return view.roster.players.find((player) => player.playerId === myPlayerId) ?? null;
}

/**
 * Why a team name is not acceptable, or null. Pure so the create form and its tests agree on
 * one answer, and so the at-cap case is checked where it is DECIDED rather than where a button
 * happens to be disabled - the store refuses it too (local-sim-store.svelte.ts), because the
 * last slot can be taken between the render and the tap.
 */
export function teamNameProblem(
  name: string,
  regions: PreGameRegions,
): "empty" | "too-long" | "at-cap" | null {
  if (regions.teams.atTeamCap) return "at-cap";
  const trimmed = name.trim();
  if (trimmed.length < limits.team.teamNameMinLength) return "empty";
  if (trimmed.length > limits.team.teamNameMaxLength) return "too-long";
  return null;
}

/** The sentence for each problem, in one place so the form and the tests cannot drift. */
export function teamNameProblemCopy(
  problem: Exclude<ReturnType<typeof teamNameProblem>, null>,
): string {
  switch (problem) {
    case "empty":
      return "Name the team first";
    case "too-long":
      return `Team names stop at ${String(limits.team.teamNameMaxLength)} characters`;
    case "at-cap":
      return `This room already has the maximum ${String(limits.team.teamMaxCount)} teams`;
  }
}

/**
 * A2's "duplicate names get an auto-suffix": an error here would be pure friction, and the room
 * has to disambiguate two people called Sam somehow.
 */
export function uniqueNickname(candidate: string, taken: readonly string[]): string {
  const lowered = new Set(taken.map((name) => name.toLowerCase()));
  if (!lowered.has(candidate.toLowerCase())) return candidate;
  let suffix = 2;
  while (lowered.has(`${candidate.toLowerCase()} ${String(suffix)}`)) suffix += 1;
  return `${candidate} ${String(suffix)}`;
}
