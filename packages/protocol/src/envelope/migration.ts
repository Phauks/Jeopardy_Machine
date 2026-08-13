// Document migration machinery: the registry of known formats and `parseDocument`, the ONE
// entry point through which every stored/imported document passes - editor import, library
// load, and the Worker re-validating saves (one schema, two enforcement points).
//
// Reader policy (docs/proposals/m1-protocol.md section 1): a file whose major.minor is newer
// than the app knows is refused ("update the app" - the service worker makes that a reload;
// silently dropping unknown fields on re-export would be data loss). An older major migrates
// up through registered steps. An older minor within the current major parses directly -
// minor bumps are additive optional-with-default only, so defaults absorb the gap and no
// upgrader exists. Patch never appears in migration logic.
import { semverSchema } from "./document.ts";
import type { z } from "zod";

export type Migration = {
  format: string;
  from: string; // exact "major.minor" it consumes
  to: string; // exact "major.minor" it produces
  migrate: (body: unknown) => unknown; // pure, synchronous, total - envelope never passed in
};

export type DocumentFormatDefinition = {
  format: string;
  currentVersion: string; // full semver; must equal the version constant next to the schema
  schema: z.ZodType; // the complete document schema (envelope + body)
  migrations: readonly Migration[];
};

export type DocumentRegistry = ReadonlyMap<string, DocumentFormatDefinition>;

function majorMinor(version: string): { major: number; minor: number; key: string } {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return { major, minor, key: `${major}.${minor}` };
}

// Registry construction validates migration-chain integrity at import time, everywhere - not
// just in CI: every format is born at 1.0, and 1.0 plus every migration endpoint must reach
// currentVersion through registered steps (minor gaps absorb). Bumping a version constant
// without registering the migration therefore throws the moment anything imports the registry.
export function createDocumentRegistry(
  definitions: readonly DocumentFormatDefinition[],
): DocumentRegistry {
  const registry = new Map<string, DocumentFormatDefinition>();
  for (const definition of definitions) {
    if (registry.has(definition.format)) {
      throw new Error(`duplicate document format "${definition.format}"`);
    }
    if (!semverSchema.safeParse(definition.currentVersion).success) {
      throw new Error(`format "${definition.format}" has non-semver version`);
    }
    const steps = new Map<string, Migration>();
    for (const migration of definition.migrations) {
      if (migration.format !== definition.format || steps.has(migration.from)) {
        throw new Error(
          `bad migration ${migration.from}->${migration.to} on "${definition.format}"`,
        );
      }
      steps.set(migration.from, migration);
    }
    const current = majorMinor(definition.currentVersion);
    const starts = ["1.0", ...definition.migrations.map((migration) => migration.to)];
    for (const start of starts) {
      let at = majorMinor(start);
      // Step cap doubles as a cycle guard - a migration loop would otherwise walk forever.
      for (let hops = 0; hops <= definition.migrations.length; hops += 1) {
        const step = steps.get(at.key);
        if (step === undefined) break;
        at = majorMinor(step.to);
      }
      if (at.major !== current.major || at.minor > current.minor) {
        throw new Error(
          `format "${definition.format}": no migration path from ${start} to ${definition.currentVersion}`,
        );
      }
    }
    registry.set(definition.format, definition);
  }
  return registry;
}

export type DocumentParseResult =
  | { ok: true; document: unknown; migratedFrom: string | null }
  // "malformed": not a document shape at all. "unknown-format": we never heard of it.
  // "newer-than-app": made by a newer deploy - the fix is updating the app, not the file.
  // "missing-migration": registry gap, always OUR bug (construction should have caught it).
  // "invalid": right format and version, body fails its schema.
  | {
      ok: false;
      reason: "malformed" | "unknown-format" | "newer-than-app" | "missing-migration" | "invalid";
      detail: string;
    };

export function parseDocument(registry: DocumentRegistry, raw: unknown): DocumentParseResult {
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "malformed", detail: "document is not valid JSON" };
    }
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, reason: "malformed", detail: "document is not a JSON object" };
  }
  const envelope = candidate as Record<string, unknown>;
  const { format, schemaVersion } = envelope;
  if (typeof format !== "string" || format.length === 0) {
    return { ok: false, reason: "malformed", detail: "document has no format field" };
  }
  const definition = registry.get(format);
  if (definition === undefined) {
    return { ok: false, reason: "unknown-format", detail: `unknown document format "${format}"` };
  }
  if (!semverSchema.safeParse(schemaVersion).success) {
    return { ok: false, reason: "malformed", detail: "document has no semver schemaVersion" };
  }
  const current = majorMinor(definition.currentVersion);
  let at = majorMinor(schemaVersion as string);
  if (at.major > current.major || (at.major === current.major && at.minor > current.minor)) {
    return {
      ok: false,
      reason: "newer-than-app",
      detail: `this file was made by a newer version (schema ${String(schemaVersion)}, app knows ${definition.currentVersion}) - update the app`,
    };
  }
  const fromVersion = at.key === current.key ? null : at.key;
  let body: unknown = envelope["body"];
  while (at.key !== current.key) {
    const step = definition.migrations.find((migration) => migration.from === at.key);
    if (step === undefined) {
      // Older minor, same major: additive defaults absorb the gap - no migration exists.
      if (at.major === current.major) break;
      return {
        ok: false,
        reason: "missing-migration",
        detail: `no migration from ${format} ${at.key} toward ${definition.currentVersion}`,
      };
    }
    body = step.migrate(body);
    at = majorMinor(step.to);
  }
  // Migrated (or minor-absorbed) documents re-validate as CURRENT, so schemaVersion is
  // normalized before the parse: in-memory documents are always current-version documents
  // and re-export never writes a stale version string.
  const parsed = definition.schema.safeParse({
    ...envelope,
    schemaVersion: definition.currentVersion,
    body,
  });
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    };
  }
  return { ok: true, document: parsed.data, migratedFrom: fromVersion };
}
