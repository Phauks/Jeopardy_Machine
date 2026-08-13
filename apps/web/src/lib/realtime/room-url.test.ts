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
    expect(roomWebSocketUrl("http://localhost:8787", "bqkx7")).toBe(
      "ws://localhost:8787/room/BQKX7/ws",
    );
  });

  it("maps https deployed origins to wss", () => {
    expect(roomWebSocketUrl("https://rt.example.com", "BQKX7")).toBe(
      "wss://rt.example.com/room/BQKX7/ws",
    );
  });
});
