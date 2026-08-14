// Turning the wire's registry status into words a human can act on.
//
// This exists because of a real failure (owner, 2026-08-14): a public room was created, never
// appeared in the lobby, and every surface showed the same thing an ordinary quiet night
// shows - nothing. The registry was answering "no such table: rooms" the whole time, into a
// console nobody was reading. So the rule now is: an empty list must always be able to say
// why it is empty, and when the cause is fixable, name the fix verbatim.
//
// Pure and string-only so it renders identically on the lobby, in the harness, and in any
// later host console - and so the wording is testable without a DOM.
import type { RegistryStatus } from "@jeopardy/protocol/room/registry";

export type RegistryNotice = {
  // `ok` is the only tone a player-facing surface should render quietly; the rest are for
  // the person running the deployment, and are worth looking wrong.
  tone: "ok" | "warning";
  headline: string;
  hint: string;
  // The exact command that fixes it, when one exists. Owner-run, never automated
  // (docs/cloudflare-setup.md 2a; CLAUDE.md forbids agent deploys and migrations).
  fix: string | null;
  // The raw D1 message, when the server sent one. Diagnostic tail, not a headline.
  detail: string | null;
};

export function describeRegistryStatus(status: RegistryStatus): RegistryNotice {
  if (status.status === "ok") {
    return {
      tone: "ok",
      headline: "Room registry online",
      hint: "Public rooms appear here within one refresh of being created.",
      fix: null,
      detail: null,
    };
  }
  const detail = status.detail ?? null;
  if (status.reason === "no-binding") {
    return {
      tone: "warning",
      headline: "No database binding",
      hint: "This server has no D1 binding, so rooms can be neither created nor listed. Rooms need the single-origin wrangler loop (docs/DEVELOPMENT.md); vite dev cannot serve them at all.",
      fix: null,
      detail,
    };
  }
  if (status.reason === "no-table") {
    return {
      tone: "warning",
      headline: "Registry table missing - the migration has not been applied here",
      hint: "Rooms are still being created and joined by code; they simply cannot be listed. Applying the migration switches the lobby on with no redeploy.",
      fix: "npx wrangler d1 migrations apply jeopardy-machine --remote -c apps/web/wrangler.jsonc",
      detail,
    };
  }
  return {
    tone: "warning",
    headline: "Registry unavailable",
    hint: "D1 answered with an error. Rooms still work by code; the lobby listing does not.",
    fix: null,
    detail,
  };
}

/** One-line form for logs and dense panels: "registry: ok" / "registry: no-table (...)". */
export function summarizeRegistryStatus(status: RegistryStatus): string {
  if (status.status === "ok") return "registry: ok";
  const detail = status.detail === undefined ? "" : ` - ${status.detail}`;
  return `registry: ${status.reason}${detail}`;
}
