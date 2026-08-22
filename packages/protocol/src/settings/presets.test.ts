import { describe, expect, it } from "vitest";
import { defaultSettings } from "./derive.ts";
import { resolvePreset, settingsPresets } from "./presets.ts";
import { describeSettingsRegistry } from "./describe.ts";

describe("settings presets", () => {
  it("casual-party is the empty diff: the registry defaults are the party baseline", () => {
    expect(settingsPresets["casual-party"]).toEqual({});
    expect(resolvePreset("casual-party")).toEqual(defaultSettings());
  });

  it("tv flips exactly the competitive rows and nothing else", () => {
    const tv = resolvePreset("tv");
    expect(tv.scoring.questionFormatRequired).toBe("strict-later-rounds");
    expect(tv.end.tieForFirst).toBe("sudden-death");
    expect(tv.end.allNonPositiveFinish).toBe("no-winner");
    // Everything outside the diff matches the defaults.
    const defaults = defaultSettings();
    expect(tv.structure).toEqual(defaults.structure);
    expect(tv.buzzing).toEqual(defaults.buzzing);
    expect(tv.wagers).toEqual(defaults.wagers);
  });

  it("per-game overrides layer on top of the preset", () => {
    const resolved = resolvePreset("tv", { end: { tieForFirst: "shared-placement" } });
    expect(resolved.end.tieForFirst).toBe("shared-placement");
    expect(resolved.end.allNonPositiveFinish).toBe("no-winner"); // preset survives elsewhere
  });
});

describe("describeSettingsRegistry", () => {
  const groups = describeSettingsRegistry();

  it("is JSON-safe and complete: every setting appears with schema, default, label", () => {
    const roundTripped = JSON.parse(JSON.stringify(groups));
    expect(roundTripped).toEqual(groups);
    const total = groups.reduce((count, group) => count + group.settings.length, 0);
    expect(total).toBeGreaterThanOrEqual(53);
    for (const group of groups) {
      for (const setting of group.settings) {
        expect(setting.schema["default"]).toEqual(setting.defaultValue);
        expect(setting.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("exposes renderable constraints: enums list options, integers carry bounds", () => {
    const flat = groups.flatMap((group) => group.settings);
    const armMode = flat.find((setting) => setting.key === "armMode");
    expect(armMode?.schema["enum"]).toEqual(["manual", "auto-after-tts", "auto-after-delay"]);
    // A plain int carries its bounds at the top level...
    const autoArm = flat.find((setting) => setting.key === "autoArmDelayMs");
    expect(autoArm?.schema["minimum"]).toBe(500);
    expect(autoArm?.schema["maximum"]).toBe(30_000);
  });

  // The two "off is null" durations, and the shape a UI has to read to render them. Their
  // bounds sit under `anyOf` rather than at the top level, which is what a nullable integer
  // serializes to - a customizer that reached for `schema.minimum` on one of these would find
  // undefined and draw an unbounded slider.
  it("keeps the nullable durations' bounds reachable, beside their null branch", () => {
    const flat = groups.flatMap((group) => group.settings);
    for (const key of ["answerWindowMs", "buzzWindowMs"]) {
      const setting = flat.find((entry) => entry.key === key);
      const branches = setting?.schema["anyOf"] as { type?: string; minimum?: number }[];
      expect(
        branches.map((branch) => branch.type),
        key,
      ).toEqual(["integer", "null"]);
      expect(branches[0]?.minimum, key).toBe(3000);
    }
  });
});
