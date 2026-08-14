// Creates the room-registry table in the local simulated D1 before every test file, from the
// WEB app's migrations (apps/web/migrations - the canonical schema; vitest.config.ts reads
// them in node and hands them over as a binding). Without this, registry writes would fail
// exactly the way an unapplied production migration does: silently, into a warning.
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);
