// The log column's model: filtering and body rendering, which are the two things that decide
// whether a protocol trace is readable (owner direction 2026-08-14 - the log moved to its own
// full-height column and gained both controls).
import { describe, expect, it } from "vitest";
import {
  appendLogEntry,
  compactBodyLength,
  filterLog,
  formatLogLine,
  logLimit,
  logToText,
  renderBody,
  stampNow,
} from "./harness-log.ts";
import type { LogEntry } from "./harness-log.ts";

const entries: LogEntry[] = [
  { at: "12:00:00.000", dir: "out", text: "join host" },
  { at: "12:00:00.100", dir: "in", text: "welcome" },
  { at: "12:00:00.200", dir: "err", text: "socket error" },
  { at: "12:00:00.300", dir: "info", text: "rtt 4ms" },
];

describe("filtering", () => {
  it("splits the conversation by direction", () => {
    expect(filterLog(entries, "all")).toHaveLength(4);
    expect(filterLog(entries, "sent").map((entry) => entry.text)).toEqual(["join host"]);
    expect(filterLog(entries, "received").map((entry) => entry.text)).toEqual(["welcome"]);
    expect(filterLog(entries, "errors").map((entry) => entry.text)).toEqual(["socket error"]);
  });
});

describe("compact vs verbose bodies", () => {
  it("keeps short bodies whole in both modes", () => {
    expect(renderBody("welcome", true)).toBe("welcome");
    expect(renderBody("welcome", false)).toBe("welcome");
  });

  it("elides long bodies in compact mode AND says how long they were", () => {
    const snapshot = "x".repeat(1000);
    const compact = renderBody(snapshot, true);
    expect(compact.startsWith("x".repeat(compactBodyLength))).toBe(true);
    // The size is the point: a truncated frame with no length is useless when debugging a
    // size limit.
    expect(compact).toContain("(1000 chars)");
    expect(renderBody(snapshot, false)).toHaveLength(1000);
  });

  it("marks direction with an arrow the eye can scan", () => {
    expect(formatLogLine(entries[0] as LogEntry, true)).toBe("12:00:00.000 -> join host");
    expect(formatLogLine(entries[1] as LogEntry, true)).toBe("12:00:00.100 <- welcome");
    expect(formatLogLine(entries[2] as LogEntry, true)).toBe("12:00:00.200 !! socket error");
  });
});

describe("appending", () => {
  it("caps the log, dropping the oldest entries", () => {
    let log: LogEntry[] = [];
    for (let index = 0; index < logLimit + 20; index += 1) {
      log = appendLogEntry(log, { at: stampNow(), dir: "info", text: String(index) });
    }
    expect(log).toHaveLength(logLimit);
    expect(log[log.length - 1]?.text).toBe(String(logLimit + 19));
  });

  it("stamps time of day to the millisecond", () => {
    expect(stampNow(new Date("2026-08-14T12:34:56.789Z"))).toBe("12:34:56.789");
  });
});

describe("copying", () => {
  it("always copies VERBOSE bodies - a pasted trace is evidence", () => {
    const long = { at: "12:00:00.000", dir: "in" as const, text: "y".repeat(400) };
    expect(logToText([long])).toContain("y".repeat(400));
  });
});
