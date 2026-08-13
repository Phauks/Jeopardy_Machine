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
    // Dev falls back to local wrangler; a production build with the var unset gets "" so
    // the UI can refuse to connect instead of dialing localhost from a public origin -
    // that misdial is what triggers Chrome's Local Network Access permission popup.
    schema: (value) => value ?? (import.meta.env.DEV ? "http://localhost:8787" : ""),
    description:
      "http(s) origin of the realtime Worker (WebSockets ride the matching ws(s) scheme)",
  },
});
