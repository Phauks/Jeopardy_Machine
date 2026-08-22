// A host retuning the rules of a RUNNING room (owner, 2026-08-20: the answer timer "should be
// settable by the host", and losing points for a wrong answer should be a setting they can
// reach). Both were rules-matrix rows already and both were frozen at room creation, because
// rules ride inside the game definition and `setup` is written once.
//
// What makes that safe to relax is the subset, not the permission check: @jeopardy/protocol
// room/live-rules.ts lets through only rules the engine reads FRESH when it needs them. The
// assertions that matter here are therefore the ones about the running game continuing to
// make sense afterwards, and about the change SURVIVING - a room evicted a second after the
// host lengthens the answer clock must come back with the longer clock.
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  connectBot,
  connectHost,
  initializeRoom,
  instantBot,
  roomStub,
  TestClient,
  uniqueCode,
  upgradeToRoom,
} from "./helpers.ts";
import type { GameRoomDO } from "../src/index.ts";
import type { GameSetup } from "@jeopardy/engine/setup";

describe("retuning a live room's rules", () => {
  it("tells every connection the rules on join, not just the host", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    expect((await host.waitFor("game-rules")).rules.answerWindowMs).toBe(5000);

    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Ada" });
    // A phone draws its own answer clock, so it has to be told the length before it needs it.
    expect((await phone.waitFor("game-rules")).rules.answerWindowMs).toBe(5000);
  });

  it("changes the answer clock for EVERYONE at once, not just the console", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Maya" });
    await phone.waitFor("game-rules");

    host.send({ type: "update-game-rules", rules: { buzzing: { answerWindowMs: 12_000 } } });
    // Both sides move together, or one of them is lying to the room about the clock it runs.
    expect(
      (await host.waitFor("game-rules", (message) => message.rules.answerWindowMs === 12_000)).rules
        .answerWindowMs,
    ).toBe(12_000);
    expect(
      (await phone.waitFor("game-rules", (message) => message.rules.answerWindowMs === 12_000))
        .rules.answerWindowMs,
    ).toBe(12_000);
  });

  it("carries the owner's other ask: a wrong answer that costs nothing", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await host.waitFor("game-rules");

    host.send({ type: "update-game-rules", rules: { scoring: { wrongAnswerPenalty: "none" } } });
    const rules = (
      await host.waitFor("game-rules", (message) => message.rules.wrongAnswerPenalty === "none")
    ).rules;
    // Untouched fields are not reset to their defaults by a sparse patch.
    expect(rules.answerWindowMs).toBe(5000);
  });

  // NO CLOCK AT ALL (owner, 2026-08-20: "time to answer should allow for no time limit"), and
  // the assertion that matters is that it survives the round trip as null rather than being
  // coerced into a number somewhere between the console and the engine.
  it("turns the answer clock off entirely, and back on again", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await host.waitFor("game-rules");

    host.send({ type: "update-game-rules", rules: { buzzing: { answerWindowMs: null } } });
    expect(
      (await host.waitFor("game-rules", (message) => message.rules.answerWindowMs === null)).rules
        .answerWindowMs,
    ).toBeNull();

    host.send({ type: "update-game-rules", rules: { buzzing: { answerWindowMs: 9000 } } });
    expect(
      (await host.waitFor("game-rules", (message) => message.rules.answerWindowMs === 9000)).rules
        .answerWindowMs,
    ).toBe(9000);
  });

  // The assertion that makes the rest matter: the number does not merely travel to the
  // surfaces, it is the number the ENGINE runs the next clue against. Asserted on the buzz
  // window rather than the answer window because it needs no bot to press anything - arming
  // sets it, so the test turns on the rule and nothing else.
  it("REACHES THE ENGINE: the host's number is the one the next clue runs against", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Lorax"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    await host.waitFor("game-rules");
    host.send({ type: "update-game-rules", rules: { buzzing: { buzzWindowMs: 14_000 } } });
    await host.waitFor("game-rules", (message) => message.rules.buzzWindowMs === 14_000);

    host.sendAction({ type: "start-game" });
    await host.takeEvent("game-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    const buzzTimer = host.engineEvents.find(
      (event) => event.type === "timer-set" && event.kind === "buzz-window",
    );
    // The fixture's rule set says 5000; this room is playing by the host's 14000.
    expect(buzzTimer).toMatchObject({ durationMs: 14_000 });
  });

  it("SURVIVES eviction - a rule that reverts when the DO sleeps is worse than none", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await host.waitFor("game-rules");
    host.send({ type: "update-game-rules", rules: { buzzing: { answerWindowMs: 9000 } } });
    await host.waitFor("game-rules", (message) => message.rules.answerWindowMs === 9000);

    // Drop the in-memory room exactly as an eviction would, then read from storage.
    await runInDurableObject(roomStub(code), (instance: GameRoomDO) => {
      (instance as unknown as { room: undefined }).room = undefined;
    });
    await runInDurableObject(roomStub(code), async (_instance: GameRoomDO, state) => {
      const setup = await state.storage.get<GameSetup>("setup");
      expect(setup?.settings.buzzing.answerWindowMs).toBe(9000);
    });
  });

  it("is host-only: a phone cannot make its own answers longer", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    const phone = new TestClient(await upgradeToRoom(code));
    phone.send({ type: "join", role: "player", nickname: "Chancer" });
    await phone.waitFor("game-rules");

    phone.send({ type: "update-game-rules", rules: { buzzing: { answerWindowMs: 15_000 } } });
    expect((await phone.waitFor("error")).reason).toBe("unauthorized");
    expect(
      host.messagesOf("game-rules").some((message) => message.rules.answerWindowMs !== 5000),
    ).toBe(false);
  });

  it("refuses to move a rule the running state was BUILT from", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code);
    const host = await connectHost(code, hostToken);
    await host.waitFor("game-rules");
    // Seating decided who the scoring entities are; the board on every phone is the proof.
    host.send({ type: "update-game-rules", rules: { teams: { playerMode: "teams" } } });
    expect((await host.waitFor("error")).reason).toBe("malformed");
  });
});
