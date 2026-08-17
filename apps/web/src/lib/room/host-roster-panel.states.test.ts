// The console's roster panel: every state a room can be in, every host power over it, and the
// two honesty rules it exists to keep (owner, 2026-08-17 - "show all player data... Also show
// spectators", and the console that reported "26/30" for an empty room).
//
// Rendered on the server, per the repo pattern: apps/web has no DOM environment, so the panel's
// markup is asserted here and the wiring that has a real decision in it lives in
// host-roster-actions.ts, tested against a recording store below.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import HostRosterPanel from "#lib/room/host-roster-panel.svelte";
import {
  applyPlayerRename,
  applyTeamRename,
  applyTeamSelection,
} from "#lib/room/host-roster-actions.ts";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import type { RoomStore } from "#lib/room/room-store.ts";
import type { RoomView } from "#lib/room/room-view.ts";

function hostStore(seedRoster: "fixture" | "empty" = "fixture"): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seed: "roster", seedRoster });
}

function panel(store: RoomStore, openMenu: string | null = null): string {
  return render(HostRosterPanel, { props: { store, onClose: () => undefined, openMenu } }).body;
}

/** A store whose view is whatever a test needs - the only way to reach states the sim cannot. */
function viewOnlyStore(view: RoomView): RoomStore {
  return { mode: "ws", view } as unknown as RoomStore;
}

describe("the roster panel through the room's states", () => {
  it("an empty room says so, and offers the code rather than a number", () => {
    const body = panel(hostStore("empty"));
    expect(body).toContain("Nobody has joined yet");
    expect(body).toContain("TESTA");
    expect(body).toContain("0 connected of 0");
  });

  it("lists every player with their team, their state and the score they play for", () => {
    const store = hostStore();
    store.startGame();
    const body = panel(store);
    const first = store.view.roster.players[0];
    expect(first).toBeDefined();
    expect(body).toContain(first?.nickname ?? "");
    // Connection state is a word, never a colour alone.
    expect(body).toContain(">here<");
    expect(body).toContain(`data-player-id="${first?.playerId ?? ""}"`);
    // Their team's name rides the row (this fixture room plays in teams).
    const teamName = store.view.roster.teams[0]?.name ?? "";
    expect(body).toContain(teamName);
  });

  it("shows a disconnected player as away rather than dropping them from the list", () => {
    const store = hostStore();
    const target = store.view.roster.players.find((player) => !player.connected);
    expect(target, "the fixture room has a disconnected phone in it").toBeDefined();
    const body = panel(store);
    expect(body).toContain(target?.nickname ?? "");
    expect(body).toContain(">away<");
  });

  it("carries the teams: members, leader, lock state and the team's buzz sound", () => {
    const store = hostStore();
    const team = store.view.roster.teams[0];
    expect(team).toBeDefined();
    const body = panel(store);
    expect(body).toContain(`data-team-id="${team?.teamId ?? ""}"`);
    expect(body).toContain("(leader)");
    expect(body).toContain("Buzz sound:");
  });

  it("keeps every administrative action behind the row's '...', never beside a name", () => {
    const store = hostStore();
    const player = store.view.roster.players[0];
    const closed = panel(store);
    expect(closed).toContain(`Actions for ${player?.nickname ?? ""}`);
    for (const action of ["Rename player", "Move to team", "Remove from room"]) {
      expect(closed, action).not.toContain(action);
    }
  });

  it("offers exactly the host powers the protocol grants once that menu is open", () => {
    const store = hostStore();
    // Somebody on a team who does not already lead it: "make leader" is offered only where it
    // would do something.
    const player = store.view.roster.players.find(
      (entry) =>
        entry.teamId !== null &&
        store.view.roster.teams.some(
          (team) => team.teamId === entry.teamId && team.leaderPlayerId !== entry.playerId,
        ),
    );
    const team = store.view.roster.teams[0];
    const playerMenu = panel(store, player?.playerId ?? "");
    for (const action of [
      "Rename player",
      "Move to team",
      "Make team leader",
      "Remove from room",
    ]) {
      expect(playerMenu, action).toContain(action);
    }
    // The confirm step only exists once a host has asked for the kick - never pre-armed.
    expect(playerMenu).not.toContain("Confirm: remove");

    const teamMenu = panel(store, team?.teamId ?? "");
    expect(teamMenu).toContain("Rename team");
    expect(teamMenu).toContain("Lock team");
  });
});

describe("the panel never invents a number", () => {
  const baseView = (): RoomView => {
    const view = hostStore("empty").view;
    return { ...view };
  };

  it("says the audience is unreported rather than reporting nobody watching", () => {
    // The local sim cannot see spectators (a mock room is one tab), so it reports null - and
    // null must never render as "0 watching".
    const body = panel(hostStore("empty"));
    expect(body).toContain("does not report its audience");
    expect(body).not.toContain("0 watching");
  });

  it("reports a real count when the room sends one", () => {
    const view = baseView();
    const body = panel(viewOnlyStore({ ...view, roster: { ...view.roster, spectatorCount: 3 } }));
    expect(body).toContain("3 watching");
    expect(body).toContain("cap");
  });

  it("says spectators are not allowed instead of counting an audience that cannot exist", () => {
    const view = baseView();
    const body = panel(
      viewOnlyStore({
        ...view,
        settings: { ...view.settings, spectatorsAllowed: false },
      }),
    );
    expect(body).toContain("not allowed in this room");
  });

  it("withholds the caps until the room has actually reported its settings", () => {
    const view = baseView();
    const blind = viewOnlyStore({ ...view, settingsKnown: false });
    const body = panel(blind);
    expect(body).toContain("not loaded yet");
    // The protocol default (a plausible-looking cap) must not be drawn as this room's.
    expect(body).not.toContain(`cap ${String(view.settings.maxPlayers)}`);
  });
});

/** Records what the panel's wiring asks of the store, without a DOM to click. */
function recordingStore(): { store: RoomStore; calls: string[] } {
  const calls: string[] = [];
  const store = {
    kickFromTeam: (playerId: string) => calls.push(`kickFromTeam:${playerId}`),
    assignPlayerToTeam: (playerId: string, teamId: string) =>
      calls.push(`assignPlayerToTeam:${playerId}:${teamId}`),
    renamePlayer: (playerId: string, nickname: string) =>
      calls.push(`renamePlayer:${playerId}:${nickname}`),
    updateTeam: (patch: { name?: string }, teamId?: string) =>
      calls.push(`updateTeam:${teamId ?? "?"}:${patch.name ?? ""}`),
  } as unknown as RoomStore;
  return { store, calls };
}

describe("the host actions reach the right store method", () => {
  it("moves a player between teams, and treats 'No team' as leaving rather than joining ''", () => {
    const { store, calls } = recordingStore();
    applyTeamSelection(store, "p1", "t-2");
    applyTeamSelection(store, "p1", "");
    expect(calls).toEqual(["assignPlayerToTeam:p1:t-2", "kickFromTeam:p1"]);
  });

  it("renames a player, and drops a blank field instead of blanking their name", () => {
    const { store, calls } = recordingStore();
    expect(applyPlayerRename(store, "p1", "  Bartholomew  ")).toBe(true);
    expect(applyPlayerRename(store, "p1", "   ")).toBe(false);
    expect(calls).toEqual(["renamePlayer:p1:Bartholomew"]);
  });

  it("renames a team and always names WHICH team - a host's edit is refused without it", () => {
    const { store, calls } = recordingStore();
    expect(applyTeamRename(store, "t-2", "The Quizzly Bears")).toBe(true);
    expect(applyTeamRename(store, "t-2", " ")).toBe(false);
    expect(calls).toEqual(["updateTeam:t-2:The Quizzly Bears"]);
  });

  it("and the store really performs each host power on the roster", () => {
    const store = hostStore();
    const player = store.view.roster.players[0];
    const otherTeam = store.view.roster.teams[1];
    expect(player).toBeDefined();
    expect(otherTeam).toBeDefined();
    const playerId = player?.playerId ?? "";
    const teamId = otherTeam?.teamId ?? "";

    store.renamePlayer(playerId, "Renamed By Host");
    expect(store.view.roster.players.find((entry) => entry.playerId === playerId)?.nickname).toBe(
      "Renamed By Host",
    );

    store.assignPlayerToTeam(playerId, teamId);
    expect(store.view.roster.players.find((entry) => entry.playerId === playerId)?.teamId).toBe(
      teamId,
    );

    store.handOffLeadership(playerId);
    expect(store.view.roster.teams.find((entry) => entry.teamId === teamId)?.leaderPlayerId).toBe(
      playerId,
    );

    store.updateTeam({ name: "Renamed Team", locked: true }, teamId);
    const renamed = store.view.roster.teams.find((entry) => entry.teamId === teamId);
    expect(renamed?.name).toBe("Renamed Team");
    expect(renamed?.locked).toBe(true);

    // A locked team still admits the host's own seating - the lock refuses joiners, not the host.
    const second = store.view.roster.players[1];
    store.assignPlayerToTeam(second?.playerId ?? "", teamId);
    expect(
      store.view.roster.players.find((entry) => entry.playerId === second?.playerId)?.teamId,
    ).toBe(teamId);

    store.kickFromTeam(playerId);
    expect(
      store.view.roster.players.find((entry) => entry.playerId === playerId)?.teamId,
    ).toBeNull();

    const before = store.view.roster.players.length;
    store.kickFromRoom(playerId);
    expect(store.view.roster.players.length).toBe(before - 1);
  });
});
