// The test area's verdicts. These probes assert the room's guardrails from a browser, so the
// judging rules themselves deserve a test - a probe that passes on the wrong answer is worse
// than no probe at all.
import { describe, expect, it } from "vitest";
import { describeObservation, judgeProbe, refusalProbes } from "./refusal-probes.ts";

describe("judging a probe", () => {
  it("passes the uncreated-room probe on the refusal OR the 4404 close", () => {
    expect(judgeProbe("uncreated-room", { type: "refused", reason: "no-such-room" })).toBe("pass");
    expect(judgeProbe("uncreated-room", { closeCode: 4404 })).toBe("pass");
    // A welcome here would mean connecting CREATED a room - the contract's worst failure.
    expect(judgeProbe("uncreated-room", { type: "welcome" })).toBe("fail");
    expect(judgeProbe("uncreated-room", {})).toBe("fail");
  });

  it("passes the password probe on either refusal, since both deny entry", () => {
    expect(judgeProbe("wrong-password", { type: "refused", reason: "bad-password" })).toBe("pass");
    expect(judgeProbe("wrong-password", { type: "refused", reason: "password-required" })).toBe(
      "pass",
    );
    expect(judgeProbe("wrong-password", { type: "welcome" })).toBe("fail");
  });

  it("holds each wire error to its own reason", () => {
    expect(judgeProbe("stale-version", { type: "error", reason: "unsupported-version" })).toBe(
      "pass",
    );
    expect(judgeProbe("stale-version", { type: "error", reason: "malformed" })).toBe("fail");
    expect(judgeProbe("malformed-json", { type: "error", reason: "malformed" })).toBe("pass");
    expect(judgeProbe("oversized-payload", { type: "error", reason: "malformed" })).toBe("pass");
    expect(judgeProbe("rate-limit-burst", { type: "error", reason: "rate-limited" })).toBe("pass");
    // Silence is a failure: the room owes every refusal a frame.
    expect(judgeProbe("rate-limit-burst", {})).toBe("fail");
  });
});

describe("the probe catalog", () => {
  it("states an expectation and a reason for every probe", () => {
    expect(refusalProbes.length).toBeGreaterThanOrEqual(6);
    for (const probe of refusalProbes) {
      expect(probe.expected.length).toBeGreaterThan(0);
      expect(probe.because.length).toBeGreaterThan(0);
    }
  });

  it("describes what actually came back, including nothing at all", () => {
    expect(describeObservation({ type: "refused", reason: "no-such-room" })).toBe(
      "refused: no-such-room",
    );
    expect(describeObservation({ closeCode: 4404 })).toBe("socket closed (4404)");
    expect(describeObservation({})).toBe("nothing");
  });
});
