// Tests run INSIDE workerd via @cloudflare/vitest-pool-workers, so the DO under test is the
// real runtime article: real hibernation API, real storage, real upgrade semantics. The
// plugin reads wrangler.jsonc, so bindings/migrations never drift between prod config and
// tests. (API note: since the vitest-4-compatible releases the integration is a plugin,
// `cloudflareTest`, not the old `defineWorkersConfig` from ".../config".)
//
// D1: the room registry's schema is owned by the WEB app (apps/web/migrations) because the
// web Worker owns the table; this suite reads those migration files and applies them to the
// local simulated D1 before each test file (test/apply-migrations.ts). That is deliberate -
// it makes apps/realtime's registry writer fail here the moment a column drifts, instead of
// failing silently in production (docs/decisions/2026-08-14-room-visibility-and-lobby.md).
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const registryMigrations = await readD1Migrations(
  new URL("../web/migrations", import.meta.url).pathname,
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_D1_MIGRATIONS: registryMigrations } },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
