import { describe, expect, it } from "vitest";
import { generateId } from "../ids.ts";
import { contentItemSchema, tagSchema } from "./content-item.ts";

const validItem = {
  id: generateId(),
  type: "basic",
  prompt: { text: "This national park protects the largest trees on Earth by volume" },
  answer: { canonical: "Sequoia National Park" },
};

describe("contentItemSchema", () => {
  it("accepts a minimal item and fills defaults", () => {
    const parsed = contentItemSchema.parse(validItem);
    expect(parsed.answer.accepted).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.provenance).toBe("human");
  });

  it("accepts media on the prompt, on the answer, and on both (owner directive: reveals show media too)", () => {
    const promptMedia = { mediaId: generateId() };
    const answerMedia = { mediaId: generateId() };
    const both = contentItemSchema.parse({
      ...validItem,
      prompt: { ...validItem.prompt, media: promptMedia },
      answer: { ...validItem.answer, media: answerMedia },
    });
    expect(both.prompt.media).toEqual(promptMedia);
    expect(both.answer.media).toEqual(answerMedia);
    expect(
      contentItemSchema.safeParse({
        ...validItem,
        answer: { ...validItem.answer, media: answerMedia },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed media refs on either side", () => {
    expect(
      contentItemSchema.safeParse({
        ...validItem,
        prompt: { ...validItem.prompt, media: { mediaId: "nope" } },
      }).success,
    ).toBe(false);
    expect(
      contentItemSchema.safeParse({
        ...validItem,
        answer: { ...validItem.answer, media: { url: "https://example.com" } },
      }).success,
    ).toBe(false);
  });

  it("round-trips answer media and ext through parse -> serialize -> parse", () => {
    const first = contentItemSchema.parse({
      ...validItem,
      answer: { ...validItem.answer, media: { mediaId: generateId() } },
      ext: { "com.example.grader": { fuzz: 0.8 } },
    });
    const second = contentItemSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it("rejects unknown types, unknown keys, and out-of-range difficulty", () => {
    expect(contentItemSchema.safeParse({ ...validItem, type: "survey" }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...validItem, bonus: true }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...validItem, difficulty: 6 }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...validItem, difficulty: 3 }).success).toBe(true);
  });

  it("rejects empty prompt or canonical answer", () => {
    expect(contentItemSchema.safeParse({ ...validItem, prompt: { text: "" } }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...validItem, answer: { canonical: "" } }).success).toBe(
      false,
    );
  });
});

describe("tagSchema", () => {
  it("accepts kebab-case and rejects everything else", () => {
    expect(tagSchema.safeParse("national-parks").success).toBe(true);
    for (const bad of ["National-Parks", "spaces here", "-lead", "trail-", "under_score"]) {
      expect(tagSchema.safeParse(bad).success).toBe(false);
    }
  });
});
