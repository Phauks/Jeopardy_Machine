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

  it("shapes the create response as code + host token + expiry + the visibility echo", () => {
    expect(
      createRoomResponseSchema.safeParse({
        code: generateRoomCode(),
        hostToken: generateSecretToken(),
        expiresAt: Date.now() + limits.room.idleExpiryMs,
        visibility: "unlisted",
        hasPassword: false,
        registry: { status: "ok" },
      }).success,
    ).toBe(true);
  });

  it("makes the registry verdict mandatory: 'created but not listed' must be sayable", () => {
    const base = {
      code: generateRoomCode(),
      hostToken: generateSecretToken(),
      expiresAt: Date.now() + limits.room.idleExpiryMs,
      visibility: "public" as const,
      hasPassword: false,
    };
    expect(createRoomResponseSchema.safeParse(base).success).toBe(false);
    expect(
      createRoomResponseSchema.safeParse({
        ...base,
        registry: { status: "unavailable", reason: "no-table" },
      }).success,
    ).toBe(true);
  });
});

const overLength = (cap: number) => "x".repeat(cap + 1);

// docs/decisions/2026-08-14-room-visibility-and-lobby.md: listing and entry are independent
// axes, and the default combination is the untouched QR flow (unlisted + open).
describe("room visibility and password fields", () => {
  const game = { kind: "compact", rounds: [{ columns: 3, rows: 3 }] } as const;

  it("defaults to unlisted with no password, so creating a room never publishes it", () => {
    const parsed = createRoomRequestSchema.parse({ game });
    expect(parsed.visibility).toBe("unlisted");
    expect(parsed.password).toBeUndefined();
    expect(parsed.title).toBeUndefined();
  });

  it("accepts all four listing/entry combinations", () => {
    for (const visibility of ["public", "unlisted"] as const) {
      for (const password of [undefined, "hunter2!"]) {
        const parsed = createRoomRequestSchema.safeParse({
          game,
          visibility,
          title: "Quiz night",
          hostLabel: "Board Game Club",
          ...(password !== undefined && { password }),
        });
        expect(
          parsed.success,
          `${visibility} + ${password === undefined ? "open" : "password"}`,
        ).toBe(true);
      }
    }
  });

  it("requires a title for a public room (an unnamed lobby row is noise)", () => {
    expect(createRoomRequestSchema.safeParse({ game, visibility: "public" }).success).toBe(false);
    expect(
      createRoomRequestSchema.safeParse({ game, visibility: "public", title: "Pub quiz" }).success,
    ).toBe(true);
    // ...and never for an unlisted one: nobody ever reads that title.
    expect(createRoomRequestSchema.safeParse({ game, visibility: "unlisted" }).success).toBe(true);
  });

  it("enforces the limits module's caps on title, host label, and password", () => {
    expect(
      createRoomRequestSchema.safeParse({
        game,
        title: overLength(limits.room.roomTitleMaxLength),
      }).success,
    ).toBe(false);
    expect(
      createRoomRequestSchema.safeParse({
        game,
        hostLabel: overLength(limits.room.hostLabelMaxLength),
      }).success,
    ).toBe(false);
    expect(
      createRoomRequestSchema.safeParse({
        game,
        password: "x".repeat(limits.room.roomPasswordMinLength - 1),
      }).success,
    ).toBe(false);
    expect(
      createRoomRequestSchema.safeParse({
        game,
        password: overLength(limits.room.roomPasswordMaxLength),
      }).success,
    ).toBe(false);
  });

  it("refuses unknown visibility values and stray fields", () => {
    expect(createRoomRequestSchema.safeParse({ game, visibility: "secret" }).success).toBe(false);
    expect(createRoomRequestSchema.safeParse({ game, listed: true }).success).toBe(false);
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
