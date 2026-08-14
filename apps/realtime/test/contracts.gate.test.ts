// Cross-package drift gates. The engine depends on protocol (never the reverse), so the
// protocol restates two engine-adjacent shapes as data; this suite is where the packages
// meet and the restatements are held to the source of truth.
import { describe, expect, it } from "vitest";
import { gameActionSchema, participantIdSchema } from "@jeopardy/engine/actions";
import { scenarioFixtureSchema } from "@jeopardy/engine/fixture";
import { actionAuthority } from "@jeopardy/protocol/room/authority";
import { compactRoundSchema } from "@jeopardy/protocol/room/create";
import { playerIdSchema } from "@jeopardy/protocol/room/identity";
import { timerExpiryAction } from "../src/room/engine-glue.ts";
import type { TimerKind } from "@jeopardy/engine/events";

function engineActionTypes(): string[] {
  return gameActionSchema.options.map((option) => {
    const literal = option.shape.type as { value: string };
    return literal.value;
  });
}

describe("authority matrix vs engine action catalog", () => {
  it("covers every engine action type exactly - no gaps, no ghosts", () => {
    const engine = engineActionTypes().toSorted();
    const matrix = Object.keys(actionAuthority).toSorted();
    expect(matrix).toEqual(engine);
  });

  it("keeps every timer expiry action a real, host-or-server action", () => {
    const engine = new Set(engineActionTypes());
    for (const [kind, actionType] of Object.entries(timerExpiryAction)) {
      expect(engine.has(actionType), `timer ${kind} maps to unknown action`).toBe(true);
      const authority = actionAuthority[actionType];
      expect(
        authority === "host" || authority === "server-only",
        `timer ${kind} expiry must never be a plain player action`,
      ).toBe(true);
    }
  });

  it("names an expiry action for every engine TimerKind", () => {
    // Compile-time completeness (Record<TimerKind, ...>) plus a runtime sample so a
    // future TimerKind addition fails loudly here, not silently at 11pm on game night.
    const kinds: TimerKind[] = [
      "auto-arm",
      "selection-shot-clock",
      "buzz-window",
      "answer-window",
      "everyone-answers-window",
      "wager-entry",
      "final-wager",
      "final-writing",
      "round-time-limit",
    ];
    for (const kind of kinds) expect(timerExpiryAction[kind]).toBeDefined();
  });
});

describe("restated shapes track their sources", () => {
  it("accepts the same ids as the engine's participantIdSchema", () => {
    for (const candidate of ["p-1", "t-12", "a".repeat(64)]) {
      expect(playerIdSchema.safeParse(candidate).success).toBe(true);
      expect(participantIdSchema.safeParse(candidate).success).toBe(true);
    }
    for (const candidate of ["", "a".repeat(65)]) {
      expect(playerIdSchema.safeParse(candidate).success).toBe(false);
      expect(participantIdSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("keeps compact rounds interchangeable with engine fixture boards", () => {
    const samples = [
      { columns: 3, rows: 3 },
      { columns: 6, rows: 5, rowValues: [100, 200, 300, 400, 500], valueMultiplier: 2 },
      {
        columns: 4,
        rows: 4,
        wagerPlacement: "manual",
        authoredWagers: [
          [0, 0],
          [3, 3],
        ],
      },
      { columns: 7, rows: 3 }, // out of range both places
      { columns: 3, rows: 3, wagerPlacement: "sideways" }, // bad enum both places
    ];
    const fixtureBoard = scenarioFixtureSchema.shape.rounds.element;
    for (const sample of samples) {
      expect(compactRoundSchema.safeParse(sample).success).toBe(
        fixtureBoard.safeParse(sample).success,
      );
    }
  });
});
