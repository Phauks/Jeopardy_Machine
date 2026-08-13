import { describe, expect, it } from "vitest";
import { generateId, idSchema } from "./ids.ts";

describe("generateId", () => {
  it("produces ids that validate as UUIDv7", () => {
    for (let count = 0; count < 50; count += 1) {
      expect(idSchema.safeParse(generateId()).success).toBe(true);
    }
  });

  it("encodes the timestamp big-endian so ids sort by creation time", () => {
    const earlier = generateId(1_000_000_000_000);
    const later = generateId(2_000_000_000_000);
    expect(earlier < later).toBe(true);
  });

  it("sets the version and variant bits", () => {
    const id = generateId();
    expect(id.charAt(14)).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id.charAt(19));
  });
});

describe("idSchema", () => {
  it("rejects UUIDv4, ULID, and junk", () => {
    // v4: version nibble is 4, not 7.
    expect(idSchema.safeParse("9f4c0b1e-9d0a-4f7b-8a3c-2f1e0d9c8b7a").success).toBe(false);
    // ULID - the id shape the proposal drafted before resolution R3 switched to UUIDv7.
    expect(idSchema.safeParse("01ARZ3NDEKTSV4RRFFQ69G5FAV").success).toBe(false);
    expect(idSchema.safeParse("not-an-id").success).toBe(false);
  });
});
