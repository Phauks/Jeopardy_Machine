import { describe, expect, it } from "vitest";
import { parseDocument } from "../../envelope/migration.ts";
import { readFixturePair } from "../fixture-gate.ts";
import { exampleRegistry, exampleSchemaVersion } from "./example-format.ts";
import { exampleRenameMigration } from "./1.0-to-1.1.ts";

describe("example 1.0 -> 1.1 migration (the machinery proof)", () => {
  const { before, after } = readFixturePair(exampleRenameMigration);

  it("parses the committed 1.0 fixture all the way to the current version", () => {
    const result = parseDocument(exampleRegistry, before);
    expect(result).toMatchObject({ ok: true, migratedFrom: "1.0" });
    if (result.ok) {
      expect(result.document).toMatchObject({
        schemaVersion: exampleSchemaVersion,
        body: { greeting: "hello from schema 1.0", excited: false },
      });
    }
  });

  it("preserves envelope meta and the ext bag across the migration", () => {
    const result = parseDocument(exampleRegistry, before);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const migrated = result.document as { meta: unknown; ext: unknown };
      expect(migrated.meta).toEqual((after as { meta: unknown }).meta);
      expect(migrated.ext).toEqual((after as { ext: unknown }).ext);
    }
  });

  it("round-trips the migrated document: parse -> serialize -> parse is identical", () => {
    const first = parseDocument(exampleRegistry, before);
    expect(first.ok).toBe(true);
    if (first.ok) {
      const second = parseDocument(exampleRegistry, JSON.stringify(first.document));
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.document).toEqual(first.document);
    }
  });
});
