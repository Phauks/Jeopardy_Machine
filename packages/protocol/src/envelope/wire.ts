// The versioned wire envelope - every WebSocket message in either direction is a JSON object
// of this shape. M0 defines only the envelope; the per-type message schemas (join, buzz,
// host actions, state patches) arrive with M1/M3 and will extend it.
//
// Versioning contract (docs/design/expansion-and-boundaries.md, boundary 2.6): message shapes
// are versioned and migrate forward; clients that speak unknown versions are refused with a
// clear error, never silently misparsed. `parseEnvelope` is that refusal point - the DO and
// the web client both parse through it and nothing else.
//
// This envelope is also what the PWA version-skew policy hangs off
// (docs/decisions/2026-08-13-pwa.md): a service worker must never let a stale cached client
// talk an old protocol to a live room, so the WS hello carries `version` and a mismatch is
// refused here with a reload prompt on the client side.
//
// Field names are spelled out (`version`, `type`) rather than the `v`/`t` sketched in early
// research: the style rule is fully-spelled-out names, and envelope overhead per message is
// tens of bytes against 4 KB message caps - compactness never earns the abbreviation.
import { z } from "zod";
import { extensionBagSchema } from "../ext.ts";

// Bump only with a migration story. Version 1 covers everything up to the first public format.
export const protocolVersion = 1;

// looseObject, not strict: the envelope is the *base* of every message, so per-type payload
// fields must flow through parsing untouched. Strictness about payload shapes belongs to the
// per-type schemas (M1+), which extend this one.
export const envelopeSchema = z.looseObject({
  version: z.int().min(1),
  type: z.string().min(1),
  ext: extensionBagSchema.optional(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

export type EnvelopeParseResult =
  | { ok: true; envelope: Envelope }
  // "malformed" = not our shape at all; "unsupported-version" = our shape, a version we do not
  // speak. Split on purpose: the second gets a user-visible "please refresh" style error, the
  // first is a bug or an attacker and only gets logged.
  | { ok: false; reason: "malformed" | "unsupported-version"; detail: string };

// The single entry point for anything coming off the wire. Accepts the raw ws message
// (string or already-parsed unknown) and refuses unknown versions loudly.
export function parseEnvelope(raw: unknown): EnvelopeParseResult {
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "malformed", detail: "message is not valid JSON" };
    }
  }
  const parsed = envelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "malformed",
      detail: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  if (parsed.data.version !== protocolVersion) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `this server speaks protocol version ${protocolVersion}, message declared version ${parsed.data.version}`,
    };
  }
  return { ok: true, envelope: parsed.data };
}
