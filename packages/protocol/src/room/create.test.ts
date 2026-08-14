import { describe, expect, it } from "vitest";
import { limits } from "../limits.ts";
import {
  compactRoundSchema,
  createRoomRequestSchema,
  createRoomResponseSchema,
  generateRoomCode,
  generateSecretToken,
} from "./create.ts";
import { hostTokenSchema, sessionTokenSchema } from "./identity.ts";
import { roomCodeSchema } from "./server-messages.ts";

describe("room creation contracts", () => {
  it("accepts a compact game spec with defaults applied", () => {
    const parsed = createRoomRequestSchema.parse({
      game: { kind: "compact", rounds: [{ columns: 3, rows: 3 }] },
    });
    if (parsed.game.kind !== "compact") throw new Error("expected compact");
    expect(parsed.game.preset).toBe("casual-party");
    expect(parsed.game.hasFinalClue).toBe(false);
    expect(parsed.seed).toBeUndefined();
  });

  it("bounds compact boards to the rules-matrix sizes (3-6 both ways)", () => {
    expect(compactRoundSchema.safeParse({ columns: 7, rows: 3 }).success).toBe(false);
    expect(compactRoundSchema.safeParse({ columns: 3, rows: 2 }).success).toBe(false);
  });

  it("shapes the create response as code + host token + expiry", () => {
    expect(
      createRoomResponseSchema.safeParse({
        code: generateRoomCode(),
        hostToken: generateSecretToken(),
        expiresAt: Date.now() + limits.room.idleExpiryMs,
      }).success,
    ).toBe(true);
  });
});

describe("code and token generation", () => {
  it("generates codes of the configured length that pass the room-code schema", () => {
    for (let round = 0; round < 200; round += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(limits.room.roomCodeLength);
      expect(roomCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("never emits the confusable characters I, O, 0, 1", () => {
    const seen = new Set<string>();
    for (let round = 0; round < 500; round += 1) {
      for (const character of generateRoomCode()) seen.add(character);
    }
    for (const banned of ["I", "O", "0", "1"]) expect(seen.has(banned)).toBe(false);
    // Sanity that the generator is not somehow constant.
    expect(seen.size).toBeGreaterThan(10);
  });

  it("generates 32-hex secrets valid as both host and session tokens", () => {
    const token = generateSecretToken();
    expect(hostTokenSchema.safeParse(token).success).toBe(true);
    expect(sessionTokenSchema.safeParse(token).success).toBe(true);
    expect(generateSecretToken()).not.toBe(token);
  });
});
