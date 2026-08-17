// This browser's memory of the rooms it walked into. The rules worth holding are the ones
// that keep it a MEMORY rather than a history or an identity: newest first, one row per room,
// a hard cap, and a parse that survives whatever it finds without taking the page down.
import { describe, expect, it } from "vitest";
import {
  forgetRoomIn,
  parseRememberedRooms,
  rememberRoomIn,
  rememberedRoomsMax,
} from "#lib/lobby/room-memory.ts";
import type { RememberedRoom } from "#lib/lobby/room-memory.ts";

const at = 1_760_000_600_000;

function room(code: string, overrides: Partial<RememberedRoom> = {}): RememberedRoom {
  return { code, title: `Room ${code}`, role: "player", at, ...overrides };
}

describe("remembering", () => {
  it("puts the newest arrival first", () => {
    const list = rememberRoomIn([room("AAAAA")], room("BBBBB", { at: at + 1000 }));
    expect(list.map((entry) => entry.code)).toEqual(["BBBBB", "AAAAA"]);
  });

  it("moves a re-entered room to the front instead of duplicating it", () => {
    const list = rememberRoomIn(
      [room("AAAAA"), room("BBBBB")],
      room("BBBBB", { role: "host", at: at + 1000 }),
    );
    expect(list.map((entry) => entry.code)).toEqual(["BBBBB", "AAAAA"]);
    expect(list[0]?.role).toBe("host");
  });

  it("caps the list, so a memory never becomes a browsing history", () => {
    let list: RememberedRoom[] = [];
    for (let index = 0; index < rememberedRoomsMax + 4; index += 1) {
      list = rememberRoomIn(list, room(`R${String(index).padStart(4, "0")}`, { at: at + index }));
    }
    expect(list).toHaveLength(rememberedRoomsMax);
    expect(list[0]?.code).toBe(`R${String(rememberedRoomsMax + 3).padStart(4, "0")}`);
  });

  it("forgets one room and leaves the rest alone", () => {
    expect(forgetRoomIn([room("AAAAA"), room("BBBBB")], "AAAAA").map((e) => e.code)).toEqual([
      "BBBBB",
    ]);
  });
});

describe("reading back what some other version of this app wrote", () => {
  it("returns nothing for absent, malformed, or non-array storage", () => {
    expect(parseRememberedRooms(null)).toEqual([]);
    expect(parseRememberedRooms("{oh no")).toEqual([]);
    expect(parseRememberedRooms('{"code":"AAAAA"}')).toEqual([]);
  });

  it("drops junk entries instead of throwing the whole memory away", () => {
    const raw = JSON.stringify([
      room("AAAAA"),
      { code: "BBBBB" },
      { code: "CCCCC", title: "x", role: "spectator", at },
      room("DDDDD", { at: at + 5000 }),
    ]);
    // Sorted newest-first on the way in, so a hand-edited or out-of-order store still reads
    // in the order the page renders.
    expect(parseRememberedRooms(raw).map((entry) => entry.code)).toEqual(["DDDDD", "AAAAA"]);
  });

  it("keeps nothing but the four fields it declares - no room for a token to sneak in", () => {
    const raw = JSON.stringify([{ ...room("AAAAA"), hostToken: "secret", password: "hunter2" }]);
    expect(parseRememberedRooms(raw)[0]).toEqual(room("AAAAA"));
  });
});
