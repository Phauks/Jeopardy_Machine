// Writes the generated settings reference to docs/reference/settings.md (see
// src/settings/docs-table.ts). Run from anywhere: pnpm -F @jeopardy/protocol generate:settings-docs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderSettingsMarkdown, settingsDocsRepoPath } from "../src/settings/docs-table.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const target = join(repoRoot, settingsDocsRepoPath);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, renderSettingsMarkdown());
console.log(`wrote ${target}`);
