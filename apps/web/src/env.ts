// SvelteKit 3 environment-variable declarations (the old $env/static/* modules are gone -
// vars are declared here and imported from $app/env/public or $app/env/private). Every
// variable this app reads MUST be declared in this file; ad-hoc process.env reads are a bug.
import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  REALTIME_ORIGIN: {
    // DEPRECATED since M3 (docs/decisions/2026-08-13-single-origin-binding.md): rooms
    // connect through the SAME origin (/room/<CODE>/ws forwarded over the DO binding), so
    // nothing player-facing reads this anymore. It survives only as the /dev/echo
    // harness's direct-worker escape hatch: vite dev cannot emulate the cross-script
    // binding, so the harness dials the realtime Worker directly there. Delete once the
    // harness retires (M4 surfaces make it redundant).
    public: true,
    static: true,
    // vite dev falls back to local wrangler; anywhere else "" = use the page origin.
    schema: (value) => value ?? (import.meta.env.DEV ? "http://localhost:8787" : ""),
    description:
      "dev-only direct origin of the realtime Worker for the /dev/echo harness; empty = same-origin (the M3 default)",
  },
});
