import { describe, expect, it } from "vitest";
import { generateId } from "../ids.ts";
import { mediaAssetSchema, mediaRefSchema } from "./media-ref.ts";

const sha = "a".repeat(64);

const validAsset = {
  id: generateId(),
  kind: "image",
  mime: "image/webp",
  bytes: 123_456,
  sha256: sha,
  alt: "A sequoia grove at dawn",
  storage: { state: "remote", url: "https://example.com/media/abc" },
};

describe("mediaAssetSchema", () => {
  it("accepts each storage state with exactly its own fields", () => {
    expect(mediaAssetSchema.safeParse(validAsset).success).toBe(true);
    expect(
      mediaAssetSchema.safeParse({
        ...validAsset,
        storage: { state: "bundled", path: "media/abc.webp" },
      }).success,
    ).toBe(true);
    expect(
      mediaAssetSchema.safeParse({ ...validAsset, storage: { state: "pending-local" } }).success,
    ).toBe(true);
    // Cross-state fields are rejected: a pending-local row must not smuggle a url.
    expect(
      mediaAssetSchema.safeParse({
        ...validAsset,
        storage: { state: "pending-local", url: "https://example.com" },
      }).success,
    ).toBe(false);
  });

  it("rejects bad hashes, kinds, and non-positive sizes", () => {
    expect(mediaAssetSchema.safeParse({ ...validAsset, sha256: "ABC" }).success).toBe(false);
    expect(mediaAssetSchema.safeParse({ ...validAsset, kind: "video" }).success).toBe(false);
    expect(mediaAssetSchema.safeParse({ ...validAsset, bytes: 0 }).success).toBe(false);
  });
});

describe("mediaRefSchema", () => {
  it("is an id and nothing else - bytes-location lives in the media table", () => {
    expect(mediaRefSchema.safeParse({ mediaId: generateId() }).success).toBe(true);
    expect(
      mediaRefSchema.safeParse({ mediaId: generateId(), url: "https://example.com" }).success,
    ).toBe(false);
    expect(mediaRefSchema.safeParse({ mediaId: "not-a-uuid" }).success).toBe(false);
  });
});
