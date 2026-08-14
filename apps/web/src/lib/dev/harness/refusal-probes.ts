// The test area's refusal probes: the room's NO answers, each with an expectation written
// down in advance and a PASS/FAIL verdict against what actually came back.
//
// These live in their own panel (owner direction 2026-08-14) because they are not controls -
// they are assertions. "Connect to uncreated room" sitting next to "Create room" invited
// exactly the confusion the owner hit: a button whose success looks like a failure.
//
// Every expectation below is a contract stated somewhere else in the repo; this module is the
// browser-side restatement, and the workerd suite (apps/realtime/test/guardrails.test.ts,
// lifecycle.test.ts, passwords.test.ts) is the same set proven headlessly.
export type ProbeId =
  | "uncreated-room"
  | "wrong-password"
  | "stale-version"
  | "malformed-json"
  | "oversized-payload"
  | "rate-limit-burst";

export type ProbeDefinition = {
  id: ProbeId;
  label: string;
  /** What the room is supposed to answer, in the wire's own vocabulary. */
  expected: string;
  /** Why the answer matters - the contract being defended. */
  because: string;
  /** Needs a live room + open socket (the connection-level probes do not). */
  needsConnection: boolean;
};

export const refusalProbes: ProbeDefinition[] = [
  {
    id: "uncreated-room",
    label: "Connect to an uncreated room",
    expected: "refused: no-such-room (or close 4404)",
    because: "creation is explicit - connecting to a code must never create a room",
    needsConnection: false,
  },
  {
    id: "wrong-password",
    label: "Join with the wrong password",
    expected: "refused: bad-password, socket stays open",
    because: "a phone must be able to retype without a new handshake",
    needsConnection: true,
  },
  {
    id: "stale-version",
    label: "Send a future protocol version",
    expected: "error: unsupported-version",
    because: "a client from another deploy is told so, not silently ignored",
    needsConnection: true,
  },
  {
    id: "malformed-json",
    label: "Send malformed JSON",
    expected: "error: malformed",
    because: "garbage in never becomes room state",
    needsConnection: true,
  },
  {
    id: "oversized-payload",
    label: "Send an oversized payload",
    expected: "error: malformed (size limit)",
    because: "limits.wire.clientMessageMaxBytes is enforced before parsing",
    needsConnection: true,
  },
  {
    id: "rate-limit-burst",
    label: "Burst past the message rate cap",
    expected: "error: rate-limited",
    because: "a misbehaving phone is throttled, not disconnected",
    needsConnection: true,
  },
];

// What the harness saw: a parsed server frame reduced to the two fields that decide a
// verdict, or a socket close code when the room answered by hanging up.
export type ProbeObservation = {
  type?: string;
  reason?: string;
  closeCode?: number;
};

export type ProbeVerdict = "pass" | "fail";

export function judgeProbe(id: ProbeId, observed: ProbeObservation): ProbeVerdict {
  if (id === "uncreated-room") {
    // Close 4404 without a frame still proves the contract: the room refused to exist.
    return (observed.type === "refused" && observed.reason === "no-such-room") ||
      observed.closeCode === 4404
      ? "pass"
      : "fail";
  }
  if (id === "wrong-password") {
    // password-required counts: a room that asks before judging has still refused entry.
    return observed.type === "refused" &&
      (observed.reason === "bad-password" || observed.reason === "password-required")
      ? "pass"
      : "fail";
  }
  if (id === "stale-version") {
    return observed.type === "error" && observed.reason === "unsupported-version" ? "pass" : "fail";
  }
  if (id === "rate-limit-burst") {
    return observed.type === "error" && observed.reason === "rate-limited" ? "pass" : "fail";
  }
  // malformed-json and oversized-payload share the room's one answer for "I could not read
  // that": both are refused before anything is parsed into state.
  return observed.type === "error" && observed.reason === "malformed" ? "pass" : "fail";
}

/** Human summary of what came back, for the expected-vs-actual line next to the chip. */
export function describeObservation(observed: ProbeObservation): string {
  if (observed.type !== undefined) {
    return observed.reason === undefined ? observed.type : `${observed.type}: ${observed.reason}`;
  }
  if (observed.closeCode !== undefined) return `socket closed (${String(observed.closeCode)})`;
  return "nothing";
}
