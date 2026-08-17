import { describe, expect, it } from "vitest";
import {
  applyExpectingRejection,
  eventsOfType,
  run,
  runOn,
  startedGame,
  testSetup,
} from "./testing.ts";
import type { Run } from "./testing.ts";

function withOpenClue(game: Run, at = 2100): Run {
  return runOn(game, [{ type: "select-cell", at, category: 0, row: 0 }]);
}

describe("matrix #11: arm modes", () => {
  it("manual: buzzers stay dead until the host arms", () => {
    let game = withOpenClue(startedGame(testSetup()));
    expect(game.state.phase).toBe("reading");
    game = runOn(game, [{ type: "arm-buzzers", at: 3000 }]);
    expect(game.state.phase).toBe("armed");
    expect(eventsOfType(game.events, "buzzers-armed")[0]?.armedAt).toBe(3000);
  });

  it("auto-after-delay: presenting the clue emits the auto-arm timer hint", () => {
    const game = withOpenClue(
      startedGame(
        testSetup({
          overrides: { buzzing: { armMode: "auto-after-delay", autoArmDelayMs: 2500 } },
        }),
      ),
    );
    const hint = eventsOfType(game.events, "timer-set").find((event) => event.kind === "auto-arm");
    expect(hint?.durationMs).toBe(2500);
  });

  it("arming outside reading is rejected", () => {
    const game = startedGame(testSetup());
    expect(applyExpectingRejection(game, { type: "arm-buzzers", at: 3000 })).toBe("not-reading");
  });
});

describe("matrix #12: early-buzz lockout", () => {
  it("buzzing during reading locks the presser out past arming", () => {
    let game = withOpenClue(startedGame(testSetup()));
    game = runOn(game, [
      { type: "buzz", at: 2500, playerId: "p1" }, // early: locked until 2750
      { type: "arm-buzzers", at: 2600 },
    ]);
    const early = eventsOfType(game.events, "early-buzz")[0];
    expect(early).toMatchObject({ playerId: "p1", lockedUntil: 2750 });
    // Still locked at 2700: no winner, silent per-phone feedback, and the press re-triggers
    // the lockout (2700 + 250 = 2950) - mashing keeps you out, like the TV hardware.
    game = runOn(game, [{ type: "buzz", at: 2700, playerId: "p1" }]);
    expect(eventsOfType(game.events, "buzz-rejected").at(-1)).toMatchObject({
      playerId: "p1",
      reason: "early-lockout",
    });
    expect(game.state.clue?.buzzWinner).toBeNull();
    expect(game.state.clue?.earlyLockedUntil.p1).toBe(2950);
  });

  it("each early press re-triggers; mashing keeps you locked", () => {
    let game = withOpenClue(startedGame(testSetup()));
    game = runOn(game, [
      { type: "buzz", at: 2500, playerId: "p1" },
      { type: "buzz", at: 2700, playerId: "p1" },
      { type: "arm-buzzers", at: 2800 },
    ]);
    // Second early press moved the lockout to 2950; a press at 2900 re-triggers it again
    // (now 3150), and the rival wins cleanly at 2960 while p1 is still out.
    game = runOn(game, [{ type: "buzz", at: 2900, playerId: "p1" }]);
    expect(eventsOfType(game.events, "buzz-rejected").at(-1)?.reason).toBe("early-lockout");
    expect(game.state.clue?.earlyLockedUntil.p1).toBe(3150);
    game = runOn(game, [{ type: "buzz", at: 2960, playerId: "p2" }]);
    expect(game.state.clue?.buzzWinner?.playerId).toBe("p2");
  });

  // M6: a re-trigger has to be VISIBLE, or mashing feels like a broken buzzer rather than a
  // penalty. The event carrying the new deadline is what a phone draws its penalty ring from,
  // and what the room DO forwards privately (apps/realtime/src/game-room-do.ts).
  it("re-triggering after arming narrates the new deadline, not just a rejection", () => {
    let game = withOpenClue(startedGame(testSetup()));
    game = runOn(game, [
      { type: "buzz", at: 2500, playerId: "p1" }, // early: locked until 2750
      { type: "arm-buzzers", at: 2600 },
      { type: "buzz", at: 2700, playerId: "p1" }, // mash: locked until 2950
    ]);
    const early = eventsOfType(game.events, "early-buzz");
    expect(early.map((event) => event.lockedUntil)).toEqual([2750, 2950]);
    expect(early.at(-1)?.entityId).toBe("p1");
    expect(eventsOfType(game.events, "buzz-rejected").at(-1)?.reason).toBe("early-lockout");
  });

  it("the lockout expires: an early buzzer may win once their penalty passes", () => {
    let game = withOpenClue(startedGame(testSetup()));
    game = runOn(game, [
      { type: "buzz", at: 2500, playerId: "p1" }, // locked until 2750
      { type: "arm-buzzers", at: 2600 },
      { type: "buzz", at: 2800, playerId: "p1" },
    ]);
    expect(game.state.clue?.buzzWinner?.playerId).toBe("p1");
  });

  it("0ms turns the penalty off entirely", () => {
    let game = withOpenClue(
      startedGame(testSetup({ overrides: { buzzing: { earlyBuzzLockoutMs: 0 } } })),
    );
    expect(applyExpectingRejection(game, { type: "buzz", at: 2500, playerId: "p1" })).toBe(
      "not-armed",
    );
    game = runOn(game, [
      { type: "arm-buzzers", at: 2600 },
      { type: "buzz", at: 2601, playerId: "p1" },
    ]);
    expect(game.state.clue?.buzzWinner?.playerId).toBe("p1");
  });
});

describe("buzz adjudication: first valid buzz wins", () => {
  it("mass buzz: exactly one buzz-won per arming; the rest get buzz-rejected", () => {
    let game = startedGame(testSetup({}), 6);
    game = withOpenClue(game);
    game = runOn(game, [{ type: "arm-buzzers", at: 3000 }]);
    const buzzes = ["p4", "p2", "p6", "p1", "p3", "p5"].map((playerId, index) => ({
      type: "buzz" as const,
      at: 3050, // identical timestamps: ARRIVAL ORDER decides, not the clock
      playerId,
      index,
    }));
    for (const { index, ...buzz } of buzzes) {
      const before = game.state;
      if (index === 0) {
        game = runOn(game, [buzz]);
      } else {
        expect(applyExpectingRejection(game, buzz)).toBe("too-late");
        expect(game.state).toBe(before);
      }
    }
    expect(eventsOfType(game.events, "buzz-won")).toHaveLength(1);
    expect(eventsOfType(game.events, "buzz-won")[0]?.playerId).toBe("p4");
    expect(game.state.phase).toBe("answering");
  });

  it("an unknown player's buzz is rejected with feedback", () => {
    let game = withOpenClue(startedGame(testSetup()));
    game = runOn(game, [{ type: "arm-buzzers", at: 3000 }]);
    expect(applyExpectingRejection(game, { type: "buzz", at: 3100, playerId: "ghost" })).toBe(
      "unknown-player",
    );
  });

  it("winning the buzz starts the answer-window timer (matrix #14 hint)", () => {
    let game = withOpenClue(startedGame(testSetup()));
    game = runOn(game, [
      { type: "arm-buzzers", at: 3000 },
      { type: "buzz", at: 3100, playerId: "p1" },
    ]);
    const hint = eventsOfType(game.events, "timer-set").find(
      (event) => event.kind === "answer-window",
    );
    expect(hint?.durationMs).toBe(5000);
  });
});

describe("matrix #13: buzz window", () => {
  it("emits the window hint on arming and dies to a dead clue on expiry", () => {
    let game = withOpenClue(startedGame(testSetup({ seed: "buzz-window" })));
    const controller = game.state.controlEntity;
    game = runOn(game, [{ type: "arm-buzzers", at: 3000 }]);
    const hint = eventsOfType(game.events, "timer-set").find(
      (event) => event.kind === "buzz-window",
    );
    expect(hint?.durationMs).toBe(5000);
    game = runOn(game, [{ type: "buzz-timeout", at: 8000 }]);
    expect(game.state.phase).toBe("awaiting-selection");
    expect(game.state.controlEntity).toBe(controller); // dead clue never moves the pick
    const finished = eventsOfType(game.events, "clue-finished")[0];
    expect(finished).toMatchObject({ resolution: "dead", reveal: "auto-display" });
  });

  it("null window emits no hint (host closes by hand with the same action)", () => {
    let game = withOpenClue(
      startedGame(testSetup({ overrides: { buzzing: { buzzWindowMs: null } } })),
    );
    game = runOn(game, [{ type: "arm-buzzers", at: 3000 }]);
    const hints = eventsOfType(game.events, "timer-set").filter(
      (event) => event.kind === "buzz-window",
    );
    expect(hints).toHaveLength(0);
    game = runOn(game, [{ type: "buzz-timeout", at: 60_000 }]);
    expect(game.state.phase).toBe("awaiting-selection");
  });

  it("a stale buzz-timeout after someone buzzed is rejected", () => {
    let game = withOpenClue(startedGame(testSetup()));
    game = runOn(game, [
      { type: "arm-buzzers", at: 3000 },
      { type: "buzz", at: 3100, playerId: "p2" },
    ]);
    expect(applyExpectingRejection(game, { type: "buzz-timeout", at: 8000 })).toBe("not-armed");
  });
});

describe("matrix #35/#36: team buzzing", () => {
  it("any-member: the first teammate's buzz wins for the team; the whole team locks out", () => {
    const setup = testSetup({
      overrides: {
        teams: { playerMode: "teams", teamBuzzer: "any-member" },
        buzzing: { rebound: true },
      },
      seed: "team-buzz",
    });
    let game = run(setup, [
      { type: "player-join", at: 1, playerId: "a1", name: "Ada", teamId: "tA", teamName: "Alpha" },
      { type: "player-join", at: 2, playerId: "a2", name: "Al", teamId: "tA" },
      { type: "player-join", at: 3, playerId: "b1", name: "Bea", teamId: "tB", teamName: "Beta" },
      { type: "start-game", at: 10 },
      { type: "select-cell", at: 20, category: 0, row: 0 },
      { type: "arm-buzzers", at: 30 },
      { type: "buzz", at: 40, playerId: "a2" },
    ]);
    expect(eventsOfType(game.events, "buzz-won")[0]).toMatchObject({
      playerId: "a2",
      entityId: "tA",
    });
    game = runOn(game, [{ type: "judge", at: 50, verdict: "wrong" }]);
    // Team-wide lockout (#16 at entity level): the OTHER member cannot rebound either.
    expect(applyExpectingRejection(game, { type: "buzz", at: 60, playerId: "a1" })).toBe(
      "locked-out",
    );
  });

  it("rotating-captain: only the team's captain of the clue may buzz, rotating per clue", () => {
    const setup = testSetup({
      overrides: { teams: { playerMode: "teams", teamBuzzer: "rotating-captain" } },
      seed: "team-buzz",
    });
    let game = run(setup, [
      { type: "player-join", at: 1, playerId: "a1", name: "Ada", teamId: "tA", teamName: "Alpha" },
      { type: "player-join", at: 2, playerId: "a2", name: "Al", teamId: "tA" },
      { type: "player-join", at: 3, playerId: "b1", name: "Bea", teamId: "tB", teamName: "Beta" },
      { type: "start-game", at: 10 },
      { type: "select-cell", at: 20, category: 0, row: 0 },
      { type: "arm-buzzers", at: 30 },
    ]);
    // Clue 1: captainRotation 0 -> a1 is tA's captain.
    expect(applyExpectingRejection(game, { type: "buzz", at: 40, playerId: "a2" })).toBe(
      "not-captain",
    );
    game = runOn(game, [
      { type: "buzz", at: 45, playerId: "a1" },
      { type: "judge", at: 50, verdict: "correct" },
      { type: "select-cell", at: 60, category: 0, row: 1 },
      { type: "arm-buzzers", at: 70 },
    ]);
    // Clue 2: rotation advanced -> a2 is captain now.
    expect(applyExpectingRejection(game, { type: "buzz", at: 80, playerId: "a1" })).toBe(
      "not-captain",
    );
    game = runOn(game, [{ type: "buzz", at: 85, playerId: "a2" }]);
    expect(eventsOfType(game.events, "buzz-won").at(-1)?.playerId).toBe("a2");
  });

  it("team-wide early-buzz penalty on: one member's early press locks the whole team", () => {
    const setup = testSetup({
      overrides: { teams: { playerMode: "teams", teamBuzzer: "any-member" } },
      seed: "team-buzz",
    });
    const game = run(setup, [
      { type: "player-join", at: 1, playerId: "a1", name: "Ada", teamId: "tA", teamName: "Alpha" },
      { type: "player-join", at: 2, playerId: "a2", name: "Al", teamId: "tA" },
      { type: "player-join", at: 3, playerId: "b1", name: "Bea", teamId: "tB", teamName: "Beta" },
      { type: "start-game", at: 10 },
      { type: "select-cell", at: 20, category: 0, row: 0 },
      { type: "buzz", at: 25, playerId: "a1" }, // early: tA locked until 275
      { type: "arm-buzzers", at: 30 },
    ]);
    const locked = runOn(game, [{ type: "buzz", at: 40, playerId: "a2" }]);
    expect(eventsOfType(locked.events, "buzz-rejected").at(-1)).toMatchObject({
      playerId: "a2",
      reason: "early-lockout",
    });
    expect(locked.state.clue?.buzzWinner).toBeNull();
  });

  it("team-wide penalty off: only the pressing phone is locked", () => {
    const setup = testSetup({
      overrides: {
        teams: {
          playerMode: "teams",
          teamBuzzer: "any-member",
          teamWideEarlyBuzzPenalty: false,
        },
      },
      seed: "team-buzz",
    });
    const game = run(setup, [
      { type: "player-join", at: 1, playerId: "a1", name: "Ada", teamId: "tA", teamName: "Alpha" },
      { type: "player-join", at: 2, playerId: "a2", name: "Al", teamId: "tA" },
      { type: "player-join", at: 3, playerId: "b1", name: "Bea", teamId: "tB", teamName: "Beta" },
      { type: "start-game", at: 10 },
      { type: "select-cell", at: 20, category: 0, row: 0 },
      { type: "buzz", at: 25, playerId: "a1" },
      { type: "arm-buzzers", at: 30 },
      { type: "buzz", at: 40, playerId: "a2" }, // teammate is free
    ]);
    expect(eventsOfType(game.events, "buzz-won")[0]?.playerId).toBe("a2");
  });
});
