// The game-definition document (proposal section 3 + owner resolutions): mode + board layout
// + how content, rules, and look attach. Filename convention: <name>.game.json.
//
// Attachment semantics (deliberate calls 1/2 + resolution R4):
// - RULES and THEME embed a preset id or a whole document inline - never a library id. A
//   .game.json handed to a stranger must play identically on their machine; ids into MY local
//   library dangle in YOURS. Presets are the only cross-file references allowed because they
//   ship in the app. The library stores rule sets/themes as separate documents - embedding
//   happens at compose/export time.
// - CONTENT may be embedded (export default: self-contained file) or external (the in-app
//   library stores game and pack separately; the repository joins them). Importing an
//   external game without its pack is a hard, friendly error; the optional sha256 of the
//   pack's canonical JSON detects drift.
import { z } from "zod";
import { contentPackSchema } from "../../content/content-pack.ts";
import { documentSchema } from "../../envelope/document.ts";
import { idSchema } from "../../ids.ts";
import { settingsOverridesSchema } from "../../settings/derive.ts";
import { resolvePreset, settingsPresetIdSchema } from "../../settings/presets.ts";
import { resolveRuleSet, ruleSetSchema } from "../../settings/rule-set.ts";
import { themePresetIdSchema, themeSchema } from "../../theme/theme.ts";
import { roundSchema } from "./board.ts";
import { valueSchemeSchema } from "./value-schemes.ts";
import type { Settings } from "../../settings/derive.ts";

export const gameContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("embedded"), pack: contentPackSchema }),
  z.strictObject({
    kind: z.literal("external"),
    packId: idSchema,
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
]);

export const gameRulesSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("preset"),
      preset: settingsPresetIdSchema,
      overrides: settingsOverridesSchema.prefault({}), // per-game tweaks over the preset
    }),
    // A whole rule-set document embedded (its body already layers base + overrides).
    z.strictObject({ kind: z.literal("inline"), ruleSet: ruleSetSchema }),
  ])
  .default({ kind: "preset", preset: "casual-party", overrides: {} });

export const gameThemeSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("preset"), preset: themePresetIdSchema }),
    z.strictObject({ kind: z.literal("inline"), theme: themeSchema }),
  ])
  .default({ kind: "preset", preset: "modern-flat" });

export const gameDefinitionBodySchema = z.strictObject({
  mode: z.literal("jeopardy"), // future modes = new literals = new body schemas under modes/
  rounds: z.array(roundSchema).min(1).max(4),
  final: z
    .strictObject({
      category: z.string().min(1).max(80),
      itemId: idSchema,
    })
    .nullable(), // null = no final authored; the rule set's final.enabled can also skip it
  valueScheme: valueSchemeSchema,
  content: gameContentSchema,
  rules: gameRulesSchema,
  theme: gameThemeSchema,
});

export const gameDefinitionSchema = documentSchema("game-definition", gameDefinitionBodySchema);
export const gameDefinitionSchemaVersion = "1.0.0";

export type GameDefinitionBody = z.infer<typeof gameDefinitionBodySchema>;
export type GameDefinition = z.infer<typeof gameDefinitionSchema>;

// Collapse a game's rules attachment to the complete Settings object the M2 engine consumes.
export function resolveGameRules(rules: GameDefinitionBody["rules"]): Settings {
  return rules.kind === "preset"
    ? resolvePreset(rules.preset, rules.overrides)
    : resolveRuleSet(rules.ruleSet.body);
}
