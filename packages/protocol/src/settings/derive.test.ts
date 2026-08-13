import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  resolveSettings,
  settingsOverridesSchema,
  settingsSchema,
} from "./derive.ts";

describe("settingsSchema", () => {
  it("parse({}) yields the complete default game - every group, every field", () => {
    const settings = settingsSchema.parse({});
    expect(settings.structure.boardColumns).toBe(6);
    expect(settings.structure.valueScheme).toEqual({ kind: "preset", preset: "tv" });
    expect(settings.buzzing.earlyBuzzLockoutMs).toBe(250);
    expect(settings.wagers.label).toBe("Double Down");
    expect(settings.end.tieForFirst).toBe("co-champions");
    expect(settings.join.lateJoinScore).toBe("zero");
    // No group may come back undefined: the engine never sees an absent field.
    for (const group of Object.values(settings)) expect(group).toBeTypeOf("object");
  });

  it("round-trips: parse -> serialize -> parse is identical", () => {
    const first = defaultSettings();
    const second = settingsSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it("rejects unknown groups and unknown fields inside a group", () => {
    expect(settingsSchema.safeParse({ streaks: {} }).success).toBe(false);
    expect(settingsSchema.safeParse({ buzzing: { armMode: "manual", turbo: true } }).success).toBe(
      false,
    );
  });

  it("enforces numeric bounds from the registry", () => {
    expect(settingsSchema.safeParse({ buzzing: { earlyBuzzLockoutMs: 1001 } }).success).toBe(false);
    expect(settingsSchema.safeParse({ structure: { boardColumns: 7 } }).success).toBe(false);
    expect(settingsSchema.safeParse({ buzzing: { buzzWindowMs: null } }).success).toBe(true);
  });

  it("runs group refinements: custom value scheme must match the row count", () => {
    const mismatched = {
      structure: { boardRows: 5, valueScheme: { kind: "custom", rowValues: [100, 200, 300] } },
    };
    const result = settingsSchema.safeParse(mismatched);
    expect(result.success).toBe(false);
    const matched = {
      structure: { boardRows: 3, valueScheme: { kind: "custom", rowValues: [100, 200, 300] } },
    };
    expect(settingsSchema.safeParse(matched).success).toBe(true);
  });

  it("runs group refinements: everyone-answers requires typed capture", () => {
    expect(settingsSchema.safeParse({ answerMode: { everyoneAnswers: "on" } }).success).toBe(false);
    expect(
      settingsSchema.safeParse({ answerMode: { answerCapture: "typed", everyoneAnswers: "on" } })
        .success,
    ).toBe(true);
  });
});

describe("settingsOverridesSchema", () => {
  it("accepts the empty diff and truly sparse fragments", () => {
    expect(settingsOverridesSchema.parse({})).toEqual({});
    const sparse = settingsOverridesSchema.parse({ buzzing: { rebound: false } });
    expect(sparse).toEqual({ buzzing: { rebound: false } });
    // Absent fields stay absent - an override never re-materializes defaults.
    expect(sparse.structure).toBeUndefined();
  });

  it("still enforces field constraints inside a fragment", () => {
    expect(settingsOverridesSchema.safeParse({ buzzing: { answerWindowMs: 1 } }).success).toBe(
      false,
    );
    expect(settingsOverridesSchema.safeParse({ buzzing: { armMode: "psychic" } }).success).toBe(
      false,
    );
  });
});

describe("resolveSettings", () => {
  it("layers override fragments over defaults, later layers winning", () => {
    const resolved = resolveSettings(
      { buzzing: { rebound: false, answerWindowMs: 8000 } },
      { buzzing: { rebound: true } },
    );
    expect(resolved.buzzing.rebound).toBe(true); // later layer
    expect(resolved.buzzing.answerWindowMs).toBe(8000); // earlier layer survives
    expect(resolved.buzzing.armMode).toBe("manual"); // untouched default
  });

  it("replaces object-valued fields wholesale, never splicing unions", () => {
    const resolved = resolveSettings({
      structure: { boardRows: 4, valueScheme: { kind: "custom", rowValues: [1, 2, 3, 4] } },
    });
    expect(resolved.structure.valueScheme).toEqual({ kind: "custom", rowValues: [1, 2, 3, 4] });
  });

  it("judges refinements on the MERGED result, so cross-layer combinations are caught", () => {
    // Each layer is individually harmless; together they violate everyone-answers-needs-typed.
    expect(() =>
      resolveSettings(
        { answerMode: { answerCapture: "typed", everyoneAnswers: "on" } },
        { answerMode: { answerCapture: "verbal" } },
      ),
    ).toThrow();
  });
});
