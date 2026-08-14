// Test-only binding types. The pool's `env` is typed as `Cloudflare.Env` (the namespace
// wrangler generates into worker-configuration.d.ts), so a binding that exists only under
// test is declared by augmenting that namespace - the older `ProvidedEnv` interface is kept
// because the vitest-pool-workers docs still reference it.
//
// TEST_D1_MIGRATIONS carries the WEB app's room-registry migrations (read in node by
// vitest.config.ts, applied in test/apply-migrations.ts) so this suite runs the DO's registry
// statements against the real schema.
declare namespace Cloudflare {
  interface Env {
    TEST_D1_MIGRATIONS: { name: string; queries: string[] }[];
  }
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Cloudflare.Env {}
}
