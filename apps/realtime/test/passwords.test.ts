// Room passwords end to end inside workerd (docs/decisions/2026-08-14-room-visibility-and-
// lobby.md): a shared room secret, verified in the DO, rate-limited per connection, and
// never observable from anywhere else. The properties under test are the ones that make the
// feature safe rather than the ones that make it work.
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import { roomCloseCodes } from "@jeopardy/protocol/room/server-messages";
import { hashRoomPassword, verifyRoomPassword } from "../src/room/password.ts";
import { connectHost, initializeRoom, TestClient, uniqueCode, upgradeToRoom } from "./helpers.ts";

const password = "sequoia-2026";

async function openRoom(listing: { password?: string; visibility?: "public" | "unlisted" } = {}) {
  const code = uniqueCode();
  const { hostToken } = await initializeRoom(code, undefined, "password-suite", {
    ...listing,
    ...(listing.visibility === "public" && { title: "Password suite" }),
  });
  return { code, hostToken };
}

describe("password hashing", () => {
  it("salts per room: the same password never yields the same stored hash", async () => {
    const first = await hashRoomPassword(password);
    const second = await hashRoomPassword(password);
    expect(first.hashHex).not.toBe(second.hashHex);
    expect(first.saltHex).not.toBe(second.saltHex);
    // The plaintext must not survive anywhere in the stored record.
    expect(JSON.stringify(first)).not.toContain(password);
    expect(first.algorithm).toBe("PBKDF2-SHA256");
    expect(first.iterations).toBeGreaterThanOrEqual(100_000);
  });

  it("verifies the right password and refuses near misses", async () => {
    const stored = await hashRoomPassword(password);
    expect(await verifyRoomPassword(password, stored)).toBe(true);
    const nearMisses = ["sequoia-2025", "Sequoia-2026", "sequoia-2026 ", ""];
    const verdicts = await Promise.all(
      nearMisses.map((wrong) => verifyRoomPassword(wrong, stored)),
    );
    expect(verdicts).toEqual(nearMisses.map(() => false));
  });
});

describe("joining a password room", () => {
  it("refuses a password-less join, then admits the same socket once it retries correctly", async () => {
    const { code } = await openRoom({ password });
    const phone = new TestClient(await upgradeToRoom(code));

    phone.send({ type: "join", role: "player", nickname: "Lorax" });
    const first = await phone.waitFor("refused");
    expect(first.reason).toBe("password-required");
    // The socket SURVIVES a password refusal - the phone prompts and retries in place.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(phone.closes.length).toBe(0);

    phone.send({ type: "join", role: "player", nickname: "Lorax", password });
    const welcome = await phone.waitFor("welcome");
    expect(welcome.role).toBe("player");
    expect(welcome.playerId).toBe("p-1");
  });

  it("refuses a wrong password without leaving a seat behind", async () => {
    const { code, hostToken } = await openRoom({ password });
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Impostor", password: "not-it" });
    const refused = await phone.waitFor("refused");
    expect(refused.reason).toBe("bad-password");

    // No roster broadcast, no seat, no nickname reserved: the room is untouched.
    host.send({ type: "sync" });
    const snapshot = await host.waitFor("snapshot");
    expect(snapshot.roster.players).toEqual([]);
  });

  it("closes a connection that burns its attempt budget (limits.room.passwordAttemptBurstMax)", async () => {
    const { code } = await openRoom({ password });
    const attacker = new TestClient(await upgradeToRoom(code));
    for (let attempt = 0; attempt < limits.room.passwordAttemptBurstMax; attempt += 1) {
      attacker.send({
        type: "join",
        role: "player",
        nickname: "Guesser",
        password: `guess-${String(attempt)}`,
      });
      // Sequential on purpose: the budget is counted per attempt, not per burst.
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    // Verification is deliberately slow (PBKDF2), so wait for the verdict rather than
    // guessing at a sleep long enough to cover five derivations.
    const deadline = Date.now() + 5000;
    while (attacker.closes.length === 0 && Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(
      attacker.messagesOf("refused").every((message) => message.reason === "bad-password"),
    ).toBe(true);
    expect(attacker.closes[0]?.code).toBe(roomCloseCodes.joinRefused);
  });

  it("gates displays and spectators too, but never the host (the token is the stronger claim)", async () => {
    const { code, hostToken } = await openRoom({ password });

    const display = new TestClient(await upgradeToRoom(code));
    display.send({ type: "join", role: "display" });
    expect((await display.waitFor("refused")).reason).toBe("password-required");
    display.send({ type: "join", role: "display", password });
    expect((await display.waitFor("welcome")).role).toBe("display");

    // The host console holds the creation token and joins a locked room without the password.
    const host = await connectHost(code, hostToken);
    expect(host.messagesOf("welcome")[0]?.role).toBe("host");
  });

  it("leaves open rooms exactly as they were: a password nobody asked for is ignored", async () => {
    const { code } = await openRoom();
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Maya", password: "irrelevant" });
    expect((await phone.waitFor("welcome")).playerId).toBe("p-1");
  });
});
