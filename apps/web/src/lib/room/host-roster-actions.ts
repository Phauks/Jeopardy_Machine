// The roster panel's decisions, pulled out of the template so they can be tested against a
// store rather than against markup (the panel itself is SSR-rendered in tests and cannot be
// clicked - apps/web has no DOM environment by design, vite.config.ts).
//
// These are the three edits where "which store method" is a real question rather than a
// one-to-one mapping: an empty team selection is a LEAVE and not a join, a blank rename is a
// slip rather than an instruction, and a host renaming a team must name the team (a leader's
// own team is implied; the host's is not - packages/protocol/src/room/client-messages.ts).
// Everything else on the panel calls one store method with one argument and is wired inline.
import { limits } from "@jeopardy/protocol/limits";
import type { RoomStore } from "#lib/room/room-store.ts";

/**
 * The host picked a team for somebody in the roster panel's "Move to team" list.
 *
 * "" is the "No team" option: that is `kickFromTeam` (back to the holding area, keeping their
 * room seat), never a join of a team called "". Any other value seats them on that team,
 * through the host-only form of `team-join` - which ignores the team's lock, because a lock
 * refuses joiners and the host out-ranks it.
 */
export function applyTeamSelection(store: RoomStore, playerId: string, teamId: string): void {
  if (teamId === "") {
    store.kickFromTeam(playerId);
    return;
  }
  store.assignPlayerToTeam(playerId, teamId);
}

/**
 * Commit an inline player rename. An empty (or whitespace) field is a host who changed their
 * mind or fumbled a keystroke - it must never blank somebody's name on the projector, so it is
 * silently dropped. Length is the room's to enforce; the field already caps it.
 */
export function applyPlayerRename(store: RoomStore, playerId: string, draft: string): boolean {
  const trimmed = draft.trim();
  if (trimmed.length < limits.player.nicknameMinLength) return false;
  store.renamePlayer(playerId, trimmed);
  return true;
}

/** The same rule for a team, against the team-name minimum, and always naming the team. */
export function applyTeamRename(store: RoomStore, teamId: string, draft: string): boolean {
  const trimmed = draft.trim();
  if (trimmed.length < limits.team.teamNameMinLength) return false;
  store.updateTeam({ name: trimmed }, teamId);
  return true;
}
