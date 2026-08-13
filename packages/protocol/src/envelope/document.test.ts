import { describe, expect, it } from "vitest";
import { z } from "zod";
import { documentMetaSchema, documentSchema, semverSchema } from "./document.ts";

const testSchema = documentSchema("test-doc", z.strictObject({ value: z.int() }));

const validDocument = {
  format: "test-doc",
  schemaVersion: "1.0.0",
  meta: {
    title: "A title",
    created: "2026-08-13T12:00:00.000Z",
    modified: "2026-08-13T12:00:00.000Z",
  },
  body: { value: 7 },
};

describe("documentSchema", () => {
  it("accepts a complete document and infers the body type", () => {
    const parsed = testSchema.parse(validDocument);
    expect(parsed.body.value).toBe(7);
  });

  it("rejects unknown envelope keys - ext is the only home for foreign data", () => {
    expect(testSchema.safeParse({ ...validDocument, extra: true }).success).toBe(false);
  });

  it("rejects unknown body keys", () => {
    expect(testSchema.safeParse({ ...validDocument, body: { value: 7, extra: 1 } }).success).toBe(
      false,
    );
  });

  it("round-trips the ext bag untouched through parse -> serialize -> parse", () => {
    const ext = { "com.example.notes": { nested: [1, "two", null] } };
    const first = testSchema.parse({ ...validDocument, ext });
    const second = testSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
    expect(second.ext).toEqual(ext);
  });

  it("refuses a wrong format literal", () => {
    expect(testSchema.safeParse({ ...validDocument, format: "other" }).success).toBe(false);
  });
});

describe("documentMetaSchema", () => {
  it("requires a title and UTC ISO timestamps", () => {
    expect(documentMetaSchema.safeParse(validDocument.meta).success).toBe(true);
    expect(documentMetaSchema.safeParse({ ...validDocument.meta, title: "" }).success).toBe(false);
    // Offset form is rejected on purpose: one instant, one serialization.
    expect(
      documentMetaSchema.safeParse({ ...validDocument.meta, created: "2026-08-13T12:00:00+02:00" })
        .success,
    ).toBe(false);
  });
});

describe("semverSchema", () => {
  it("accepts plain semver and rejects ranges, prereleases, and short forms", () => {
    expect(semverSchema.safeParse("1.0.0").success).toBe(true);
    expect(semverSchema.safeParse("12.34.56").success).toBe(true);
    for (const bad of ["1.0", "^1.0.0", "1.0.0-beta.1", "v1.0.0", ""]) {
      expect(semverSchema.safeParse(bad).success).toBe(false);
    }
  });
});
