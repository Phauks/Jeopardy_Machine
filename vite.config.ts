// Workspace-root Vite+ config: the single home for lint (Oxlint) and fmt (Oxfmt) settings,
// pinned explicitly here rather than left to tool defaults so a toolchain upgrade cannot
// silently reformat the repo. Per-package build/test config lives in each package's own
// vite.config.ts / vitest.config.ts; this file deliberately contains no build config.
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 100,
    // Prose is authored one-line-per-paragraph and never machine-rewrapped; diffs stay
    // per-paragraph and the formatter never fights a doc edit.
    proseWrap: "preserve",
    endOfLine: "lf",
    ignorePatterns: [
      // Generated artifacts are never formatted - if formatting would change them, that is
      // drift in the generator, not noise to clean.
      "**/.svelte-kit/**",
      "**/worker-configuration.d.ts",
      "**/dist/**",
      "pnpm-lock.yaml",
      // Generated from the settings registry (packages/protocol/src/settings/docs-table.ts);
      // the gate test diffs it byte-for-byte, so the formatter must never touch it.
      "docs/reference/settings.md",
    ],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc"],
    categories: {
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      // Import the specific module; curated package.json exports maps are the only
      // cross-package surface. Barrel files hide dependency edges and defeat tree-shaking.
      "oxc/no-barrel-file": "error",
    },
    ignorePatterns: ["**/.svelte-kit/**", "**/worker-configuration.d.ts", "**/dist/**"],
  },
});
