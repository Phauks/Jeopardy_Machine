import { describe, expect, it } from "vitest";
import { createInitialState } from "./state.ts";
import { transition } from "./transition.ts";
import {
  applyExpectingRejection,
  eventsOfType,
  joinActions,
  run,
  runOn,
  startedGame,
  testSetup,
} from "./testing.ts";

describe("lobby and joining", () => {
  it("players join and start-game opens round one", () => {
    const setup = testSetup();
    const game = startedGame(setup);
    expect(game.state.phase).toBe("awaiting-selection");
    expect(game.state.entityOrder).toEqual(["p1", "p2", "p3"]);
    expect(game.state.scores).toEqual({ p1: 0, p2: 0, p3: 0 });
    expect(eventsOfType(game.events, "game-started")[0]?.entityCount).toBe(3);
    expect(eventsOfType(game.events, "round-started")[0]?.roundIndex).toBe(0);
  });

  it("start-game with nobody joined is rejected", () => {
    const setup = testSetup();
    const empty = { state: createInitialState(setup), events: [], setup };
    expect(applyExpectingRejection(empty, { type: "start-game", at: 1 })).toBe("nobody-joined");
  });

  it("a second start-game is rejected", () => {
    const game = startedGame(testSetup());
    expect(applyExpectingRejection(game, { type: "start-game", at: 3000 })).toBe("already-started");
  });

  it("duplicate player ids are rejected while connected", () => {
    const setup = testSetup();
    const game = run(setup, joinActions(2));
    expect(
      applyExpectingRejection(game, {
        type: "player-join",
        at: 1500,
        playerId: "p1",
        name: "Imposter",
      }),
    ).toBe("duplicate-player");
  });

  it("leave then rejoin keeps the seat and score (reconnection)", () => {
    const setup = testSetup();
    let game = startedGame(setup);
    game = runOn(game, [
      { type: "score-adjust", at: 2100, entityId: "p2", delta: 600 },
      { type: "player-leave", at: 2200, playerId: "p2" },
    ]);
    expect(game.state.players.p2?.connected).toBe(false);
    game = runOn(game, [{ type: "player-join", at: 2300, playerId: "p2", name: "P2 again" }]);
    expect(game.state.players.p2?.connected).toBe(true);
    expect(game.state.scores.p2).toBe(600);
    expect(game.state.entityOrder).toEqual(["p1", "p2", "p3"]);
  });
});

describe("matrix #43: late join", () => {
  it("late join rejected when disabled", () => {
    const setup = testSetup({ overrides: { join: { lateJoinAllowed: false } } });
    const game = startedGame(setup);
    expect(
      applyExpectingRejection(game, {
        type: "player-join",
        at: 3000,
        playerId: "p9",
        name: "Latecomer",
      }),
    ).toBe("late-join-disabled");
  });

  it("policy zero: late joiners start at 0", () => {
    const setup = testSetup();
    let game = startedGame(setup);
    game = runOn(game, [
      { type: "score-adjust", at: 2100, entityId: "p1", delta: -400 },
      { type: "player-join", at: 3000, playerId: "p9", name: "Latecomer" },
    ]);
    expect(game.state.scores.p9).toBe(0);
    expect(eventsOfType(game.events, "player-joined").at(-1)?.lateJoin).toBe(true);
  });

  it("policy match-lowest: matches the literal lowest score, negative included", () => {
    const setup = testSetup({ overrides: { join: { lateJoinScore: "match-lowest" } } });
    let game = startedGame(setup);
    game = runOn(game, [
      { type: "score-adjust", at: 2100, entityId: "p1", delta: -400 },
      { type: "player-join", at: 3000, playerId: "p9", name: "Latecomer" },
    ]);
    expect(game.state.scores.p9).toBe(-400);
  });

  it("policy host-prompt: seats at 0 and asks the host", () => {
    const setup = testSetup({ overrides: { join: { lateJoinScore: "host-prompt" } } });
    let game = startedGame(setup);
    game = runOn(game, [{ type: "player-join", at: 3000, playerId: "p9", name: "Latecomer" }]);
    expect(game.state.scores.p9).toBe(0);
    expect(eventsOfType(game.events, "late-join-score-needed")[0]?.playerId).toBe("p9");
    // The host answers the prompt with the always-on override (matrix row 20).
    game = runOn(game, [{ type: "score-set", at: 3100, entityId: "p9", score: 350 }]);
    expect(game.state.scores.p9).toBe(350);
  });
});

describe("matrix #34: teams as scoring entities", () => {
  const teamSetup = testSetup({ overrides: { teams: { playerMode: "teams" } } });

  it("joining with a new teamId creates the team; a second member shares it", () => {
    const game = run(teamSetup, [
      { type: "player-join", at: 1, playerId: "a1", name: "Ada", teamId: "tA", teamName: "Alpha" },
      { type: "player-join", at: 2, playerId: "a2", name: "Al", teamId: "tA" },
      { type: "player-join", at: 3, playerId: "b1", name: "Bea", teamId: "tB", teamName: "Beta" },
    ]);
    expect(game.state.entityOrder).toEqual(["tA", "tB"]);
    expect(game.state.teams.tA?.memberIds).toEqual(["a1", "a2"]);
    expect(game.state.scores).toEqual({ tA: 0, tB: 0 });
  });

  it("teams mode requires a teamId; individuals mode refuses one", () => {
    const noTeam = { state: createInitialState(teamSetup), events: [], setup: teamSetup };
    expect(
      applyExpectingRejection(noTeam, { type: "player-join", at: 1, playerId: "x", name: "X" }),
    ).toBe("teams-mode-needs-team");

    const soloSetup = testSetup();
    const solo = { state: createInitialState(soloSetup), events: [], setup: soloSetup };
    expect(
      applyExpectingRejection(solo, {
        type: "player-join",
        at: 1,
        playerId: "x",
        name: "X",
        teamId: "tA",
      }),
    ).toBe("team-join-in-individuals-mode");
  });

  it("late-joining an EXISTING team never re-scores the team", () => {
    const setup = testSetup({
      overrides: { teams: { playerMode: "teams" }, join: { lateJoinScore: "match-lowest" } },
    });
    let game = run(setup, [
      { type: "player-join", at: 1, playerId: "a1", name: "Ada", teamId: "tA", teamName: "Alpha" },
      { type: "player-join", at: 2, playerId: "b1", name: "Bea", teamId: "tB", teamName: "Beta" },
      { type: "start-game", at: 10 },
      { type: "score-adjust", at: 20, entityId: "tA", delta: 800 },
      { type: "player-join", at: 30, playerId: "a2", name: "Al", teamId: "tA" },
    ]);
    expect(game.state.scores.tA).toBe(800);
    // A brand-new late team DOES get the policy score.
    game = runOn(game, [
      { type: "player-join", at: 40, playerId: "c1", name: "Cy", teamId: "tC", teamName: "Gamma" },
    ]);
    expect(game.state.scores.tC).toBe(0); // lowest of {800, 0}
  });
});

describe("transition totality", () => {
  it("rejection returns the same state object (reference equality)", () => {
    const setup = testSetup();
    const game = startedGame(setup);
    const result = transition(game.state, { type: "judge", at: 9000, verdict: "correct" }, setup);
    expect(result.state).toBe(game.state);
    expect(result.events[0]?.type).toBe("action-rejected");
  });

  it("rejected actions are not logged", () => {
    const setup = testSetup();
    const game = startedGame(setup);
    const logLength = game.state.actionLog.length;
    const result = transition(game.state, { type: "proceed", at: 9000 }, setup);
    expect(result.state.actionLog).toHaveLength(logLength);
  });
});
