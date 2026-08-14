// The harness's activity log as a data structure, so the panel around it is just rendering.
//
// Owner direction 2026-08-14: the log moves to its own full-height column and gains a filter
// (all / sent / received / errors) plus a compact-vs-verbose switch for message bodies. Both
// exist for the same reason - a room snapshot is hundreds of characters of JSON, and reading
// a protocol conversation means seeing the shape of the traffic first and the bodies second.
export type LogDirection = "out" | "in" | "info" | "err";

export type LogEntry = {
  /** Wall-clock time of day, ms precision - the only clock a protocol trace needs. */
  at: string;
  dir: LogDirection;
  text: string;
};

export type LogFilter = "all" | "sent" | "received" | "errors";

// Deep enough to hold a full game's traffic, bounded so a rate-limit burst probe cannot pin
// the tab. Older entries fall off the top.
export const logLimit = 500;

// How much of a body compact mode shows before eliding. One line on a laptop column.
export const compactBodyLength = 120;

export const directionMark: Record<LogDirection, string> = {
  out: "->",
  in: "<-",
  err: "!!",
  info: "--",
};

export function stampNow(now: Date = new Date()): string {
  return now.toISOString().slice(11, 23);
}

export function appendLogEntry(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  return [...entries.slice(-(logLimit - 1)), entry];
}

export function filterLog(entries: LogEntry[], filter: LogFilter): LogEntry[] {
  if (filter === "all") return entries;
  if (filter === "sent") return entries.filter((entry) => entry.dir === "out");
  if (filter === "received") return entries.filter((entry) => entry.dir === "in");
  return entries.filter((entry) => entry.dir === "err");
}

/**
 * The body as rendered. Compact elides long payloads AND says how long they were - a truncated
 * frame with no size is worse than useless when the thing being debugged is a size limit.
 */
export function renderBody(text: string, compact: boolean): string {
  if (!compact || text.length <= compactBodyLength) return text;
  return `${text.slice(0, compactBodyLength)}... (${String(text.length)} chars)`;
}

export function formatLogLine(entry: LogEntry, compact: boolean): string {
  return `${entry.at} ${directionMark[entry.dir]} ${renderBody(entry.text, compact)}`;
}

/** What the Copy button puts on the clipboard: always VERBOSE - a pasted trace is evidence. */
export function logToText(entries: LogEntry[]): string {
  return entries.map((entry) => `${entry.at} ${entry.dir.padEnd(4)} ${entry.text}`).join("\n");
}
