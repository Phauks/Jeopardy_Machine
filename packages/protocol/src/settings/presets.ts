// Named rule presets (resolution R2): sparse overrides on the registry defaults - a preset
// stores ONLY what it changes, so exports stay small and the UI can show "changed from TV
// rules" by diffing two sparse objects.
//
// The registry defaults ARE the casual-party baseline (the matrix's Default column is
// deliberately party-leaning: co-champions, highest-wins-anyway - guiding principle 0 says
// TV-fidelity must earn its place). So casual-party is the empty diff, and tv flips exactly
// the rows where the show is stricter than a good party.
import { z } from "zod";
import { resolveSettings, settingsOverridesSchema } from "./derive.ts";
import type { Settings, SettingsOverrides } from "./derive.ts";

export const settingsPresetIdSchema = z.enum(["tv", "casual-party"]);

export type SettingsPresetId = z.infer<typeof settingsPresetIdSchema>;

export const settingsPresets: Readonly<Record<SettingsPresetId, SettingsOverrides>> = {
  "casual-party": {},
  tv: {
    // #19: strict phrasing from round two on; #37/#38: sudden-death ties, no winner when
    // everyone finishes non-positive. Everything else in the Default column already IS the
    // TV rule (docs/research/01-game-anatomy.md, rules matrix).
    scoring: { questionFormatRequired: "strict-later-rounds" },
    end: { tieForFirst: "sudden-death", allNonPositiveFinish: "no-winner" },
  },
};

// Preset base + override layers -> complete Settings. The single resolution path used by the
// rule-set document and by game definitions referencing a preset.
export function resolvePreset(
  preset: SettingsPresetId,
  ...overrides: readonly SettingsOverrides[]
): Settings {
  return resolveSettings(settingsPresets[preset], ...overrides);
}

// Presets are data we ship, so they are validated like data we receive - a typo in a preset
// would otherwise surface as a confusing per-game failure. Cheap enough to run at import.
for (const preset of Object.values(settingsPresets)) settingsOverridesSchema.parse(preset);
