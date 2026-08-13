// The synthetic proof-of-machinery migration (M1 exit criteria: a format-version bump must be
// survivable, so the chain runs against a committed fixture pair from day one, before any real
// format ever bumps). The "example" format is registered only in tests - never in the real
// document registry, never in the public API - so no real file can carry it.
//
// Note the version numbers: a field rename in a REAL format is a major bump by the semver
// rules in envelope/document.ts. The example keeps 1.0 -> 1.1 so the fixture filenames read as
// the smallest possible step; the machinery treats every registered step identically either way.
import type { Migration } from "../../envelope/migration.ts";

export const exampleRenameMigration: Migration = {
  format: "example",
  from: "1.0",
  to: "1.1",
  migrate: (body) => {
    // 1.0 shape: { message: string }. 1.1 shape: { greeting: string, excited: boolean }.
    const { message, ...rest } = body as { message: string };
    return { ...rest, greeting: message, excited: false };
  },
};
