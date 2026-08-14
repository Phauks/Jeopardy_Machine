// The M3 heart: a complete game - lobby, every cell incl. an authored wager cell, the final
// round, game-over standings - played through the DO by bot players speaking the real
// protocol while a scripted host drives selection/arming/judging. Every action crosses the
// wire, is stamped with server arrival time, and feeds @jeopardy/engine's transition.
//
// The whole file is one sequential host script: every await inside the loop IS the test
// (select, watch, judge, in order), so the parallelize-your-awaits lint rule is off here.
/* oxlint-disable no-await-in-loop */
import { describe, expect, it } from "vitest";
import { connectBot, connectHost, initializeRoom, instantBot, uniqueCode } from "./helpers.ts";
import type { CreateRoomRequest } from "@jeopardy/protocol/room/create";

const wagerAndFinalGame: CreateRoomRequest["game"] = {
  kind: "compact",
  rounds: [
    {
      columns: 3,
      rows: 3,
      // Manual placement: exactly one wager cell, authored at category 0 row 0, so the
      // script knows precisely which selection triggers the wager path.
      wagerPlacement: "manual",
      authoredWagers: [[0, 0]],
    },
  ],
  preset: "casual-party",
  overrides: {},
  hasFinalClue: true,
};

describe("full game through the room", () => {
  it("plays lobby -> 9 cells (1 wager) -> final -> game-over with bot players", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, wagerAndFinalGame, "full-game-seed");
    const host = await connectHost(code, hostToken);

    // Three deterministic bots with staggered latencies: Alpha always arrives first, so
    // every plain clue resolves identically on every run.
    const alpha = await connectBot(code, instantBot("Alpha", 0));
    const beta = await connectBot(code, instantBot("Beta", 30));
    const gamma = await connectBot(code, instantBot("Gamma", 60));
    await host.waitFor("roster", (message) => message.roster.players.length === 3);

    host.sendAction({ type: "start-game" });
    const started = await host.takeEvent("game-started");
    expect(started.entityCount).toBe(3);
    await host.takeEvent("round-started");

    // Play all nine cells. Cell (0,0) is the wager cell: its selector auto-commits (bot
    // behavior) and answers alone - no arming, no buzz race.
    let buzzWonSeen = 0;
    const nextBuzzWon = async (): Promise<void> => {
      const deadline = Date.now() + 5000;
      while (host.messagesOf("buzz-won").length <= buzzWonSeen) {
        if (Date.now() > deadline) throw new Error("timed out waiting for buzz-won");
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      buzzWonSeen += 1;
    };
    for (let category = 0; category < 3; category += 1) {
      for (let row = 0; row < 3; row += 1) {
        host.sendAction({ type: "select-cell", category, row });
        const selected = await host.takeEvent("cell-selected");
        expect(selected).toMatchObject({ category, row });
        if (category === 0 && row === 0) {
          await host.takeEvent("wager-cell-hit");
          const committed = await host.takeEvent("wager-committed");
          expect(committed.forced).toBe(false);
          await host.takeEvent("clue-presented");
          host.sendAction({ type: "judge", verdict: "correct" });
        } else {
          await host.takeEvent("clue-presented");
          host.sendAction({ type: "arm-buzzers" });
          await nextBuzzWon();
          host.sendAction({ type: "judge", verdict: "correct" });
        }
        await host.takeEvent("clue-finished");
        // Human-ish pacing: a real room never plays a clue in 30ms, and without this the
        // BOTS trip the per-connection message-rate cap (which is a correct refusal, just
        // not the scenario under test).
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 130));
      }
    }

    // Board exhausted -> round break -> the final: bots wager and answer on their own,
    // the host reveals and judges each entry in the engine's drama order.
    await host.takeEvent("round-ended");
    const roundBreak = await host.takeEvent("round-break");
    expect(roundBreak.nextStage).toBe("final");
    host.sendAction({ type: "proceed" });

    // Final eligibility (#29) excludes zero scores: Alpha swept the buzz races and the
    // wager-cell selector banked its wager, so eligibility follows the engine, not the
    // roster count.
    const wagersOpen = await host.takeEvent("final-wagers-open");
    expect(wagersOpen.ranges.length).toBeGreaterThanOrEqual(1);
    await host.takeEvent("final-writing-open");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      [alpha, beta, gamma].flatMap((bot) =>
        bot.received.filter((message) => message.type === "error"),
      ),
    ).toEqual([]);
    const revealStart = await host.takeEvent("final-reveal-started");
    const revealOrder = [...revealStart.individualOrder];
    expect(revealOrder.length + revealStart.batched.length).toBe(wagersOpen.ranges.length);
    for (const entityId of [
      ...revealStart.batched.map((entry) => entry.entityId),
      ...revealOrder,
    ]) {
      host.sendAction({ type: "judge-entity", entityId, verdict: "correct" });
      await host.takeEvent("final-judged");
    }

    const gameOver = await host.takeEvent("game-over");
    expect(gameOver.standings.length).toBe(3);
    expect(gameOver.winners.length).toBeGreaterThanOrEqual(1);

    // Exactly one room-level buzz-won per arming (8 armed clues; the wager cell never
    // arms) - the only-winner-heard audio contract, observed on the wire.
    expect(host.messagesOf("buzz-won").length).toBe(8);

    // Alpha (latency 0) won every race; correct answers kept control with its entity, and
    // its score reflects 8 clue wins plus its own wager-cell result.
    const finalSnapshot = await (async () => {
      host.send({ type: "sync" });
      return host.waitFor("snapshot", (message) => message.phase === "ended");
    })();
    expect(finalSnapshot.phase).toBe("ended");
    const standingsWinner = gameOver.standings[0];
    expect(standingsWinner?.entityId).toBe(alpha.entityId);
  }, 30_000);
});
