// Tests run INSIDE workerd via @cloudflare/vitest-pool-workers, so the DO under test is the
// real runtime article: real hibernation API, real storage, real upgrade semantics. The
// plugin reads wrangler.jsonc, so bindings/migrations never drift between prod config and
// tests. (API note: since the vitest-4-compatible releases the integration is a plugin,
// `cloudflareTest`, not the old `defineWorkersConfig` from ".../config".)
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
