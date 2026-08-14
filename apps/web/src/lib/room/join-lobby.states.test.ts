// The A2 join screen and A3 lobby, server-rendered against the fixture roster: team cards
// with leader crowns, the 14 approved sounds by name, the overflow-menu rule (destructive
// actions behind "...", never exposed), and post-join customization affordances.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import JoinScreen from "#lib/room/join-screen.svelte";
import LobbyScreen from "#lib/room/lobby-screen.svelte";
import TeamCard from "#lib/room/team-card.svelte";
import { buzzSoundCatalog } from "#lib/room/buzz-sound-catalog.ts";
import { fixtureRosterView } from "#lib/room/fixture-room.ts";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";

const roster = fixtureRosterView();

describe("join screen (A2)", () => {
  const { body } = render(JoinScreen, {
    props: {
      roomCode: "DUMYX",
      roster,
      teamsMode: true,
      onJoin: () => undefined,
    },
  });

  it("is one screen: nickname, avatars, sounds, team cards, join affordances", () => {
    expect(body).toContain("Nickname");
    expect(body).toContain("Pick your look");
    expect(body).toContain("Buzzer sound");
    expect(body).toContain("Pick your team");
    expect(body).toContain("new team");
  });

  it("lists all 14 approved buzz sounds by display name", () => {
    expect(buzzSoundCatalog).toHaveLength(14);
    for (const sound of buzzSoundCatalog) {
      expect(body).toContain(sound.label);
    }
  });

  it("renders every fixture team as a card; the locked team's join button is disabled", () => {
    for (const team of roster.teams) {
      expect(body).toContain(team.name);
    }
    expect(body).toContain("Locked");
  });

  it("explains team-scoped audio in teams mode (the double-confirmation rule)", () => {
    expect(body).toContain("the room hears your team");
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
  function joinedStore(): LocalSimRoomStore {
    const store = new LocalSimRoomStore({ roomCode: "DUMYX", role: "player", seed: "lobby" });
    store.join({
      nickname: "Lorax",
      avatarId: "fish",
      accentId: "moss",
      buzzSoundId: "loon",
      team: { kind: "join", teamId: roster.teams[0]?.teamId ?? "" },
    });
    return store;
  }

  it("greets you by name and team, with the explicit waiting state", () => {
    const { body } = render(LobbyScreen, { props: { store: joinedStore() } });
    expect(body).toContain("Lorax");
    expect(body).toContain(roster.teams[0]?.name ?? "@@never@@");
    expect(body).toContain("Waiting for the host to start");
  });

  it("offers buzzer practice as local-only and self-customization on your own chip", () => {
    const { body } = render(LobbyScreen, { props: { store: joinedStore() } });
    expect(body).toContain("Buzzer practice");
    expect(body).toContain("your phone only");
    expect(body).toContain("change look");
  });
});
