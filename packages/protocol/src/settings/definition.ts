// The settings-registry building blocks (owner resolution R2 in docs/proposals/m1-protocol.md):
// every game setting is defined exactly ONCE as a registry entry - key, group, zod schema
// (which carries the default and numeric/enum constraints), label, description, prose
// constraints - and everything else is DERIVED from the registry: the composed zod schema and
// TS types (derive.ts), the machine-readable structure a settings UI renders from
// (describe.ts), and the generated docs table (docs-table.ts, checked in at
// docs/reference/settings.md with a regenerate-and-diff gate). The 43-row rules matrix in
// docs/research/01-game-anatomy.md is the INVENTORY this registry implements; matrixRow ties
// each entry back to it (null = a named addition from docs/design/user-flows.md).
import type { z } from "zod";

export type SettingDefinition<Schema extends z.ZodType = z.ZodType> = {
  matrixRow: number | null;
  label: string;
  description: string;
  // Prose constraints the schema cannot express ("only read when armMode is auto-after-delay").
  constraints?: string;
  schema: Schema; // MUST carry a default: settingsSchema.parse({}) yields the complete game
};

// Identity helper: exists so group files read declaratively and the schema's literal type
// survives into the derived group value types.
export function defineSetting<Schema extends z.ZodType>(
  definition: SettingDefinition<Schema>,
): SettingDefinition<Schema> {
  return definition;
}

export type SettingsMap = Record<string, SettingDefinition>;

export type GroupValue<Map extends SettingsMap> = {
  [Key in keyof Map]: z.output<Map[Key]["schema"]>;
};

// Cross-field rules are group-level refinements (R2): validated on the PARSED group value so
// defaults are already in place, attached to `path` so a UI can point at the offending field,
// and carried as data so the docs table can list them.
export type GroupRefinement<Map extends SettingsMap> = {
  id: string;
  description: string;
  path: keyof Map & string;
  // Method syntax on purpose: methods are bivariant, so a concretely-typed group still
  // satisfies the erased SettingsGroup that registry.ts collects groups as.
  valid(value: GroupValue<Map>): boolean;
};

export type SettingsGroup<Id extends string = string, Map extends SettingsMap = SettingsMap> = {
  id: Id;
  label: string;
  description: string;
  settings: Map;
  refinements: readonly GroupRefinement<Map>[];
};

export function defineSettingsGroup<Id extends string, const Map extends SettingsMap>(
  group: SettingsGroup<Id, Map>,
): SettingsGroup<Id, Map> {
  return group;
}
