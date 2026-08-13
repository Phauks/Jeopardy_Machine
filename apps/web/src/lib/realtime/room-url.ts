// Builds the WebSocket URL for a game room on the realtime Worker. The route shape
// (/room/<CODE>/ws) is canonical vocabulary from docs/design/user-flows.md and must match
// the route pattern in apps/realtime/src/index.ts - this module and that regex are the two
// ends of one contract.
import { limits } from "@jeopardy/protocol/limits";

// Same alphabet the realtime router accepts. Codes are normalized to uppercase here so users
// can type "bqkx7" on the join screen and still land in BQKX7.
const roomCodePattern = new RegExp(`^[A-Z0-9]{${limits.room.roomCodeLength}}$`);

export class InvalidRoomCodeError extends Error {
  constructor(rawCode: string) {
    super(
      `not a valid room code: "${rawCode}" (expected ${limits.room.roomCodeLength} letters/digits)`,
    );
    this.name = "InvalidRoomCodeError";
  }
}

export function normalizeRoomCode(rawCode: string): string {
  const code = rawCode.trim().toUpperCase();
  if (!roomCodePattern.test(code)) throw new InvalidRoomCodeError(rawCode);
  return code;
}

// realtimeOrigin is an http(s) origin (e.g. "http://localhost:8787" in dev,
// "https://rt.example.com" deployed); WebSockets ride the matching ws(s) scheme.
export function roomWebSocketUrl(realtimeOrigin: string, rawCode: string): string {
  const code = normalizeRoomCode(rawCode);
  const origin = new URL(realtimeOrigin);
  const scheme = origin.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${origin.host}/room/${code}/ws`;
}
