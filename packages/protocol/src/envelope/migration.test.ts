import { describe, expect, it } from "vitest";
import { z } from "zod";
import { documentSchema } from "./document.ts";
import { createDocumentRegistry, parseDocument } from "./migration.ts";
import type { DocumentFormatDefinition, Migration } from "./migration.ts";

// A self-contained format: 1.x had { message }, 2.0 renamed it to { greeting }, and 2.1
// added an optional-with-default { loud } (minor bump - no migration, defaults absorb it).
const bodySchema = z.strictObject({ greeting: z.string(), loud: z.boolean().default(false) });
const schema = documentSchema("sample", bodySchema);
const renameMigration: Migration = {
  format: "sample",
  from: "1.0",
  to: "2.0",
  migrate: (body) => {
    const { message, ...rest } = body as { message: string };
    return { ...rest, greeting: message };
  },
};
const definition: DocumentFormatDefinition = {
  format: "sample",
  currentVersion: "2.1.0",
  schema,
  migrations: [renameMigration],
};
const registry = createDocumentRegistry([definition]);

const meta = {
  title: "Sample",
  created: "2026-08-13T12:00:00.000Z",
  modified: "2026-08-13T12:00:00.000Z",
};

describe("parseDocument", () => {
  it("parses a current-version document, from raw JSON string too", () => {
    const document = {
      format: "sample",
      schemaVersion: "2.1.0",
      meta,
      body: { greeting: "hi", loud: true },
    };
    const result = parseDocument(registry, JSON.stringify(document));
    expect(result).toMatchObject({ ok: true, migratedFrom: null });
  });

  it("migrates an old major up the chain, preserving the envelope and ext", () => {
    const ext = { "com.example.marker": 1 };
    const result = parseDocument(registry, {
      format: "sample",
      schemaVersion: "1.0.3",
      meta,
      ext,
      body: { message: "hello" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe("1.0");
      expect(result.document).toMatchObject({
        schemaVersion: "2.1.0",
        meta,
        ext,
        body: { greeting: "hello", loud: false },
      });
    }
  });

  it("parses an older minor of the current major without any migration (defaults absorb)", () => {
    const result = parseDocument(registry, {
      format: "sample",
      schemaVersion: "2.0.0",
      meta,
      body: { greeting: "hi" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedFrom).toBe("2.0");
      expect(result.document).toMatchObject({ body: { greeting: "hi", loud: false } });
    }
  });

  it("refuses newer major AND newer minor with the update-the-app message", () => {
    for (const version of ["3.0.0", "2.2.0"]) {
      const result = parseDocument(registry, {
        format: "sample",
        schemaVersion: version,
        meta,
        body: {},
      });
      expect(result).toMatchObject({ ok: false, reason: "newer-than-app" });
      if (!result.ok) expect(result.detail).toContain("update the app");
    }
  });

  it("ignores patch entirely - a newer patch of the current version parses", () => {
    const result = parseDocument(registry, {
      format: "sample",
      schemaVersion: "2.1.9",
      meta,
      body: { greeting: "hi" },
    });
    expect(result).toMatchObject({ ok: true, migratedFrom: null });
  });

  it("refuses unknown formats and shapeless input distinctly", () => {
    expect(
      parseDocument(registry, { format: "mystery", schemaVersion: "1.0.0", meta, body: {} }),
    ).toMatchObject({ ok: false, reason: "unknown-format" });
    expect(parseDocument(registry, "not json{")).toMatchObject({ ok: false, reason: "malformed" });
    expect(parseDocument(registry, [1, 2])).toMatchObject({ ok: false, reason: "malformed" });
    expect(parseDocument(registry, { schemaVersion: "1.0.0" })).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });

  it("reports a migrated body that fails the current schema as invalid, with paths", () => {
    const result = parseDocument(registry, {
      format: "sample",
      schemaVersion: "1.0.0",
      meta,
      body: { message: 42 },
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok) expect(result.detail).toContain("greeting");
  });
});

describe("createDocumentRegistry", () => {
  it("throws when a version bump has no migration path from genesis 1.0", () => {
    expect(() =>
      createDocumentRegistry([{ format: "gap", currentVersion: "2.0.0", schema, migrations: [] }]),
    ).toThrow(/no migration path/);
  });

  it("accepts a minor bump with no migrations - additive changes need no upgrader", () => {
    expect(() =>
      createDocumentRegistry([{ format: "ok", currentVersion: "1.4.0", schema, migrations: [] }]),
    ).not.toThrow();
  });

  it("throws on duplicate formats and duplicate from-versions", () => {
    expect(() => createDocumentRegistry([definition, definition])).toThrow(/duplicate/);
    expect(() =>
      createDocumentRegistry([{ ...definition, migrations: [renameMigration, renameMigration] }]),
    ).toThrow(/bad migration/);
  });
});
