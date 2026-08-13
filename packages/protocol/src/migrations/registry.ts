// The real document registry: every portable format this app can open, with its current
// version and migration chain. New formats register here; version bumps register their
// migration in migrations/<format>/<from>-to-<to>.ts with a committed fixture pair, or the
// registry construction (envelope/migration.ts) and the migrations gate test refuse to let
// the bump land.
import { contentPackSchema, contentPackSchemaVersion } from "../content/content-pack.ts";
import { createDocumentRegistry, parseDocument } from "../envelope/migration.ts";
import {
  gameDefinitionSchema,
  gameDefinitionSchemaVersion,
} from "../modes/jeopardy/game-definition.ts";
import { ruleSetSchema, ruleSetSchemaVersion } from "../settings/rule-set.ts";
import { themeSchema, themeSchemaVersion } from "../theme/theme.ts";
import type { DocumentParseResult } from "../envelope/migration.ts";
import type { ContentPack } from "../content/content-pack.ts";
import type { GameDefinition } from "../modes/jeopardy/game-definition.ts";
import type { RuleSet } from "../settings/rule-set.ts";
import type { Theme } from "../theme/theme.ts";

export const documentRegistry = createDocumentRegistry([
  {
    format: "content-pack",
    currentVersion: contentPackSchemaVersion,
    schema: contentPackSchema,
    migrations: [],
  },
  {
    format: "game-definition",
    currentVersion: gameDefinitionSchemaVersion,
    schema: gameDefinitionSchema,
    migrations: [],
  },
  {
    format: "rule-set",
    currentVersion: ruleSetSchemaVersion,
    schema: ruleSetSchema,
    migrations: [],
  },
  { format: "theme", currentVersion: themeSchemaVersion, schema: themeSchema, migrations: [] },
]);

// Every document the app can hold in memory. Narrow on `format` - the literal types
// discriminate the union.
export type PortableDocument = ContentPack | GameDefinition | RuleSet | Theme;

export type PortableDocumentParseResult =
  | { ok: true; document: PortableDocument; migratedFrom: string | null }
  | Extract<DocumentParseResult, { ok: false }>;

// THE entry point for anything claiming to be one of our files - editor import, library
// load, and the Worker re-validating saves all pass through here and nothing else.
export function parsePortableDocument(raw: unknown): PortableDocumentParseResult {
  const result = parseDocument(documentRegistry, raw);
  if (!result.ok) return result;
  // Safe: parseDocument validated against the format's own schema, and every schema in
  // documentRegistry parses to a PortableDocument member.
  return { ...result, document: result.document as PortableDocument };
}
