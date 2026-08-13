// SvelteKit 3 environment-variable declarations (the old $env/static/* modules are gone -
// vars are declared here and imported from $app/env/public or $app/env/private). Every
// variable this app reads MUST be declared in this file; ad-hoc process.env reads are a bug.
import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  REALTIME_ORIGIN: {
    // Public + static: inlined into the client bundle at build time. This is where the
    // browser reaches the realtime Worker - local wrangler dev by default, the deployed
    // rt host in a production build (set in .env or the build environment).
    public: true,
    static: true,
    schema: (value) => value ?? "http://localhost:8787",
    description:
      "http(s) origin of the realtime Worker (WebSockets ride the matching ws(s) scheme)",
  },
});
