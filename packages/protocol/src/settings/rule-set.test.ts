import { describe, expect, it } from "vitest";
import { defaultSettings } from "./derive.ts";
import { resolveRuleSet, ruleSetSchema, ruleSetSchemaVersion } from "./rule-set.ts";

const meta = {
  title: "Club night house rules",
  author: "Board Game Club",
  created: "2026-08-13T12:00:00.000Z",
  modified: "2026-08-13T12:00:00.000Z",
};

const validRuleSet = {
  format: "rule-set",
  schemaVersion: ruleSetSchemaVersion,
  meta,
  body: {
    base: "tv",
    overrides: { scoring: { wrongAnswerPenalty: "floor-at-zero" } },
    description: "TV rules but nobody goes negative",
  },
};

describe("ruleSetSchema", () => {
  it("accepts a sparse rule set and resolves it over its base preset", () => {
    const parsed = ruleSetSchema.parse(validRuleSet);
    const settings = resolveRuleSet(parsed.body);
    expect(settings.scoring.wrongAnswerPenalty).toBe("floor-at-zero"); // the override
    expect(settings.end.tieForFirst).toBe("sudden-death"); // from the tv base
    expect(settings.buzzing.armMode).toBe("manual"); // untouched default
  });

  it("defaults to casual-party base with an empty diff - a minimal rule set is the default game", () => {
    const parsed = ruleSetSchema.parse({ ...validRuleSet, body: {} });
    expect(parsed.body).toEqual({ base: "casual-party", overrides: {} });
    expect(resolveRuleSet(parsed.body)).toEqual(defaultSettings());
  });

  it("layers per-game overrides after the rule set's own", () => {
    const parsed = ruleSetSchema.parse(validRuleSet);
    const settings = resolveRuleSet(parsed.body, { scoring: { wrongAnswerPenalty: "none" } });
    expect(settings.scoring.wrongAnswerPenalty).toBe("none");
  });

  it("round-trips parse -> serialize -> parse identically, ext included", () => {
    const withExt = { ...validRuleSet, ext: { "org.club.approved-by": "committee" } };
    const first = ruleSetSchema.parse(withExt);
    const second = ruleSetSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it("rejects unknown bases, invalid override fragments, and stray keys", () => {
    expect(ruleSetSchema.safeParse({ ...validRuleSet, body: { base: "tournament" } }).success).toBe(
      false,
    );
    expect(
      ruleSetSchema.safeParse({
        ...validRuleSet,
        body: { overrides: { scoring: { wrongAnswerPenalty: "double" } } },
      }).success,
    ).toBe(false);
    expect(
      ruleSetSchema.safeParse({ ...validRuleSet, body: { ...validRuleSet.body, name: "x" } })
        .success,
    ).toBe(false);
  });
});
