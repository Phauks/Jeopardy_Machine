// The rules a host may move mid-room, and - the part that matters - the ones they may not.
//
// Owner, 2026-08-20: the answer timer "should be settable by the host", and losing points for
// a wrong answer should be a setting a host can reach. Both were rules-matrix rows already;
// both were frozen at room creation because rules ride in the game definition.
//
// The subset is the safety argument (live-rules.ts states it in full): a rule the engine reads
// FRESH each time may move, and a rule the running STATE was built from may not - not because
// it is more important, but because the state has already acted on it and thirty phones are
// holding the proof.
import { describe, expect, it } from "vitest";
import {
  answerWindowSecondBounds,
  liveRuleKeys,
  liveRulesPatchSchema,
  liveRulesSchema,
} from "./live-rules.ts";
import { settingsSchema } from "../settings/derive.ts";

describe("what a host may retune while people are playing", () => {
  it("takes the two the owner asked for", () => {
    expect(liveRulesPatchSchema.safeParse({ buzzing: { answerWindowMs: 12_000 } }).success).toBe(
      true,
    );
    expect(
      liveRulesPatchSchema.safeParse({ scoring: { wrongAnswerPenalty: "none" } }).success,
    ).toBe(true);
  });

  it("takes the rest of the answering loop: rebound, lockout, the timeout rule", () => {
    expect(
      liveRulesPatchSchema.safeParse({
        buzzing: { rebound: true, wrongAnswererLockedOut: false },
        scoring: { answerTimeoutOutcome: "host-decides" },
      }).success,
    ).toBe(true);
  });

  // The refusals are the point of a strict schema. Each of these is a rule the RUNNING STATE
  // was built from, so changing it mid-game would not retune the game - it would make the
  // state a description of a game that never happened.
  it("REFUSES the rules the running state was built from", () => {
    const frozen = [
      // The board on thirty phones is the proof these already happened.
      { structure: { roundCount: 3 } },
      { wagers: { countRoundOne: 2 } },
      // Seating decided who the scoring entities ARE (engine: teamId ?? playerId).
      { teams: { playerMode: "teams" } },
      // The final is planned at the round break before it.
      { final: { enabled: false } },
      // Not a rule at all - a room control, and it has its own message.
      { listing: "public" },
    ];
    for (const patch of frozen) {
      expect(liveRulesPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("refuses an unknown field rather than humouring it", () => {
    expect(liveRulesPatchSchema.safeParse({ buzzing: { armMode: "manual" } }).success).toBe(false);
    expect(liveRulesPatchSchema.safeParse({ scoring: { nonsense: 1 } }).success).toBe(false);
  });

  it("refuses an empty patch - that is a client bug, not thirty phones' worth of broadcast", () => {
    expect(liveRulesPatchSchema.safeParse({}).success).toBe(false);
  });

  it("still holds each value to the SAME bounds the rules matrix does", () => {
    // A host tuning live cannot escape a bound an authored rule set is held to - the settings
    // registry is the one definition of what a legal answer window is.
    expect(liveRulesPatchSchema.safeParse({ buzzing: { answerWindowMs: 2 } }).success).toBe(false);
    expect(liveRulesPatchSchema.safeParse({ buzzing: { answerWindowMs: 999_999 } }).success).toBe(
      false,
    );
    expect(
      liveRulesPatchSchema.safeParse({ scoring: { wrongAnswerPenalty: "refund" } }).success,
    ).toBe(false);
  });
});

/** Would the schema take an answer window of this many seconds? */
function ok(seconds: number): boolean {
  return liveRulesPatchSchema.safeParse({ buzzing: { answerWindowMs: seconds * 1000 } }).success;
}

describe("the answer clock's bounds, as a host operates them", () => {
  // The console's slider is in seconds because that is how a host thinks about it; the wire
  // and the engine are in milliseconds. These assertions are what stop the two from drifting:
  // widen the rule and this test fails until the slider follows.
  it("matches the schema exactly at both ends", () => {
    expect(ok(answerWindowSecondBounds.min)).toBe(true);
    expect(ok(answerWindowSecondBounds.max)).toBe(true);
    // ...and one step outside each end is refused, which is what makes them THE bounds rather
    // than two legal values that happen to be near them.
    expect(ok(answerWindowSecondBounds.min - 1)).toBe(false);
    expect(ok(answerWindowSecondBounds.max + 1)).toBe(false);
  });

  it("is a range a person would actually sit through", () => {
    expect(answerWindowSecondBounds.min).toBeGreaterThan(0);
    expect(answerWindowSecondBounds.max).toBeGreaterThan(answerWindowSecondBounds.min);
  });
});

describe("the live rules a surface is told", () => {
  it("is COMPLETE, so nothing has to merge a patch onto a document it does not hold", () => {
    const settings = settingsSchema.parse({});
    const live = {
      answerWindowMs: settings.buzzing.answerWindowMs,
      buzzWindowMs: settings.buzzing.buzzWindowMs,
      rebound: settings.buzzing.rebound,
      wrongAnswererLockedOut: settings.buzzing.wrongAnswererLockedOut,
      wrongAnswerPenalty: settings.scoring.wrongAnswerPenalty,
      answerTimeoutOutcome: settings.scoring.answerTimeoutOutcome,
      deductOnAnswerTimeout: settings.scoring.deductOnAnswerTimeout,
    };
    expect(liveRulesSchema.parse(live)).toEqual(live);
  });

  it("names exactly the paths the patch can reach - one list, not three copies", () => {
    const fromPatch = new Set(liveRuleKeys);
    expect(fromPatch.size).toBe(liveRuleKeys.length);
    // Every key is a real path into the settings object, so a typo here is a failing test
    // rather than a control that silently does nothing.
    const settings = settingsSchema.parse({}) as unknown as Record<string, Record<string, unknown>>;
    for (const key of liveRuleKeys) {
      const [group, field] = key.split(".");
      expect(settings[group ?? ""], key).toBeDefined();
      expect(settings[group ?? ""]?.[field ?? ""], key).toBeDefined();
    }
    // ...and the shape the surfaces read carries one entry per tunable path, no more.
    expect(Object.keys(liveRulesSchema.shape).length).toBe(liveRuleKeys.length);
  });
});
