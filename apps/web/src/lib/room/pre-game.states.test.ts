// The ONE pre-game surface: its regions, its states, and the law it exists to obey.
//
// The old version of this file tested a four-value stage function - character | team | lobby |
// playing - and every assertion in it was about which screen had REPLACED the others. Those
// tests passing is what made the wizard chain feel correct. The law adopted on 2026-08-16
// (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md) says regions change state
// in place and nothing already shown gets hidden, so the tests below are written to fail if a
// region ever disappears - which is the failure mode the old shape could not express.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import PreGameScreen from "#lib/room/pre-game-screen.svelte";
import TeamCard from "#lib/room/team-card.svelte";
import { fixtureRosterView } from "#lib/room/fixture-room.ts";
import { limits } from "@jeopardy/protocol/limits";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import {
  playerSurfaceFor,
  preGameRegionsFor,
  teamNameProblem,
  uniqueNickname,
} from "#lib/room/pre-game.ts";

const roster = fixtureRosterView();
const firstTeamId = roster.teams[0]?.teamId ?? "";
const secondTeamId = roster.teams[1]?.teamId ?? "";

function newStore(seed = "pre-game"): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode: "DUMYX", role: "player", seed });
}

function joinedStore(options: { team?: boolean } = {}): LocalSimRoomStore {
  const store = newStore("joined");
  store.join({
    nickname: "Lorax",
    avatarId: "fish",
    accentId: "moss",
    buzzSoundId: "loon",
    skinToneId: null,
    ...(options.team === true ? { team: { kind: "join" as const, teamId: firstTeamId } } : {}),
  });
  return store;
}

function bodyOf(store: LocalSimRoomStore): string {
  return render(PreGameScreen, { props: { store, roomCode: "DUMYX" } }).body;
}

describe("which surface a phone is on - two answers, not four", () => {
  it("keeps a seatless phone on the pre-game surface", () => {
    expect(playerSurfaceFor(newStore().view)).toBe("pre-game");
  });

  it("keeps a seated, teamless phone on the SAME surface (no team screen to send it to)", () => {
    expect(playerSurfaceFor(joinedStore().view)).toBe("pre-game");
  });

  it("keeps a seated, teamed phone on the same surface again", () => {
    expect(playerSurfaceFor(joinedStore({ team: true }).view)).toBe("pre-game");
  });

  it("moves every phone to the buzzer when the room starts, wherever it was", () => {
    const store = joinedStore();
    expect(playerSurfaceFor(store.view)).toBe("pre-game");
    store.startGame();
    expect(playerSurfaceFor(store.view)).toBe("buzzer");
  });

  it("still asks a mid-game arrival for a character first", () => {
    const store = newStore("late");
    store.startGame();
    expect(playerSurfaceFor(store.view)).toBe("pre-game");
    expect(preGameRegionsFor(store.view).lateJoin).toBe(true);
  });

  it("returns a kicked player to the holding area without changing surface", () => {
    const store = joinedStore({ team: true });
    expect(preGameRegionsFor(store.view).teams.hasTeam).toBe(true);
    store.kickFromTeam(store.view.myPlayerId ?? "");
    expect(playerSurfaceFor(store.view)).toBe("pre-game");
    expect(preGameRegionsFor(store.view).teams.hasTeam).toBe(false);
  });
});

describe("the regions are ALL present in every pre-game state", () => {
  // The core of the law, asserted as one property across the state space rather than as prose.
  const states: readonly (readonly [string, () => LocalSimRoomStore])[] = [
    ["no avatar chosen yet", () => newStore()],
    ["seated, no team", () => joinedStore()],
    ["seated, on a team", () => joinedStore({ team: true })],
    [
      "leading a team you founded",
      () => {
        const store = joinedStore();
        store.createTeam("Founders");
        return store;
      },
    ],
  ];

  for (const [label, make] of states) {
    it(`shows character, teams and roster together: ${label}`, () => {
      const body = bodyOf(make());
      expect(body, "character region").toContain('aria-label="Your character"');
      expect(body, "teams region").toContain('aria-label="Teams"');
      expect(body, "roster region").toContain('aria-label="Who is here"');
    });
  }

  it("keeps the look controls on screen after joining a team", () => {
    // The exact regression the old chain had: joining a team unmounted the character screen.
    const body = bodyOf(joinedStore({ team: true }));
    expect(body).toContain("Buzzer sound");
    expect(body).toContain('aria-label="Accent color"');
    expect(body).toContain('aria-label="Avatar"');
  });

  it("keeps the teams on screen while you are still choosing a look", () => {
    // And its mirror: choosing a character used to hide every team in the room.
    const body = bodyOf(newStore());
    for (const team of roster.teams) {
      expect(body, team.name).toContain(team.name);
    }
  });

  it("offers a way home from the surface - the wordmark in the shared header bar", () => {
    // It was a lone "home" button floated to the right of the room line until 2026-08-19; the
    // way back is now the same bar the front door wears (#lib/chrome/app-bar.svelte), and the
    // wordmark is the link. Still an ANCHOR, never history.back(): half the arrivals here are a
    // QR scan with nothing behind them.
    const body = bodyOf(newStore());
    expect(body).toContain('class="wordmark');
    expect(body).toContain('href="/"');
  });
});

describe("the character region changes MODE, not markup, when you take a seat", () => {
  it("edits a local draft before joining and the room's copy after", () => {
    expect(preGameRegionsFor(newStore().view).identityMode).toBe("draft");
    expect(preGameRegionsFor(joinedStore().view).identityMode).toBe("live");
  });

  it("offers the same three look controls in both modes", () => {
    const before = bodyOf(newStore());
    const after = bodyOf(joinedStore());
    for (const control of ['aria-label="Accent color"', 'aria-label="Avatar"', "Buzzer sound"]) {
      expect(before, `draft: ${control}`).toContain(control);
      expect(after, `live: ${control}`).toContain(control);
    }
  });

  it("replaces the join button with a confirmation line, keeping the bar itself", () => {
    expect(bodyOf(newStore())).toContain("Join the room");
    const seated = bodyOf(joinedStore());
    expect(seated).toContain("You are in as");
    expect(seated).toContain("change anything above whenever you like");
  });

  it("counts the name live instead of explaining the limit in prose", () => {
    const body = bodyOf(newStore());
    expect(body).toContain(`0/${String(limits.player.nicknameMaxLength)}`);
    expect(body).not.toContain("You can change it later");
  });
});

describe("team management, in place, on the same screen", () => {
  it("creates a team and makes the creator its leader", () => {
    const store = joinedStore();
    store.createTeam("Kestrels");
    const regions = preGameRegionsFor(store.view);
    expect(regions.teams.hasTeam).toBe(true);
    expect(regions.teams.leadsTeam).toBe(true);
    expect(store.view.roster.teams.some((team) => team.name === "Kestrels")).toBe(true);
  });

  it("MOVES an already-teamed player to another team with the same call", () => {
    const store = joinedStore({ team: true });
    expect(preGameRegionsFor(store.view).teams.myTeamId).toBe(firstTeamId);
    store.joinTeam(secondTeamId);
    expect(preGameRegionsFor(store.view).teams.myTeamId).toBe(secondTeamId);
    // And exactly one roster row holds them - a move is not an extra membership.
    const mine = store.view.roster.players.filter(
      (player) => player.playerId === store.view.myPlayerId,
    );
    expect(mine).toHaveLength(1);
  });

  it("steps back to the holding area without leaving the room", () => {
    const store = joinedStore({ team: true });
    store.leaveTeam();
    expect(preGameRegionsFor(store.view).teams.myTeamId).toBeNull();
    expect(store.view.myPlayerId).not.toBeNull();
  });

  it("renames a team the player leads, in place", () => {
    const store = joinedStore();
    store.createTeam("Typo Brigade");
    const teamId = preGameRegionsFor(store.view).teams.myTeamId ?? "";
    store.updateTeam({ name: "Kestrels" }, teamId);
    expect(store.view.roster.teams.find((team) => team.teamId === teamId)?.name).toBe("Kestrels");
  });

  it("offers 'Move here' rather than 'Join' once you are on a team", () => {
    const team = roster.teams[1];
    if (team === undefined) throw new Error("fixture needs two teams");
    const joining = render(TeamCard, {
      props: { team, members: [], viewerHasTeam: false, onJoin: () => undefined },
    }).body;
    const moving = render(TeamCard, {
      props: { team, members: [], viewerHasTeam: true, onJoin: () => undefined },
    }).body;
    expect(joining).toContain("Join this team");
    expect(moving).toContain("Move here");
  });

  it("shows your own team a status line instead of a button, at the same height", () => {
    const team = roster.teams[0];
    if (team === undefined) throw new Error("fixture team missing");
    const members = roster.players.filter((player) => player.teamId === team.teamId);
    const viewer = members[0];
    if (viewer === undefined) throw new Error("fixture team has no members");
    const { body } = render(TeamCard, {
      props: { team, members, viewerPlayerId: viewer.playerId, onJoin: () => undefined },
    });
    expect(body).toContain("You are on this team");
    expect(body).not.toContain("Join this team");
  });
});

describe("rename and leave obey the overflow rule", () => {
  const team = roster.teams[0];
  if (team === undefined) throw new Error("fixture team missing");
  const members = roster.players.filter((player) => player.teamId === team.teamId);

  it("keeps rename behind the team's '...' rather than as a visible edit field", () => {
    const { body } = render(TeamCard, {
      props: {
        team,
        members,
        viewerPlayerId: team.leaderPlayerId,
        viewerIsAdmin: true,
        onRename: () => undefined,
      },
    });
    expect(body).toContain(`Actions for ${team.name}`);
    expect(body).not.toContain("Rename team");
    // The name is a heading until the menu says otherwise - no input is rendered up front.
    expect(body).not.toContain('aria-label="Team name"');
  });

  it("keeps leaving behind the same '...' and offers it only to members", () => {
    const member = members[0];
    if (member === undefined) throw new Error("fixture team has no members");
    const asMember = render(TeamCard, {
      props: { team, members, viewerPlayerId: member.playerId, onLeave: () => undefined },
    }).body;
    expect(asMember).toContain("aria-haspopup");
    expect(asMember).not.toContain("Leave this team");

    const asOutsider = render(TeamCard, {
      props: { team, members, viewerPlayerId: "not-a-member", onLeave: () => undefined },
    }).body;
    expect(asOutsider).not.toContain("aria-haspopup");
  });
});

describe("the at-cap refusal", () => {
  function storeAtCap(): LocalSimRoomStore {
    const store = joinedStore();
    while (store.view.roster.teams.length < limits.team.teamMaxCount) {
      store.createTeam(`Team ${String(store.view.roster.teams.length + 1)}`);
    }
    return store;
  }

  it("stops offering creation once the room holds every team it can", () => {
    const regions = preGameRegionsFor(storeAtCap().view);
    expect(regions.teams.atTeamCap).toBe(true);
    expect(regions.teams.canCreateTeam).toBe(false);
    expect(teamNameProblem("Overflow", regions)).toBe("at-cap");
  });

  it("REFUSES in the store too, because the last slot can go between render and tap", () => {
    const store = storeAtCap();
    const before = store.view.roster.teams.length;
    store.createTeam("One Too Many");
    expect(store.view.roster.teams.length).toBe(before);
    expect(store.view.refusal?.reason).toBe("teams-full");
  });

  it("says so on the screen, in words, without showing a protocol code", () => {
    const body = bodyOf(storeAtCap());
    expect(body).toContain("maximum");
    expect(body).not.toContain("teams-full");
  });

  it("still lets a capped room be joined - the cap is on teams, not on seats", () => {
    expect(preGameRegionsFor(storeAtCap().view).teams.actionable).toBe(true);
  });
});

describe("the three seating modes, and the two different questions they answer", () => {
  it("never leaves a hole where the teams would be", () => {
    const store = joinedStore();
    const view = { ...store.view, playerMode: "individuals" as const };
    expect(preGameRegionsFor(view).teams.shown).toBe(false);
  });

  it("mixed OFFERS teams without REQUIRING one - the case a boolean could not hold", () => {
    const store = joinedStore();
    const mixed = preGameRegionsFor({ ...store.view, playerMode: "mixed" as const });
    expect(mixed.teams.shown).toBe(true);
    expect(mixed.teams.required).toBe(false);
  });

  it("teams mode both offers and requires, which is what makes it the strict one", () => {
    const store = joinedStore();
    const teams = preGameRegionsFor({ ...store.view, playerMode: "teams" as const });
    expect(teams.teams.shown).toBe(true);
    expect(teams.teams.required).toBe(true);
  });

  it("individuals requires nothing, because there is nothing to require", () => {
    const store = joinedStore();
    const solo = preGameRegionsFor({ ...store.view, playerMode: "individuals" as const });
    expect(solo.teams.required).toBe(false);
  });
});

describe("nickname de-duplication (A2's auto-suffix)", () => {
  it("leaves a free name alone and suffixes a taken one", () => {
    expect(uniqueNickname("Sam", ["Ada", "Bo"])).toBe("Sam");
    expect(uniqueNickname("Sam", ["sam"])).toBe("Sam 2");
    expect(uniqueNickname("Sam", ["Sam", "Sam 2"])).toBe("Sam 3");
  });
});

// GONE 2026-08-20, with the passwords themselves. This screen carried a full-page password
// door - the closing of a gap the M3 reconcile left open - and it was deleted rather than
// hidden, along with the two refusal reasons that were its only trigger (@jeopardy/protocol
// room/server-messages.ts). The gate stays because the failure it guards is silent: a password
// field that survived the removal would ask for a secret no room can check and no host can
// give, and it would look exactly like a working door.
describe("no door in front of the room: the code is the only thing that admits anybody", () => {
  it("renders the ordinary joining screen, with nothing to type a secret into", () => {
    const body = bodyOf(newStore());
    expect(body).toContain("Choose your character");
    expect(body).not.toContain('type="password"');
    expect(body.toLowerCase()).not.toContain("password");
  });
});
