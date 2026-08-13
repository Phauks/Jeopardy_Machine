// Document/content ids: RFC 9562 UUIDv7, generated client-side with no coordination
// (owner resolution R3 in docs/proposals/m1-protocol.md - UUIDv7 over ULID: same time-sortable
// property, but IETF-standard with native tooling/DB support). This module is the single home
// for both generation and validation so no other file ever hand-rolls an id shape.
import { z } from "zod";

// zod's uuidv7 check enforces the version nibble (7) and RFC 4122/9562 variant bits, so a
// v4 id - or a ULID from the proposal's earlier draft - is rejected, not silently accepted.
export const idSchema = z.uuidv7();

export type Id = z.infer<typeof idSchema>;

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

// UUIDv7 layout: 48-bit big-endian unix-ms timestamp, then version nibble 7 + 12 random bits,
// then variant bits 10 + 62 random bits. Sub-millisecond monotonicity is deliberately not
// implemented: ids here name documents and media, never order events (game ordering is the
// DO's seq numbers), so same-millisecond ties sorting randomly is harmless.
export function generateId(timestampMs: number = Date.now()): Id {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let remaining = timestampMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const digits = Array.from(bytes, hex);
  return [
    digits.slice(0, 4).join(""),
    digits.slice(4, 6).join(""),
    digits.slice(6, 8).join(""),
    digits.slice(8, 10).join(""),
    digits.slice(10, 16).join(""),
  ].join("-");
}
