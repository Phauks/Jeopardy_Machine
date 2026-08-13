import { describe, expect, it } from "vitest";
import { generateId } from "../ids.ts";
import { colorSchema } from "./tokens.ts";
import { themeSchema, themeSchemaVersion } from "./theme.ts";

const mediaId = generateId();

const validTheme = {
  format: "theme",
  schemaVersion: themeSchemaVersion,
  meta: {
    title: "Terra Verde",
    author: "Board Game Club",
    created: "2026-08-13T12:00:00.000Z",
    modified: "2026-08-13T12:00:00.000Z",
  },
  body: {
    tokens: {
      boardBackground: { kind: "gradient", from: "#0b3d2e", to: "#052018", angleDeg: 160 },
      cellBackground: { kind: "solid", color: "#11563f" },
      categoryBackground: { kind: "solid", color: "#0b3d2e" },
      valueColor: "#e7c161",
      clueTextColor: "#f5f1e6",
      accentColor: "#e7c161",
      usedCellTreatment: "dimmed",
    },
    fontSlots: { display: "alfa-slab-one", values: "six-caps", clue: "bitter", chrome: "oswald" },
    background: { kind: "image", media: { mediaId }, dim: 0.5 },
    effectsLevel: "dimensional",
    soundSet: "minimal-beeps",
    media: [
      {
        id: mediaId,
        kind: "image",
        mime: "image/webp",
        bytes: 512_000,
        sha256: "c".repeat(64),
        alt: "Forest canopy",
        storage: { state: "remote", url: "https://example.com/media/bg" },
      },
    ],
  },
};

describe("themeSchema", () => {
  it("accepts a fully-specified theme", () => {
    const parsed = themeSchema.parse(validTheme);
    expect(parsed.body.effectsLevel).toBe("dimensional");
    expect(parsed.body.background.kind).toBe("image");
  });

  it("fills defaults: font slots, effects level, empty media, gradient angle", () => {
    const minimal = themeSchema.parse({
      ...validTheme,
      body: {
        tokens: { ...validTheme.body.tokens, usedCellTreatment: undefined },
        background: { kind: "solid", color: "#10102a" },
      },
    });
    expect(minimal.body.fontSlots).toEqual({
      display: "anton",
      values: "oswald",
      clue: "bitter",
      chrome: "oswald",
    });
    expect(minimal.body.effectsLevel).toBe("flat");
    expect(minimal.body.media).toEqual([]);
    expect(minimal.body.soundSet).toBeUndefined();
    expect(minimal.body.tokens.usedCellTreatment).toBe("blank-dark");
  });

  it("round-trips parse -> serialize -> parse identically, ext included", () => {
    const withExt = { ...validTheme, ext: { "com.example.palette-source": "club-logo" } };
    const first = themeSchema.parse(withExt);
    const second = themeSchema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it("rejects fonts outside the curated set (boundary 2.5)", () => {
    expect(
      themeSchema.safeParse({
        ...validTheme,
        body: { ...validTheme.body, fontSlots: { display: "comic-sans" } },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed colors and out-of-range dim", () => {
    expect(colorSchema.safeParse("#ABC123").success).toBe(false); // uppercase
    expect(colorSchema.safeParse("#abc").success).toBe(false); // shorthand
    expect(colorSchema.safeParse("rebeccapurple").success).toBe(false);
    expect(
      themeSchema.safeParse({
        ...validTheme,
        body: { ...validTheme.body, background: { kind: "image", media: { mediaId }, dim: 1.5 } },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown sound sets and stray body keys", () => {
    expect(
      themeSchema.safeParse({ ...validTheme, body: { ...validTheme.body, soundSet: "airhorn" } })
        .success,
    ).toBe(false);
    expect(
      themeSchema.safeParse({ ...validTheme, body: { ...validTheme.body, css: "body{}" } }).success,
    ).toBe(false);
  });
});
