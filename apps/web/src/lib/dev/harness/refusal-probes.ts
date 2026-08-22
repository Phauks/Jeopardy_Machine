// The test area's refusal probes: the room's NO answers, each with an expectation written
// down in advance and a PASS/FAIL verdict against what actually came back.
//
// These live in their own panel (owner direction 2026-08-14) because they are not controls -
// they are assertions. "Connect to uncreated room" sitting next to "Create room" invited
// exactly the confusion the owner hit: a button whose success looks like a failure.
//
// Every expectation below is a contract stated somewhere else in the repo; this module is the
// browser-side restatement, and the workerd suite (apps/realtime/test/guardrails.test.ts,
// lifecycle.test.ts, room-settings.test.ts) is the same set proven headlessly.
export type ProbeId =
  | "uncreated-room"
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

// ---- running the whole set (the Run all button) ---------------------------------------------
//
// "Run all" is the button the owner asked for, and it needs two pure decisions the panel can
// be tested without a browser for: which probes CAN run right now, and what the summary line
// says afterwards. Both live here so the panel is wiring rather than logic.

/** What the harness is in the middle of when Run all is pressed. */
export type ProbeContext = {
  socketOpen: boolean;
  /** The role this tab joined as, or null when the socket is open but unjoined. */
  joinedRole: string | null;
};

/**
 * Why a probe cannot run right now, or null when it can. A skip is not a failure: a suite that
 * reported FAIL for "the socket is not open" would train its reader to ignore red.
 */
export function probeBlocker(id: ProbeId, context: ProbeContext): string | null {
  const definition = refusalProbes.find((probe) => probe.id === id);
  if (definition === undefined) return "unknown probe";
  if (definition.needsConnection && !context.socketOpen) return "needs an open socket";
  if (id === "rate-limit-burst") {
    if (context.joinedRole === null) return "needs a joined connection";
    // The host is exempt from the message-rate cap by design (it authenticated with the
    // creation token and legitimately bursts), so running this as host would assert a
    // guardrail that deliberately does not exist.
    if (context.joinedRole === "host") return "the host is exempt from the rate cap by design";
  }
  return null;
}

export type ProbeRunOutcome = { id: ProbeId; verdict: ProbeVerdict | "skip" };

/** The summary line under Run all: what passed, what failed, what never ran and why not. */
export function summarizeProbeRun(outcomes: ProbeRunOutcome[]): string {
  const passed = outcomes.filter((outcome) => outcome.verdict === "pass").length;
  const failed = outcomes.filter((outcome) => outcome.verdict === "fail").length;
  const skipped = outcomes.filter((outcome) => outcome.verdict === "skip").length;
  const parts = [`${String(passed)} passed`, `${String(failed)} failed`];
  if (skipped > 0) parts.push(`${String(skipped)} skipped`);
  return `${parts.join(" / ")} of ${String(outcomes.length)} probes`;
}

/** Human summary of what came back, for the expected-vs-actual line next to the chip. */
export function describeObservation(observed: ProbeObservation): string {
  if (observed.type !== undefined) {
    return observed.reason === undefined ? observed.type : `${observed.type}: ${observed.reason}`;
  }
  if (observed.closeCode !== undefined) return `socket closed (${String(observed.closeCode)})`;
  return "nothing";
}
