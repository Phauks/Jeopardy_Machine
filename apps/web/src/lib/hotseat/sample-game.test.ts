// The hotseat page's game material must be a REAL document: parsed through the protocol
// schema at module load and collapsed via the production setupFromGameDefinition path. These
// tests pin that pipe plus a whole engine game driven through it - the M2 exit criteria
// ("a full game can be played with no server") exercised headlessly.
import { describe, expect, it } from "vitest";
import { createInitialState } from "@jeopardy/engine/state";
import { transition } from "@jeopardy/engine/transition";
import { clueTextAt, sampleGameDefinition, sampleGameSetup } from "#lib/hotseat/sample-game.ts";
import { sampleBoard } from "#lib/board/sample-board.ts";
import type { GameAction } from "@jeopardy/engine/actions";

describe("sample game definition", () => {
  it("is a valid game-definition document with two rounds and a final", () => {
    expect(sampleGameDefinition.format).toBe("game-definition");
    expect(sampleGameDefinition.body.rounds).toHaveLength(2);
    expect(sampleGameDefinition.body.final).not.toBeNull();
  });

  it("collapses to an engine setup with tv values and a doubled second round", () => {
    const setup = sampleGameSetup("test-seed");
    expect(setup.rounds[0]?.cells[0]?.map((cell) => cell.value)).toEqual([
      200, 400, 600, 800, 1000,
    ]);
    expect(setup.rounds[1]?.cells[0]?.map((cell) => cell.value)).toEqual([
      400, 800, 1200, 1600, 2000,
    ]);
    expect(setup.hasFinalClue).toBe(true);
  });

  it("clue lookup mirrors the sample board", () => {
    expect(clueTextAt(0, 0).clue).toBe(sampleBoard.categories[0]?.clues[0]?.clue);
    expect(clueTextAt(5, 4).response).toBe(sampleBoard.categories[5]?.clues[4]?.response);
  });

  it("plays a full headless game to game-over through the engine on this setup", () => {
    const setup = sampleGameSetup("headless-proof");
    let state = createInitialState(setup);
    let at = 0;
    const step = (action: GameAction): void => {
      const result = transition(state, action, setup);
      const rejected = result.events.find((event) => event.type === "action-rejected");
      if (rejected !== undefined && rejected.type === "action-rejected") {
        throw new Error(`rejected ${action.type} in ${state.phase}: ${rejected.reason}`);
      }
      state = result.state;
    };
    step({ type: "player-join", at: (at += 10), playerId: "p1", name: "Ada" });
    step({ type: "player-join", at: (at += 10), playerId: "p2", name: "Ben" });
    step({ type: "start-game", at: (at += 10) });

    let winnerToggle = false;
    for (let guard = 0; state.phase !== "game-over" && guard < 500; guard += 1) {
      if (state.phase === "awaiting-selection") {
        const board = state.boards[state.roundIndex];
        let picked = false;
        board?.status.forEach((column, category) => {
          column.forEach((status, row) => {
            if (!picked && status === "hidden") {
              step({ type: "select-cell", at: (at += 10), category, row });
              picked = true;
            }
          });
        });
        if (!picked) step({ type: "end-round", at: (at += 10) });
      } else if (state.phase === "reading") {
        winnerToggle = !winnerToggle;
        step({
          type: "host-award",
          at: (at += 10),
          entityId: winnerToggle ? "p1" : "p2",
          verdict: "correct",
        });
      } else if (state.phase === "wagering") {
        step({ type: "commit-wager", at: (at += 10), amount: setup.settings.wagers.minimumWager });
      } else if (state.phase === "wager-answering") {
        step({ type: "judge", at: (at += 10), verdict: "correct" });
      } else if (state.phase === "round-break") {
        step({ type: "proceed", at: (at += 10) });
      } else if (state.phase === "final-wagers") {
        step({ type: "final-wager-timeout", at: (at += 10) });
      } else if (state.phase === "final-writing") {
        step({ type: "final-writing-timeout", at: (at += 10) });
      } else if (state.phase === "final-reveal") {
        const next =
          state.final?.batchedEntities.find(
            (entityId) => state.final?.judged[entityId] === undefined,
          ) ?? state.final?.individualOrder[state.final.revealIndex];
        if (next === undefined) throw new Error("reveal stalled");
        step({ type: "judge-entity", at: (at += 10), entityId: next, verdict: "wrong" });
      } else if (state.phase === "tiebreaker-reading") {
        step({ type: "arm-buzzers", at: (at += 10) });
      } else if (state.phase === "tiebreaker-armed") {
        step({ type: "buzz", at: (at += 10), playerId: "p1" });
      } else if (state.phase === "tiebreaker-answering") {
        step({ type: "judge", at: (at += 10), verdict: "correct" });
      } else {
        throw new Error(`headless driver has no move for phase ${state.phase}`);
      }
    }
    expect(state.phase).toBe("game-over");
    // Both boards fully played: 60 cells across the two rounds.
    const playedCells = state.boards
      .flatMap((board) => board.status.flat())
      .filter((status) => status === "played").length;
    expect(playedCells).toBe(60);
  });
});
