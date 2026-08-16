// The pre-game journey - character, team, lobby - server-rendered, plus the pure stage
// derivation that decides which of them a phone is looking at.
//
// The stage function gets the hardest tests here, because the transitions that matter most are
// the ones nobody clicks: being kicked back to team selection, and the host starting the game
// while you are still choosing.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import CharacterScreen from "#lib/room/character-screen.svelte";
import LobbyScreen from "#lib/room/lobby-screen.svelte";
import TeamCard from "#lib/room/team-card.svelte";
import TeamScreen from "#lib/room/team-screen.svelte";
import { buzzSoundCatalog } from "#lib/room/buzz-sound-catalog.ts";
import { fixtureRosterView } from "#lib/room/fixture-room.ts";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { playerRouteStageFor } from "#lib/room/pre-game-stage.ts";
import type { RoomView } from "#lib/room/room-view.ts";

const roster = fixtureRosterView();
const firstTeamId = roster.teams[0]?.teamId ?? "";

function joinedStore(options: { team?: boolean } = {}): LocalSimRoomStore {
  const store = new LocalSimRoomStore({ roomCode: "DUMYX", role: "player", seed: "lobby" });
  store.join({
    nickname: "Lorax",
    avatarId: "fish",
    accentId: "moss",
    buzzSoundId: "loon",
    ...(options.team === true ? { team: { kind: "join" as const, teamId: firstTeamId } } : {}),
  });
  return store;
}

describe("which pre-game screen a phone is on", () => {
  const noSolo = { soloAccepted: false };

  it("asks for a character until the phone has a seat", () => {
    const store = new LocalSimRoomStore({ roomCode: "DUMYX", role: "player", seed: "stage" });
    expect(playerRouteStageFor(store.view, noSolo)).toBe("character");
  });

  it("asks for a team once you are in the room but on nobody's team", () => {
    expect(playerRouteStageFor(joinedStore().view, noSolo)).toBe("team");
  });

  it("goes to the lobby once you are aboard one", () => {
    expect(playerRouteStageFor(joinedStore({ team: true }).view, noSolo)).toBe("lobby");
  });

  it("stops asking about teams once you have chosen to play alone", () => {
    expect(playerRouteStageFor(joinedStore().view, { soloAccepted: true })).toBe("lobby");
  });

  it("never asks about teams in an individuals-mode room", () => {
    const view: RoomView = { ...joinedStore().view, teamsMode: false };
    expect(playerRouteStageFor(view, noSolo)).toBe("lobby");
  });

  it("returns a kicked player to team selection with no code path of its own", () => {
    const store = joinedStore({ team: true });
    expect(playerRouteStageFor(store.view, noSolo)).toBe("lobby");
    store.kickFromTeam(store.view.myPlayerId ?? "");
    expect(playerRouteStageFor(store.view, noSolo)).toBe("team");
  });

  it("puts every phone on the buzzer when the room starts, wherever it was", () => {
    const store = joinedStore();
    expect(playerRouteStageFor(store.view, noSolo)).toBe("team");
    store.startGame();
    expect(playerRouteStageFor(store.view, noSolo)).toBe("playing");
  });

  it("still asks a mid-game arrival for a character first", () => {
    const store = new LocalSimRoomStore({ roomCode: "DUMYX", role: "player", seed: "late" });
    store.startGame();
    expect(playerRouteStageFor(store.view, noSolo)).toBe("character");
  });
});

describe("character screen (A2, the identity moment)", () => {
  const { body } = render(CharacterScreen, {
    props: { roomCode: "DUMYX", roster, teamsMode: true, onConfirm: () => undefined },
  });

  it("leads with the moving preview, then the name, look, and sound", () => {
    expect(body).toContain("Choose your character");
    expect(body).toContain("Your name");
    expect(body).toContain("Look");
    expect(body).toContain("Buzzer sound");
    // The animated walk sheet is the preview - the whole reason this screen is its own screen.
    expect(body).toContain("avatar-animated");
    expect(body.indexOf("avatar-animated")).toBeLessThan(body.indexOf("Your name"));
  });

  it("lists all 14 approved buzz sounds by display name", () => {
    expect(buzzSoundCatalog).toHaveLength(14);
    for (const sound of buzzSoundCatalog) {
      expect(body).toContain(sound.label);
    }
  });

  it("does NOT ask about teams - that is the next screen's question", () => {
    expect(body).not.toContain("Pick your team");
    for (const team of roster.teams) {
      expect(body).not.toContain(team.name);
    }
  });

  it("explains team-scoped audio in teams mode (the double-confirmation rule)", () => {
    expect(body).toContain("the room hears your team");
  });

  it("names the next step honestly in each mode", () => {
    expect(body).toContain("Next: pick a team");
    const solo = render(CharacterScreen, {
      props: { roomCode: "DUMYX", roster, teamsMode: false, onConfirm: () => undefined },
    });
    expect(solo.body).toContain("Join the room");
    const late = render(CharacterScreen, {
      props: {
        roomCode: "DUMYX",
        roster,
        teamsMode: true,
        lateJoin: true,
        onConfirm: () => undefined,
      },
    });
    expect(late.body).toContain("Join the game");
  });

  it("shows no validation error before anyone has tried to continue", () => {
    expect(body).not.toContain('role="alert"');
  });
});

describe("team screen (A2, the choice)", () => {
  const { body } = render(TeamScreen, {
    props: { store: joinedStore(), onPlaySolo: () => undefined },
  });

  it("shows the staged lobby with you in it, above the cards", () => {
    expect(body).toContain("staged-lobby");
    expect(body).toContain("the water");
    expect(body).toContain("Lorax");
    expect(body.indexOf("staged-lobby")).toBeLessThan(body.indexOf("Start a new team"));
  });

  it("renders every team as both a station and a card", () => {
    for (const team of roster.teams) {
      // Once as a nameplate on its station, once as a card - hence at least twice.
      expect((body.match(new RegExp(team.name, "g")) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("tells you where you are and what the move looks like", () => {
    expect(body).toContain("You are in the water until you choose");
    expect(body).toContain("watches you move across");
  });

  it("offers creating a team (which makes you its leader) and playing alone", () => {
    expect(body).toContain("Start a new team");
    expect(body).toContain("Create and lead");
    expect(body).toContain("Play on my own instead");
  });

  it("disables joining a locked team", () => {
    expect(body).toContain("Locked");
  });
});

describe("team card overflow rule (owner-specified)", () => {
  const team = roster.teams[0];
  if (team === undefined) throw new Error("fixture team missing");
  const members = roster.players.filter((player) => player.teamId === team.teamId);

  it("admin viewers get the '...' trigger; kick/hand-off stay hidden until opened", () => {
    const { body } = render(TeamCard, {
      props: {
        team,
        members,
        viewerPlayerId: team.leaderPlayerId,
        viewerIsAdmin: true,
        onKick: () => undefined,
        onHandOff: () => undefined,
      },
    });
    expect(body).toContain("...");
    expect(body).not.toContain("Kick from team");
    expect(body).not.toContain("Make leader");
    expect(body).toContain("leader"); // the crown affordance
  });

  it("puts the team lock behind the team's own '...' too, never as a visible switch", () => {
    const { body } = render(TeamCard, {
      props: {
        team,
        members,
        viewerPlayerId: team.leaderPlayerId,
        viewerIsAdmin: true,
        onToggleLock: () => undefined,
      },
    });
    expect(body).toContain(`Actions for ${team.name}`);
    expect(body).not.toContain("Lock team");
    expect(body).not.toContain("Unlock team");
  });

  it("non-admin viewers get no overflow trigger at all", () => {
    const { body } = render(TeamCard, {
      props: { team, members, viewerPlayerId: members[1]?.playerId ?? null, viewerIsAdmin: false },
    });
    expect(body).not.toContain("aria-haspopup");
  });

  it("shows per-member personal identity inside the team display (both tiers visible)", () => {
    const { body } = render(TeamCard, { props: { team, members } });
    for (const member of members) {
      expect(body).toContain(member.nickname);
    }
    // Personal avatar chips render with each member's own accent, not the team color.
    expect(body).toContain("avatar-chip");
  });
});

describe("lobby (A3)", () => {
  it("greets you by name and team, with the explicit waiting state", () => {
    const { body } = render(LobbyScreen, { props: { store: joinedStore({ team: true }) } });
    expect(body).toContain("Lorax");
    expect(body).toContain(roster.teams[0]?.name ?? "@@never@@");
    expect(body).toContain("Waiting for the host to start");
  });

  it("offers buzzer practice as local-only and self-customization on your own chip", () => {
    const { body } = render(LobbyScreen, { props: { store: joinedStore({ team: true }) } });
    expect(body).toContain("Buzzer practice");
    expect(body).toContain("your phone only");
    expect(body).toContain("change look");
  });

  it("keeps the staged view live, so a team change is still a visible move here", () => {
    const { body } = render(LobbyScreen, { props: { store: joinedStore({ team: true }) } });
    expect(body).toContain("staged-lobby");
    // The stations are tappable in the lobby too - changing your mind before the game is fine.
    expect(body).toContain('aria-pressed="true"');
  });

  it("names the holding area rather than saying 'solo' for people still waiting", () => {
    const { body } = render(LobbyScreen, { props: { store: joinedStore({ team: true }) } });
    expect(body).toContain("Still in the water");
  });
});
