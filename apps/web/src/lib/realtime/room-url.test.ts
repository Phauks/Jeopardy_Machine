import { describe, expect, it } from "vitest";
import { InvalidRoomCodeError, normalizeRoomCode, roomWebSocketUrl } from "./room-url.ts";

describe("normalizeRoomCode", () => {
  it("uppercases and trims what a human typed", () => {
    expect(normalizeRoomCode("  bqkx7 ")).toBe("BQKX7");
  });

  it("throws a typed error on wrong length or alphabet", () => {
    expect(() => normalizeRoomCode("ABC")).toThrow(InvalidRoomCodeError);
    expect(() => normalizeRoomCode("AB CD!")).toThrow(InvalidRoomCodeError);
  });
});

describe("roomWebSocketUrl", () => {
  it("maps http dev origins to ws", () => {
    expect(roomWebSocketUrl("bqkx7", "http://localhost:8788")).toBe(
      "ws://localhost:8788/room/BQKX7/ws",
    );
  });

  it("maps https deployed origins to wss", () => {
    expect(roomWebSocketUrl("BQKX7", "https://play.example.com")).toBe(
      "wss://play.example.com/room/BQKX7/ws",
    );
  });

  it("defaults to the page's own origin - there is no second host to dial", () => {
    // The deleted direct-realtime-origin mode is why this default exists rather than a
    // parameter every caller has to get right (single-origin decision, 2026-08-14 deletion).
    const page = { origin: "https://play.example.com" };
    const previous = globalThis.location;
    Object.defineProperty(globalThis, "location", { value: page, configurable: true });
    try {
      expect(roomWebSocketUrl("BQKX7")).toBe("wss://play.example.com/room/BQKX7/ws");
    } finally {
      Object.defineProperty(globalThis, "location", { value: previous, configurable: true });
    }
  });
});
