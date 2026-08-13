// SvelteKit 3 configuration lives HERE, not in svelte.config.js - SK3 dropped that file
// entirely (the sveltekit() plugin takes the config object). Recorded in
// docs/decisions/2026-08-13-m0-version-pins.md because every SK2 tutorial says otherwise.
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
// vitest/config, not vite: it widens the config type with the `test` block.
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Explicit root: tools other than vite itself (oxlint via `vp lint` at the workspace root)
  // evaluate this config from their own cwd, and SvelteKit's sync step resolves src/app.html
  // against root - without this line, root-level `vp lint` explodes. URL form rather than
  // import.meta.dirname because the app's tsconfig has no Node types (it targets workerd).
  root: new URL(".", import.meta.url).pathname,
  plugins: [
    tailwindcss(),
    sveltekit({
      // The adapter builds a Workers-with-Static-Assets deployment (see wrangler.jsonc):
      // static asset requests are served free without invoking the Worker; SSR/API run in it.
      adapter: adapter(),
      preprocess: vitePreprocess(),
      compilerOptions: {
        // Runes-only codebase: legacy reactive syntax is a compile error, not a choice.
        runes: true,
      },
    }),
  ],
  test: {
    // Plain node-environment unit tests for pure browser-agnostic logic. Component testing
    // (browser mode) arrives when there are real components to test (M4 surfaces).
    include: ["src/**/*.test.ts"],
  },
});
