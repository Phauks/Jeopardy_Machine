// Config for the Playwright end-to-end suite (e2e/*.e2e.ts): plain node vitest - no
// SvelteKit plugin, no workerd pool - because the system under test is the BUILT app
// running under multi-config wrangler dev (spawned by e2e/global-setup.ts). Not part of
// `pnpm test`/CI: it needs a local chromium and a free port (docs/DEVELOPMENT.md, "End to
// end"); run it via `pnpm -F @jeopardy/web test:e2e`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    globalSetup: ["e2e/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One file, sequential: everything shares the spawned dev server and one browser.
    fileParallelism: false,
  },
});
