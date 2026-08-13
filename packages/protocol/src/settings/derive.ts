// Derivation (a) and (b) of resolution R2: the composed zod settings schema and its TS types,
// built from the registry so a setting exists in exactly one place. Two schemas come out:
//
//   settingsSchema           - the complete, fully-defaulted rules object. parse({}) yields
//                              the entire default game; the M2 engine consumes z.infer of
//                              this and never sees an absent field.
//   settingsOverridesSchema  - the sparse form: every group and field optional, defaults
//                              stripped, so presets and per-game overrides serialize as
//                              exactly the fields someone changed (R2: presets are sparse
//                              overrides on a named base) and absent NEVER means "default
//                              again" at merge time - it means "inherit".
//
// Group-level refinements run on settingsSchema only: overrides are fragments, and a
// fragment cannot be judged until it is merged onto a base (resolveSettings).
import { z } from "zod";
import { answerModeGroup } from "./groups/answer-mode.ts";
import { boardControlGroup } from "./groups/board-control.ts";
import { buzzingGroup } from "./groups/buzzing.ts";
import { endGroup } from "./groups/end.ts";
import { finalGroup } from "./groups/final.ts";
import { joinGroup } from "./groups/join.ts";
import { presentationGroup } from "./groups/presentation.ts";
import { scoringGroup } from "./groups/scoring.ts";
import { structureGroup } from "./groups/structure.ts";
import { teamsGroup } from "./groups/teams.ts";
import { wagersGroup } from "./groups/wagers.ts";
import type { SettingsGroup, SettingsMap } from "./definition.ts";

type GroupShape<Map extends SettingsMap> = { [Key in keyof Map]: Map[Key]["schema"] };

function groupShape<Map extends SettingsMap>(settings: Map): GroupShape<Map> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, definition] of Object.entries(settings)) shape[key] = definition.schema;
  return shape as GroupShape<Map>;
}

// Full group schema: strict object of the settings' own schemas, cross-field refinements
// attached, prefaulted so an absent group parses to its complete defaults.
function deriveGroupSchema<Id extends string, Map extends SettingsMap>(
  group: SettingsGroup<Id, Map>,
) {
  return (
    z
      .strictObject(groupShape(group.settings))
      .check((context) => {
        for (const refinement of group.refinements) {
          if (!refinement.valid(context.value as never)) {
            context.issues.push({
              code: "custom",
              message: refinement.description,
              path: [refinement.path],
              input: context.value,
            });
          }
        }
      })
      // Cast: {} genuinely satisfies the input type because every field has a default, but a
      // generic Map keeps TS from proving it - the registry gate test proves it at runtime.
      .prefault({} as never)
  );
}

// Sparse group schema: each field's default stripped (a ZodDefault under .optional() would
// still inject the default on absent keys - verified against zod 4.4) and made optional.
function deriveGroupOverridesSchema<Id extends string, Map extends SettingsMap>(
  group: SettingsGroup<Id, Map>,
) {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, definition] of Object.entries(group.settings)) {
    const schema = definition.schema;
    shape[key] = (
      schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodType) : schema
    ).optional();
  }
  return z.strictObject(shape).optional();
}

export const settingsSchema = z.strictObject({
  structure: deriveGroupSchema(structureGroup),
  boardControl: deriveGroupSchema(boardControlGroup),
  buzzing: deriveGroupSchema(buzzingGroup),
  scoring: deriveGroupSchema(scoringGroup),
  answerMode: deriveGroupSchema(answerModeGroup),
  wagers: deriveGroupSchema(wagersGroup),
  final: deriveGroupSchema(finalGroup),
  teams: deriveGroupSchema(teamsGroup),
  end: deriveGroupSchema(endGroup),
  presentation: deriveGroupSchema(presentationGroup),
  join: deriveGroupSchema(joinGroup),
});

export type Settings = z.infer<typeof settingsSchema>;

export const settingsOverridesSchema = z.strictObject({
  structure: deriveGroupOverridesSchema(structureGroup),
  boardControl: deriveGroupOverridesSchema(boardControlGroup),
  buzzing: deriveGroupOverridesSchema(buzzingGroup),
  scoring: deriveGroupOverridesSchema(scoringGroup),
  answerMode: deriveGroupOverridesSchema(answerModeGroup),
  wagers: deriveGroupOverridesSchema(wagersGroup),
  final: deriveGroupOverridesSchema(finalGroup),
  teams: deriveGroupOverridesSchema(teamsGroup),
  end: deriveGroupOverridesSchema(endGroup),
  presentation: deriveGroupOverridesSchema(presentationGroup),
  join: deriveGroupOverridesSchema(joinGroup),
});

export type SettingsOverrides = z.infer<typeof settingsOverridesSchema>;

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

// Layered merge: defaults <- each override layer in order. Two levels deep on purpose -
// groups merge per field, field VALUES replace wholesale (a custom valueScheme object is
// swapped, never spliced). The merged result re-parses through settingsSchema, so group
// refinements judge the final combination, not any single layer.
export function resolveSettings(...layers: readonly SettingsOverrides[]): Settings {
  const merged: Record<string, Record<string, unknown>> = JSON.parse(
    JSON.stringify(defaultSettings()),
  );
  for (const layer of layers) {
    for (const [groupId, fields] of Object.entries(layer)) {
      if (fields === undefined) continue;
      const target = merged[groupId] ?? {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) target[key] = value;
      }
      merged[groupId] = target;
    }
  }
  return settingsSchema.parse(merged);
}
