import { describe, expect, it } from "vitest";
import { generateId } from "../ids.ts";
import { contentPackSchema, contentPackSchemaVersion } from "./content-pack.ts";

const mediaId = generateId();

const validPack = {
  format: "content-pack",
  schemaVersion: contentPackSchemaVersion,
  meta: {
    title: "Environment and Gaming",
    author: "Board Game Club",
    license: "CC-BY-4.0",
    created: "2026-08-13T12:00:00.000Z",
    modified: "2026-08-13T12:00:00.000Z",
  },
  body: {
    items: [
      {
        id: generateId(),
        type: "basic",
        prompt: { text: "This gas makes up about 78 percent of Earth's atmosphere" },
        answer: { canonical: "Nitrogen", accepted: ["N2"] },
        tags: ["science"],
      },
      {
        id: generateId(),
        type: "basic",
        prompt: { text: "Name this national park", media: { mediaId } },
        answer: { canonical: "Zion National Park", media: { mediaId } },
      },
    ],
    media: [
      {
        id: mediaId,
        kind: "image",
        mime: "image/webp",
        bytes: 204_800,
        sha256: "b".repeat(64),
        alt: "Sandstone cliffs over a river canyon",
        storage: { state: "bundled", path: `media/${mediaId}.webp` },
      },
    ],
    description: "Question pool for the club night",
    tags: ["environment", "gaming"],
  },
};

describe("contentPackSchema", () => {
  it("accepts a full pack, including an item whose answer carries media", () => {
    const parsed = contentPackSchema.parse(validPack);
    expect(parsed.body.items).toHaveLength(2);
    expect(parsed.body.items[1]?.answer.media).toEqual({ mediaId });
  });

  it("round-trips parse -> serialize -> parse identically, ext included", () => {
    const withExt = { ...validPack, ext: { "org.club.season": 3 } };
    const first = contentPackSchema.parse(withExt);
    const second = contentPackSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
    expect(second.ext).toEqual(withExt.ext);
  });

  it("requires at least one item", () => {
    expect(
      contentPackSchema.safeParse({ ...validPack, body: { ...validPack.body, items: [] } }).success,
    ).toBe(false);
  });

  it("rejects unknown keys at every level - pack body, item, and envelope", () => {
    expect(contentPackSchema.safeParse({ ...validPack, publisher: "x" }).success).toBe(false);
    expect(
      contentPackSchema.safeParse({ ...validPack, body: { ...validPack.body, curated: true } })
        .success,
    ).toBe(false);
  });

  it("rejects a wrong format literal even when the rest is valid", () => {
    expect(contentPackSchema.safeParse({ ...validPack, format: "game-definition" }).success).toBe(
      false,
    );
  });
});
