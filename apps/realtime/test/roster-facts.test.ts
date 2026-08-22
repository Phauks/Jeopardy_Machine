// What the roster says about the PEOPLE in a room, beyond their names and teams (owner,
// 2026-08-20: "show in roster whether users are on mobile or computers", "instead of 'here',
// show an active connection symbol", "spectators still should have a name").
//
// Two of those are rendering; the third needed the wire to carry facts it never had. The
// assertions worth having here are the honest-absence ones - a device nobody reported must not
// become a guess, and a watcher who gave no name must still be counted.
import { describe, expect, it } from "vitest";
import { connectHost, initializeRoom, TestClient, uniqueCode, upgradeToRoom } from "./helpers.ts";

describe("what device a seat is on", () => {
  it("carries what the client reported, per seat", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);

    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Thumbs", deviceKind: "phone" });
    const laptop = new TestClient(await upgradeToRoom(code));
    laptop.send({ type: "join", role: "player", nickname: "Keyboard", deviceKind: "computer" });

    const roster = await host.waitFor("roster", (message) => message.roster.players.length === 2);
    const byName = new Map(
      roster.roster.players.map((entry) => [entry.identity.nickname, entry.deviceKind]),
    );
    expect(byName.get("Thumbs")).toBe("phone");
    expect(byName.get("Keyboard")).toBe("computer");
  });

  it("says NOTHING for a client that did not report one - never a default", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const quiet = new TestClient(await upgradeToRoom(code));
    quiet.send({ type: "join", role: "player", nickname: "Unsaid" });

    const roster = await host.waitFor("roster", (message) => message.roster.players.length === 1);
    expect(roster.roster.players[0]?.deviceKind).toBeUndefined();
  });

  // The device belongs to the SOCKET, not to the seat: a seat outlives a dropped phone, and
  // nobody knows what that person will come back on.
  it("forgets the device when the seat's phone goes away", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Fading", deviceKind: "phone" });
    await host.waitFor("roster", (message) => message.roster.players[0]?.deviceKind === "phone");

    phone.socket.close();
    const after = await host.waitFor(
      "roster",
      (message) => message.roster.players[0]?.connected === false,
    );
    expect(after.roster.players[0]?.deviceKind).toBeUndefined();
  });
});

describe("the audience, by name", () => {
  it("lists the watchers who gave a name", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);

    const watcher = new TestClient(await upgradeToRoom(code));
    watcher.send({ type: "join", role: "spectator", nickname: "Rosa", deviceKind: "computer" });

    const roster = await host.waitFor(
      "roster",
      (message) => (message.roster.spectators?.length ?? 0) === 1,
    );
    expect(roster.roster.spectators?.[0]).toMatchObject({
      name: "Rosa",
      deviceKind: "computer",
    });
  });

  // Naming yourself is optional, and the COUNT is the authority on how many: a list shorter
  // than the number above it is the correct rendering of a room with an anonymous watcher.
  it("counts an anonymous watcher who is not in the list", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);

    const named = new TestClient(await upgradeToRoom(code));
    named.send({ type: "join", role: "spectator", nickname: "Rosa" });
    const anonymous = new TestClient(await upgradeToRoom(code));
    anonymous.send({ type: "join", role: "spectator" });

    const roster = await host.waitFor(
      "roster",
      (message) => (message.roster.spectatorCount ?? 0) === 2,
    );
    expect(roster.roster.spectatorCount).toBe(2);
    const spectators = roster.roster.spectators ?? [];
    expect(spectators).toHaveLength(2);
    expect(spectators.filter((entry) => entry.name === null)).toHaveLength(1);
    expect(spectators.filter((entry) => entry.name === "Rosa")).toHaveLength(1);
  });

  it("never names a DISPLAY - a projector is furniture, not a member of the audience", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);

    const projector = new TestClient(await upgradeToRoom(code));
    projector.send({ type: "join", role: "display", nickname: "Big Screen" });
    await projector.waitFor("welcome");

    const watcher = new TestClient(await upgradeToRoom(code));
    watcher.send({ type: "join", role: "spectator", nickname: "Rosa" });
    const roster = await host.waitFor(
      "roster",
      (message) => (message.roster.spectators?.length ?? 0) > 0,
    );
    expect(roster.roster.spectators?.map((entry) => entry.name)).toEqual(["Rosa"]);
    expect(roster.roster.spectatorCount).toBe(1);
  });

  it("drops a watcher from the list when they leave", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const watcher = new TestClient(await upgradeToRoom(code));
    watcher.send({ type: "join", role: "spectator", nickname: "Passing Through" });
    await host.waitFor("roster", (message) => (message.roster.spectators?.length ?? 0) === 1);

    watcher.socket.close();
    const after = await host.waitFor(
      "roster",
      (message) => (message.roster.spectators?.length ?? 0) === 0,
    );
    expect(after.roster.spectatorCount).toBe(0);
  });
});
