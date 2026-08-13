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
    const answerWindow = flat.find((setting) => setting.key === "answerWindowMs");
    expect(answerWindow?.schema["minimum"]).toBe(3000);
    expect(answerWindow?.schema["maximum"]).toBe(15_000);
  });
});
