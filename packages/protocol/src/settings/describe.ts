// Derivation (c) of resolution R2: the machine-readable registry description. JSON-safe on
// purpose - a future settings UI (M1 phase 2 editor, progressive-disclosure panel) renders
// panels straight from this structure without importing zod, and it round-trips through
// postMessage/serialization. Constraints ride as standard JSON Schema (zod's own conversion),
// so a renderer maps schema.type/enum/minimum/maximum onto controls generically.
import { z } from "zod";
import { settingsGroups } from "./registry.ts";

export type SettingDescription = {
  key: string;
  group: string;
  matrixRow: number | null;
  label: string;
  description: string;
  constraints: string | null;
  defaultValue: unknown;
  // JSON Schema (draft 2020-12) of the setting's value, default included.
  schema: Record<string, unknown>;
};

export type GroupDescription = {
  id: string;
  label: string;
  description: string;
  refinements: readonly { id: string; description: string; path: string }[];
  settings: readonly SettingDescription[];
};

export function describeSettingsRegistry(): readonly GroupDescription[] {
  return settingsGroups.map((group) => ({
    id: group.id,
    label: group.label,
    description: group.description,
    refinements: group.refinements.map(({ id, description, path }) => ({ id, description, path })),
    settings: Object.entries(group.settings).map(([key, definition]) => {
      const jsonSchema = z.toJSONSchema(definition.schema) as Record<string, unknown>;
      // The $schema marker is noise inside a per-field descriptor.
      delete jsonSchema["$schema"];
      return {
        key,
        group: group.id,
        matrixRow: definition.matrixRow,
        label: definition.label,
        description: definition.description,
        constraints: definition.constraints ?? null,
        defaultValue: definition.schema.parse(undefined),
        schema: jsonSchema,
      };
    }),
  }));
}
