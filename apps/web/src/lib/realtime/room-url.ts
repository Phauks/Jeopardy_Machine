// Builds the WebSocket URL for a game room on the realtime Worker. The route shape
// (/room/<CODE>/ws) is canonical vocabulary from docs/design/user-flows.md and must match
// the route pattern in apps/realtime/src/index.ts - this module and that regex are the two
// ends of one contract.
import { limits } from "@jeopardy/protocol/limits";
import { roomCodeAlphabet } from "@jeopardy/protocol/room/server-messages";

// The protocol's alphabet verbatim - not a second pattern that happens to agree. It did not
// agree until 2026-08-20: this accepted all 36 alphanumerics while the generator only ever
// drew from 32, so a typed `O` passed here, dialled a socket and came back "no such room",
// which is the same sentence a room that ENDED gets. Codes are uppercased on the way in, so
// somebody reading "bqkx7" off a table tent still lands in BQKX7.
const roomCodePattern = new RegExp(
  `^[${roomCodeAlphabet}]{${String(limits.room.roomCodeLength)}}$`,
);

export class InvalidRoomCodeError extends Error {
  constructor(rawCode: string) {
    super(
      `not a valid room code: "${rawCode}" (expected ${String(limits.room.roomCodeLength)} characters from ${roomCodeAlphabet})`,
    );
    this.name = "InvalidRoomCodeError";
  }
}

export function normalizeRoomCode(rawCode: string): string {
  const code = rawCode.trim().toUpperCase();
  if (!roomCodePattern.test(code)) throw new InvalidRoomCodeError(rawCode);
  return code;
}

/**
 * The room's socket URL on THIS origin. There is no other kind as of 2026-08-14: the direct
 * realtime origin (a second host dialed with a build-time variable) is deleted - owner call,
 * recorded in docs/decisions/2026-08-13-single-origin-binding.md. One origin means one URL on
 * the QR code, no CORS, and no way to ship a localhost dial to production.
 *
 * `pageOrigin` exists so this stays a pure function testable without a DOM; callers pass
 * nothing, and the page's own origin is used. WebSockets ride the matching ws(s) scheme.
 */
export function roomWebSocketUrl(
  rawCode: string,
  pageOrigin: string = globalThis.location.origin,
): string {
  const code = normalizeRoomCode(rawCode);
  const origin = new URL(pageOrigin);
  const scheme = origin.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${origin.host}/room/${code}/ws`;
}
