// WHERE THE DUMMY ROSTER IS ALLOWED TO APPEAR - one rule, tested, because breaking it is
// invisible: a fixture roster in a real room looks exactly like a room with people in it.
//
// The owner met the failure directly (2026-08-17): a host console reporting "26/30 connected"
// for a room they had just created and nobody had joined. Every play route built a local
// simulation and seeded the 30-player fixture roster into whatever code the URL carried.
import { describe, expect, it } from "vitest";
import { seedRosterFor } from "#lib/room/create-room-store.ts";
import { fixtureRoomCode, fixtureRosterView } from "#lib/room/fixture-room.ts";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";

const noQuery = { searchParams: new URLSearchParams() };

describe("fixture data belongs to the fixture room and to ?demo", () => {
  it("seeds the dummy roster for the fixture room's own code", () => {
    expect(seedRosterFor(fixtureRoomCode, noQuery)).toBe("fixture");
    expect(seedRosterFor(fixtureRoomCode.toLowerCase(), noQuery)).toBe("fixture");
  });

  it("leaves any other code EMPTY - a created room starts with nobody in it", () => {
    expect(seedRosterFor("QWERT", noQuery)).toBe("empty");
    expect(seedRosterFor("ABCDE", noQuery)).toBe("empty");
  });

  it("still gives a reviewer the crowd on demand, explicitly", () => {
    expect(seedRosterFor("QWERT", { searchParams: new URLSearchParams("demo") })).toBe("fixture");
  });

  it("so no fixture number can reach a surface with no room data", () => {
    // The exact shape of the bug: the fixture's counts must not be what an untouched room says.
    const fixture = fixtureRosterView();
    expect(fixture.players.length).toBeGreaterThan(0);
    const room = new LocalSimRoomStore({
      roomCode: "QWERT",
      role: "host",
      seedRoster: seedRosterFor("QWERT", noQuery),
    });
    expect(room.view.roster.players).toEqual([]);
    expect(room.view.roster.teams).toEqual([]);
    // ...and the audience is unknown rather than zero, for the same reason (room-view.ts).
    expect(room.view.roster.spectatorCount).toBeNull();
  });
});
