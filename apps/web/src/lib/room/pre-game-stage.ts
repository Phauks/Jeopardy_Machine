// Which pre-game screen a phone is on, as one pure function.
//
// Same move `buzzerStageFor` makes for the A4 states table (room-view.ts): the route's whole
// branching is a tested mapping rather than a stack of template conditionals. The journey is
// character -> team -> lobby -> playing, and every transition is a consequence of room state
// plus one local choice, never of a click handler setting a screen variable.
//
// That matters most for the transitions nobody clicks through: a kick returns you to team
// selection because your teamId went null, not because anything called a "go back" function
// (user-flows "Teams & leadership": kicked players return to team selection). A room that
// starts while you are still choosing puts you on the buzzer. Neither needs its own code path.
import type { RoomView } from "#lib/room/room-view.ts";

export type PlayerRouteStage =
  /** A2, first half: name, avatar, accent, buzzer sound. You have no seat yet. */
  | "character"
  /** A2, second half: the staged lobby and the team cards. You are in the room, unassigned. */
  | "team"
  /** A3: you're in, on a team, waiting for the host. */
  | "lobby"
  /** A4: the buzzer, in all its states. */
  | "playing";

export type PreGameChoices = {
  /**
   * The player chose to play on their own in a teams-mode room. Local to this phone and
   * deliberately not room state: refusing a team is not a fact about the room, and the room
   * already knows how to seat an unteamed player (as a solo team of one, at start-game). It
   * exists only so the team screen stops asking - without it, "no thanks" would bounce
   * straight back to the same screen forever.
   */
  soloAccepted: boolean;
};

export function playerRouteStageFor(view: RoomView, choices: PreGameChoices): PlayerRouteStage {
  // No seat = no identity yet, whatever the room is doing. A late joiner arriving mid-game
  // picks a character exactly like everyone else did.
  if (view.myPlayerId === null) return "character";

  // Once the room is playing, the phone is a buzzer. This is also why a late joiner does NOT
  // get the team screen: their engine seat is created the moment they join a running game, so
  // offering to move them between teams afterwards would be a lie the mock and the real room
  // would both have to refuse. The host can reassign them (guiding principle 4).
  if (view.phase !== "lobby") return "playing";

  if (!view.teamsMode || choices.soloAccepted) return "lobby";
  const me = view.roster.players.find((player) => player.playerId === view.myPlayerId);
  return me?.teamId === null || me === undefined ? "team" : "lobby";
}

/** The stage's own heading, so the route and its tests name the screens the same way. */
export function stageTitle(stage: PlayerRouteStage): string {
  switch (stage) {
    case "character":
      return "Choose your character";
    case "team":
      return "Pick your team";
    case "lobby":
      return "You're in";
    case "playing":
      return "Buzzer";
  }
}
