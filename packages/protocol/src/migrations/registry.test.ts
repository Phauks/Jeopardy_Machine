import { describe, expect, it } from "vitest";
import { generateId } from "../ids.ts";
import { documentRegistry, parsePortableDocument } from "./registry.ts";

const meta = {
  title: "Registry test",
  created: "2026-08-13T12:00:00.000Z",
  modified: "2026-08-13T12:00:00.000Z",
};

describe("documentRegistry", () => {
  it("registers exactly the four portable formats", () => {
    expect([...documentRegistry.keys()].toSorted()).toEqual([
      "content-pack",
      "game-definition",
      "rule-set",
      "theme",
    ]);
  });
});

describe("parsePortableDocument", () => {
  it("parses a rule set and the format literal narrows the union", () => {
    const result = parsePortableDocument({
      format: "rule-set",
      schemaVersion: "1.0.0",
      meta,
      body: { base: "tv" },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.document.format === "rule-set") {
      expect(result.document.body.base).toBe("tv");
    } else {
      expect.unreachable("expected a rule-set document");
    }
  });

  it("parses a content pack from a raw JSON export string", () => {
    const raw = JSON.stringify({
      format: "content-pack",
      schemaVersion: "1.0.0",
      meta,
      body: {
        items: [
          {
            id: generateId(),
            type: "basic",
            prompt: { text: "A prompt" },
            answer: { canonical: "An answer" },
          },
        ],
      },
    });
    expect(parsePortableDocument(raw)).toMatchObject({ ok: true, migratedFrom: null });
  });

  it("refuses foreign formats and newer versions through the shared reader policy", () => {
    expect(
      parsePortableDocument({ format: "quiz-bundle", schemaVersion: "1.0.0", meta, body: {} }),
    ).toMatchObject({ ok: false, reason: "unknown-format" });
    expect(
      parsePortableDocument({ format: "theme", schemaVersion: "9.0.0", meta, body: {} }),
    ).toMatchObject({ ok: false, reason: "newer-than-app" });
  });
});
