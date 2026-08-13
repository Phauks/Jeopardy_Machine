// The rule-set document (owner resolution R4): house rules as the fifth portable document,
// shareable and reusable across games exactly like themes. Filename convention:
// <name>.rules.json. The body is a named base preset plus a sparse override diff - NOT a
// fully-materialized settings object - so a shared rule set stays a readable statement of
// intent ("TV rules but no negative scores") and silently inherits future settings' defaults
// (a minor registry addition needs no rule-set migration). Game definitions reference a
// preset or embed a whole rule-set document (modes/jeopardy/game-definition.ts).
import { z } from "zod";
import { documentSchema } from "../envelope/document.ts";
import { settingsOverridesSchema } from "./derive.ts";
import { resolvePreset, settingsPresetIdSchema } from "./presets.ts";
import type { Settings } from "./derive.ts";

export const ruleSetBodySchema = z.strictObject({
  base: settingsPresetIdSchema.default("casual-party"),
  overrides: settingsOverridesSchema.prefault({}),
  description: z.string().max(1000).optional(), // "House rules for the club night" etc.
});

export const ruleSetSchema = documentSchema("rule-set", ruleSetBodySchema);
export const ruleSetSchemaVersion = "1.0.0";

export type RuleSetBody = z.infer<typeof ruleSetBodySchema>;
export type RuleSet = z.infer<typeof ruleSetSchema>;

// A rule-set body plus optional per-game overrides collapses to the complete Settings the
// M2 engine consumes. Layering: registry defaults <- base preset <- rule-set overrides <-
// per-game overrides.
export function resolveRuleSet(
  body: RuleSetBody,
  ...gameOverrides: readonly z.infer<typeof settingsOverridesSchema>[]
): Settings {
  return resolvePreset(body.base, body.overrides, ...gameOverrides);
}
