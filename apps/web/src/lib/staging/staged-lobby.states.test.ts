// The staged lobby's two views over one roster: the roster-to-stations mapping, and the 2D
// degradation that has to carry the same answer when there is no WebGL.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import StagedLobby from "#lib/staging/staged-lobby.svelte";
import StagedLobby2d from "#lib/staging/staged-lobby-2d.svelte";
import { stagingFromRoom } from "#lib/staging/room-staging.ts";
import { stagingThemeById, stagingThemes } from "#lib/staging/staging-theme-registry.ts";
import { themeStagingSchema } from "@jeopardy/protocol";
import { boatsStagingTheme } from "#lib/staging/staging-themes/boats.ts";
import { campfiresStagingTheme } from "#lib/staging/staging-themes/campfires.ts";
import { accentById } from "#lib/avatars/avatar-manifest.ts";
import { fixtureRosterView } from "#lib/room/fixture-room.ts";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import type { RoomView } from "#lib/room/room-view.ts";

const roster = fixtureRosterView();

function lobbyView(): RoomView {
  const store = new LocalSimRoomStore({ roomCode: "DUMYX", role: "display", seed: "staging" });
  return store.view;
}

describe("stagingFromRoom", () => {
  const view = lobbyView();
  const staging = stagingFromRoom(view);

  it("makes one station per team, carrying the team's name and palette colour", () => {
    expect(staging.stations).toHaveLength(roster.teams.length);
    for (const team of roster.teams) {
      const station = staging.stations.find((entry) => entry.stationId === team.teamId);
      expect(station?.label).toBe(team.name);
      expect(station?.colorHex).toBe(accentById(team.colorId).hex);
    }
  });

  it("puts every player on exactly one station or in the holding area", () => {
    const seated = staging.stations.flatMap((station) => station.memberIds);
    const all = [...seated, ...staging.waitingEntityIds];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(view.roster.players.length);
  });

  it("leaves the fixture's unteamed late joiners in the water", () => {
    const unteamed = view.roster.players.filter((player) => player.teamId === null);
    expect(unteamed.length).toBeGreaterThan(0);
    for (const player of unteamed) {
      expect(staging.waitingEntityIds).toContain(player.playerId);
    }
  });

  it("orders the holding area by join time, so boarding never reshuffles the queue", () => {
    const joinTimes = staging.waitingEntityIds.map(
      (id) => view.roster.players.find((player) => player.playerId === id)?.joinedAt ?? 0,
    );
    expect(joinTimes).toEqual(joinTimes.toSorted((left, right) => left - right));
  });

  it("marks team leaders and the viewer's own chip", () => {
    const leaderIds = new Set(roster.teams.map((team) => team.leaderPlayerId));
    for (const occupant of staging.occupants) {
      expect(occupant.leader).toBe(leaderIds.has(occupant.entityId));
    }
    // Nobody is "self" on a display connection - it has no seat.
    expect(staging.occupants.every((occupant) => occupant.self === false)).toBe(true);
  });

  it("stations nobody in an individuals-mode room: everyone waits in the water", () => {
    const soloView: RoomView = { ...view, playerMode: "individuals" };
    const solo = stagingFromRoom(soloView);
    expect(solo.stations).toHaveLength(0);
    expect(solo.waitingEntityIds).toHaveLength(soloView.roster.players.length);
  });

  it("mixed draws the stations that exist AND leaves the soloists in the water", () => {
    // The picture teams mode never shows: some people aboard, some deliberately not. Standing
    // apart is a choice here, not a step somebody has not taken yet.
    const mixed = stagingFromRoom({ ...view, playerMode: "mixed" });
    expect(mixed.stations).toHaveLength(view.roster.teams.length);
    const teamless = view.roster.players.filter((player) => player.teamId === null);
    expect(mixed.waitingEntityIds).toHaveLength(teamless.length);
  });
});

describe("the 2D staged view (no WebGL)", () => {
  const view = lobbyView();
  const { stations, occupants, waitingEntityIds } = stagingFromRoom(view);

  it("still shows the boats and the water as layout, not an empty box", () => {
    const { body } = render(StagedLobby2d, {
      props: { theme: boatsStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(body).toContain("the water");
    expect(body).toContain("boat");
    for (const station of stations) {
      // The nameplate and the hull colour, which is the whole answer this view must carry.
      expect(body).toContain(station.label);
      expect(body).toContain(station.colorHex);
    }
  });

  it("shows each crew aboard its own station and everyone else in the holding area", () => {
    const { body } = render(StagedLobby2d, {
      props: { theme: boatsStagingTheme, stations, occupants, waitingEntityIds },
    });
    for (const occupant of occupants) {
      expect(body).toContain(occupant.label);
    }
    expect(body).not.toContain("Everybody has picked a team");
  });

  it("takes the theme's nouns from the theme, so a second theme reads correctly", () => {
    const { body } = render(StagedLobby2d, {
      props: { theme: campfiresStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(body).toContain("the clearing");
    expect(body).toContain("campfire");
    expect(body).not.toContain("the water");
  });

  // Owner report, 2026-08-16: "I don't understand still in the water." These four assertions
  // are the fix stated as behaviour - the holding area has to say what it is, what to do, and
  // how many people are in it, and it has to look like a bounded place rather than a gap.
  it("labels the holding area in WORDS, not just as a position", () => {
    const { body } = render(StagedLobby2d, {
      props: { theme: boatsStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(body).toContain("Waiting to board");
    expect(body).toContain("Choose a team to board");
    expect(body).toContain(`${String(waitingEntityIds.length)} waiting`);
  });

  it("re-speaks that label in the theme's own verb", () => {
    const { body } = render(StagedLobby2d, {
      props: { theme: campfiresStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(body).toContain("Waiting to join");
    expect(body).not.toContain("Waiting to board");
  });

  it("draws the holding area as a bounded place, with its noun on the boundary", () => {
    const { body } = render(StagedLobby2d, {
      props: { theme: boatsStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(body).toContain("holding-noun");
    expect(body).toContain("the water");
    // A region with a name, so a screen reader is told the same thing the projector shows.
    expect(body).toContain('aria-label="Waiting to board"');
  });

  it("puts the crew's names BENEATH each station, not only inside it", () => {
    const { body } = render(StagedLobby2d, {
      props: { theme: boatsStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(body).toContain("crew-plate");
    const first = stations[0];
    expect(first).toBeDefined();
    for (const memberId of first?.memberIds ?? []) {
      const member = occupants.find((occupant) => occupant.entityId === memberId);
      expect(body).toContain(member?.label ?? "@@never@@");
    }
  });

  it("counts the overflow when a station has more crew than the plate holds", () => {
    const crowded = [
      {
        stationId: "big",
        label: "Everybody",
        colorHex: "#ff8800",
        memberIds: occupants.map((occupant) => occupant.entityId),
      },
    ];
    const { body } = render(StagedLobby2d, {
      props: { theme: boatsStagingTheme, stations: crowded, occupants, waitingEntityIds: [] },
    });
    expect(body).toContain(`+${String(occupants.length - 6)} more`);
    // ...and the water, now empty, still says so rather than going blank.
    expect(body).toContain("Nobody in the water");
  });

  it("says something useful when there are no teams yet", () => {
    const { body } = render(StagedLobby2d, {
      props: {
        theme: boatsStagingTheme,
        stations: [],
        occupants,
        waitingEntityIds: occupants.map((occupant) => occupant.entityId),
      },
    });
    expect(body).toContain("No boats yet");
  });

  it("is only tappable when the surface offers boarding", () => {
    const readOnly = render(StagedLobby2d, {
      props: { theme: boatsStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(readOnly.body).not.toContain('<button class="station');

    const selectable = render(StagedLobby2d, {
      props: {
        theme: boatsStagingTheme,
        stations,
        occupants,
        waitingEntityIds,
        onSelectStation: () => undefined,
      },
    });
    expect(selectable.body).toContain("<button");
  });
});

describe("the staged lobby wrapper", () => {
  const view = lobbyView();
  const { stations, occupants, waitingEntityIds } = stagingFromRoom(view);

  it("renders the 2D staged view first, so no device ever sees an empty stage", () => {
    // SSR has no WebGL by definition, which is also the no-WebGL browser's steady state.
    const { body } = render(StagedLobby, {
      props: { theme: boatsStagingTheme, stations, occupants, waitingEntityIds },
    });
    expect(body).toContain("staged-lobby");
    expect(body).toContain("the water");
    expect(body).toContain(stations[0]?.label ?? "@@never@@");
  });

  it('keeps the staged layout even with environment "none" (the clean-2D setting)', () => {
    const { body } = render(StagedLobby, {
      props: {
        theme: boatsStagingTheme,
        stations,
        occupants,
        waitingEntityIds,
        environment: "none",
      },
    });
    expect(body).not.toContain("<canvas");
    expect(body).toContain("the water");
  });
});

// The theme document's `staging` slot (packages/protocol/src/theme/theme.ts, landed at the
// 2026-08-16 reconcile). What matters is that the two vocabularies stay ONE vocabulary: a
// theme that names a staging theme this build ships must resolve to it, and a build that ships
// one the schema has never heard of would make valid documents unwritable.
describe("the staging slot on the theme document", () => {
  it("ships exactly the themes the protocol enum names", () => {
    expect(stagingThemes.map((theme) => theme.id).toSorted()).toEqual(
      [...themeStagingSchema.options].toSorted(),
    );
  });

  it("resolves every document value to a real theme, and anything else to the default", () => {
    for (const id of themeStagingSchema.options) {
      expect(stagingThemeById(id).id).toBe(id);
    }
    // A theme document is data and data can be old (or newer than this build): an unknown id
    // falls back rather than throwing, because a projector must not go blank over a string.
    expect(stagingThemeById("spaceships").id).toBe(boatsStagingTheme.id);
    expect(stagingThemeById(null).id).toBe(boatsStagingTheme.id);
  });
});
