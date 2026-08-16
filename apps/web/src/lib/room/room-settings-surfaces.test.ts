// The room's own settings, as the surfaces that must respect them actually render
// (docs/decisions/2026-08-14-room-controls-and-staging.md, wired at the 2026-08-16 reconcile).
//
// Two of these assertions are the kind that must be negative to mean anything. Streamer mode
// is not "the code looks hidden" - it is "the code is NOT IN THE MARKUP", which is the only
// version of the promise that survives a screenshot, a paused stream, or somebody scrolling
// the DOM of a projector laptop. Same shape as the mirror-mode assertions in
// host-console.states.test.ts, and for the same reason.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import CharacterScreen from "#lib/room/character-screen.svelte";
import DisplayScreen from "#lib/room/display-screen.svelte";
import TeamScreen from "#lib/room/team-screen.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { joinBlock, refusalCopy } from "#lib/room/room-refusal.ts";
import { refusalReasonSchema } from "@jeopardy/protocol/room/server-messages";
import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";
import type { RoomRoleView } from "#lib/room/room-view.ts";

const roomCode = "BQKX7";

function roomStore(
  settings: Partial<RoomSettings> = {},
  options: { role?: RoomRoleView; seedRoster?: "fixture" | "empty" } = {},
): LocalSimRoomStore {
  return new LocalSimRoomStore({
    roomCode,
    role: options.role ?? "display",
    seed: "settings",
    seedRoster: options.seedRoster ?? "fixture",
    settings,
  });
}

describe("streamer mode on the display (hideJoinCode)", () => {
  it("prints the code and the QR when the host is not streaming", () => {
    const { body } = render(DisplayScreen, {
      props: { store: roomStore(), joinOrigin: "https://play.test" },
    });
    expect(body).toContain(roomCode);
    expect(body).toContain("<svg");
    expect(body).toContain(`play.test/room/${roomCode}`);
  });

  it("NEVER renders the code, the QR, or the join URL when the code is hidden", () => {
    const { body } = render(DisplayScreen, {
      props: {
        store: roomStore({ hideJoinCode: true }),
        joinOrigin: "https://play.test",
      },
    });
    expect(body).not.toContain(roomCode);
    // The QR encodes the code, so it goes with it - and it is the easiest thing in the room
    // to photograph off a stream.
    expect(body).not.toContain("<svg");
    // ...as does the join URL, which CONTAINS the code.
    expect(body).not.toContain("play.test/room");
  });

  it("replaces them with a deliberate affordance, not a hole in the screen", () => {
    const { body } = render(DisplayScreen, { props: { store: roomStore({ hideJoinCode: true }) } });
    expect(body).toContain("Join code hidden");
    // The room still has to read as joinable to the people in it - the code exists, it is just
    // not being broadcast, and the host's own screen is where it lives.
    expect(body).toContain("Ask the host for the code");
    // The census stays: how many are in is not a secret.
    expect(body).toContain("players in");
  });

  it("keeps the room itself untouched - hiding is a rendering decision", () => {
    const store = roomStore({ hideJoinCode: true });
    expect(store.view.roomCode).toBe(roomCode);
    expect(store.view.settings.hideJoinCode).toBe(true);
  });
});

describe("refusal copy", () => {
  it("has a sentence for every reason the protocol can send", () => {
    for (const reason of refusalReasonSchema.options) {
      const copy = refusalCopy(reason);
      expect(copy.headline.length, reason).toBeGreaterThan(0);
      // Never the protocol's own vocabulary on a player's screen.
      expect(copy.headline.toLowerCase(), reason).not.toContain(reason);
    }
  });

  it("keeps the two spectator refusals apart - they need different advice", () => {
    expect(refusalCopy("spectators-full").headline).not.toBe(
      refusalCopy("spectators-not-allowed").headline,
    );
    expect(refusalCopy("spectators-full").advice).toContain("minute");
    expect(refusalCopy("room-full").headline).not.toBe(refusalCopy("spectators-full").headline);
  });
});

describe("the join screens respect the room's door", () => {
  it("refuses gracefully when the room is at its player cap", () => {
    const store = roomStore({ maxPlayers: 2 }, { role: "player" });
    const blocked = joinBlock(store.view);
    expect(blocked?.headline).toBe("This room is full");

    const { body } = render(CharacterScreen, {
      props: {
        roomCode,
        roster: store.view.roster,
        teamsMode: true,
        blocked,
        onConfirm: () => undefined,
      },
    });
    expect(body).toContain("This room is full");
    expect(body).toContain("disabled");
    // The choices stay usable: a seat may free up while you are picking a creature.
    expect(body).toContain("Choose your character");
  });

  it("refuses a spectator when the host allows no audience, and lets one in otherwise", () => {
    const off = roomStore({ spectatorsAllowed: false }, { role: "spectator" });
    expect(joinBlock(off.view)?.headline).toBe("This host is not taking spectators");
    expect(joinBlock(roomStore({}, { role: "spectator" }).view)).toBeNull();
  });

  it("never blocks a player who already has a seat, whatever the cap became", () => {
    const store = roomStore({ maxPlayers: 1 }, { role: "player", seedRoster: "empty" });
    store.join({ nickname: "Lorax", avatarId: null, accentId: null, buzzSoundId: null });
    // Nobody is ever ejected by a settings edit (room-settings.ts) - and a full room is not a
    // reason to bounce the person already standing in it back to the character screen.
    expect(joinBlock(store.view)).toBeNull();
  });

  it("turns the room's own refusal into a sentence on the team screen", () => {
    const store = roomStore({}, { role: "player", seedRoster: "empty" });
    store.join({ nickname: "Lorax", avatarId: null, accentId: null, buzzSoundId: null });
    store.createTeam("The Lorax Society");
    const teamId = store.view.roster.teams[0]?.teamId ?? "";
    store.updateTeam({ locked: true }, teamId);
    store.kickFromTeam(store.view.myPlayerId ?? "");
    store.joinTeam(teamId);
    expect(store.view.refusal?.reason).toBe("team-locked");

    const { body } = render(TeamScreen, { props: { store, onPlaySolo: () => undefined } });
    expect(body).toContain("That team is locked");
    expect(body).not.toContain("team-locked");
  });

  it("refuses the join itself at the cap, with the protocol's own reason", () => {
    const store = roomStore({ maxPlayers: 1 }, { role: "player", seedRoster: "empty" });
    store.join({ nickname: "First", avatarId: null, accentId: null, buzzSoundId: null });
    const seated = store.view.myPlayerId;
    store.join({ nickname: "Second", avatarId: null, accentId: null, buzzSoundId: null });
    // The refused join changes nothing: no seat taken, no identity replaced.
    expect(store.view.roster.players).toHaveLength(1);
    expect(store.view.myPlayerId).toBe(seated);
    expect(store.view.refusal?.reason).toBe("room-full");
  });
});
