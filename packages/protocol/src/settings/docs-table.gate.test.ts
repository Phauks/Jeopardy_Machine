// Invariant gate: the checked-in settings reference (docs/reference/settings.md) must be
// byte-identical to what the registry generates right now - docs cannot drift from code
// (resolution R2 derivation d). On failure: pnpm -F @jeopardy/protocol generate:settings-docs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderSettingsMarkdown, settingsDocsRepoPath } from "./docs-table.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

describe("generated settings docs gate", () => {
  it("docs/reference/settings.md is current (regenerate with pnpm -F @jeopardy/protocol generate:settings-docs)", () => {
    const committed = readFileSync(join(repoRoot, settingsDocsRepoPath), "utf8");
    expect(committed).toBe(renderSettingsMarkdown());
  });

  it("the generated table mentions every setting key exactly once", () => {
    const markdown = renderSettingsMarkdown();
    for (const key of ["armMode", "lateJoinScore", "clueTextOnPhones", "roundTwoValueMultiplier"]) {
      const occurrences = markdown.split(`\`${key}\``).length - 1;
      expect(occurrences, key).toBe(1);
    }
  });
});
