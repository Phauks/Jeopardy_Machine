import { describe, expect, it } from "vitest";
import { parseEnvelope, protocolVersion } from "./envelope.ts";

describe("parseEnvelope", () => {
  it("accepts a current-version envelope from a raw ws string", () => {
    const result = parseEnvelope(JSON.stringify({ version: protocolVersion, type: "hello" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.type).toBe("hello");
  });

  it("passes per-type payload fields through untouched (the envelope is a base, not a filter)", () => {
    const result = parseEnvelope({
      version: protocolVersion,
      type: "buzz",
      clueId: "c-12",
      seq: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope).toMatchObject({ clueId: "c-12", seq: 3 });
  });

  it("round-trips the ext bag untouched", () => {
    const ext = { "com.example.annotations": { anything: [1, 2, 3] } };
    const result = parseEnvelope({ version: protocolVersion, type: "hello", ext });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.ext).toEqual(ext);
  });

  it("rejects ext keys that are not reverse-domain strings", () => {
    const result = parseEnvelope({
      version: protocolVersion,
      type: "hello",
      ext: { notdotted: true },
    });
    expect(result).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("refuses unknown protocol versions with a clear, distinct error", () => {
    const result = parseEnvelope({ version: protocolVersion + 1, type: "hello" });
    expect(result).toMatchObject({ ok: false, reason: "unsupported-version" });
    if (!result.ok) expect(result.detail).toContain(String(protocolVersion));
  });

  it("classifies non-JSON and shapeless input as malformed, not as a version problem", () => {
    expect(parseEnvelope("not json{")).toMatchObject({ ok: false, reason: "malformed" });
    expect(parseEnvelope({ hello: "world" })).toMatchObject({ ok: false, reason: "malformed" });
  });
});
