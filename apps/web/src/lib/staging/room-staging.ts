// The room's roster, as the staged lobby needs to see it.
//
// One function, deliberately: every surface that shows the staging - the team screen, the A3
// lobby, the display - derives its stations from here, so they can never disagree about who is
// aboard what. It is pure and takes a RoomView, which means the whole mapping is unit-testable
// without a store, a socket, or a canvas.
//
// Colour resolution goes through the avatar manifest (docs/design/theming.md, "Player accents
// and avatars"): a team's `colorId` is a palette id, exactly like a player's accent, and the
// hex only ever comes from the generated palette - never from a component.
import { accentById } from "#lib/avatars/avatar-manifest.ts";
import type { StagedOccupant } from "#lib/staging/staged-lobby-2d.svelte";
import type { StagingStation } from "#lib/staging/staging-layout.ts";
import type { RoomView } from "#lib/room/room-view.ts";

export type RoomStaging = {
  stations: StagingStation[];
  occupants: StagedOccupant[];
  /** Join order, which is what pins a waiting player to their spot as others board. */
  waitingEntityIds: string[];
};

/**
 * Build the staged view of a room in its lobby.
 *
 * Entities here are PLAYERS, not scoring entities - which is the difference between this and
 * the diorama's in-game occupant list. Before the game there are no scoring entities yet; the
 * question the screen is asking is which team each PERSON is on, so each person is on stage.
 */
export function stagingFromRoom(view: RoomView): RoomStaging {
  // Join order throughout: it is the only ordering that is stable as the room fills.
  const players = view.roster.players.toSorted((left, right) => left.joinedAt - right.joinedAt);

  const occupants: StagedOccupant[] = players.map((player) => ({
    entityId: player.playerId,
    label: player.nickname,
    avatarId: player.avatarId,
    accentId: player.accentId,
    leader: view.roster.teams.some((team) => team.leaderPlayerId === player.playerId),
    self: player.playerId === view.myPlayerId,
  }));

  // An individuals-mode room has no stations at all, and everybody stays in the holding area.
  // That is the honest picture rather than a special case: nobody is choosing a team because
  // there are none, and the water is where you are when you have not.
  const stations: StagingStation[] = view.teamsMode
    ? view.roster.teams.map((team) => ({
        stationId: team.teamId,
        label: team.name,
        colorHex: accentById(team.colorId).hex,
        memberIds: players
          .filter((player) => player.teamId === team.teamId)
          .map((player) => player.playerId),
      }))
    : [];

  const seated = new Set(stations.flatMap((station) => station.memberIds));
  const waitingEntityIds = players
    .filter((player) => !seated.has(player.playerId))
    .map((player) => player.playerId);

  return { stations, occupants, waitingEntityIds };
}
