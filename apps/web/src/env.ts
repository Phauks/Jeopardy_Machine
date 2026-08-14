// SvelteKit 3 environment-variable declarations (the old $env/static/* modules are gone -
// vars are declared here and imported from $app/env/public or $app/env/private). Every
// variable this app reads MUST be declared in this file; ad-hoc process.env reads are a bug.
//
// Deliberately EMPTY as of 2026-08-14. The app reads no environment variables at all: the
// last one, REALTIME_ORIGIN, was deleted with the harness's direct-dial mode (owner: the
// direct realtime origin is deprecated). Rooms are single-origin, period - every client
// upgrades against the page's own origin and the web Worker forwards to the DO over the
// cross-script binding (docs/decisions/2026-08-13-single-origin-binding.md). Configuration
// lives in wrangler.jsonc bindings, not in build-time strings that can point at localhost in
// production - which is the exact bug class that decision was written to end.
//
// The file stays as the declared seam: the next variable is declared here or nowhere.
import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({});
