// Support code for the migrations gate test (migrations.gate.test.ts): every registered
// migration must ship a committed before/after fixture pair, named
// `src/migrations/<format>/<from>-to-<to>.before.json` / `.after.json`. This is the CI teeth
// behind the convention in envelope/migration.ts - a migration without fixtures, or an orphan
// fixture without a migration, fails the gate rather than rotting silently. Not part of the
// public API; imported by tests only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentFormatDefinition, Migration } from "../envelope/migration.ts";

export const migrationsDirectory = new URL(".", import.meta.url).pathname;

export function fixturePaths(migration: Migration): { before: string; after: string } {
  const stem = join(migrationsDirectory, migration.format, `${migration.from}-to-${migration.to}`);
  return { before: `${stem}.before.json`, after: `${stem}.after.json` };
}

export function readFixturePair(migration: Migration): { before: unknown; after: unknown } {
  const paths = fixturePaths(migration);
  return {
    before: JSON.parse(readFileSync(paths.before, "utf8")),
    after: JSON.parse(readFileSync(paths.after, "utf8")),
  };
}

export function missingFixtureProblems(definition: DocumentFormatDefinition): string[] {
  const problems: string[] = [];
  for (const migration of definition.migrations) {
    const paths = fixturePaths(migration);
    for (const path of [paths.before, paths.after]) {
      if (!existsSync(path)) problems.push(`missing fixture ${path}`);
    }
  }
  return problems;
}

// Orphan check: every `*.before.json` under a format's directory must belong to a registered
// migration - a fixture surviving a deleted migration is drift, not history.
export function orphanFixtureProblems(definitions: readonly DocumentFormatDefinition[]): string[] {
  const known = new Set(
    definitions.flatMap((definition) =>
      definition.migrations.map(
        (migration) => `${migration.format}/${migration.from}-to-${migration.to}`,
      ),
    ),
  );
  const problems: string[] = [];
  for (const definition of definitions) {
    const directory = join(migrationsDirectory, definition.format);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory)) {
      const match = /^(.+)\.before\.json$/.exec(entry);
      if (match !== null && !known.has(`${definition.format}/${match[1]}`)) {
        problems.push(`orphan fixture ${definition.format}/${entry} has no registered migration`);
      }
    }
  }
  return problems;
}
