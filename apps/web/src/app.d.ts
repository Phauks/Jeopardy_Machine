// SvelteKit ambient types. App.Platform gains the Cloudflare env (D1/R2/DO bindings) once
// this Worker has any - see the commented bindings in wrangler.jsonc.
declare global {
  // Injected by vite `define` (see vite.config.ts) - commit SHA + build timestamp. The
  // dunder name is the vite convention for compile-time constants; lint's dangling-underscore
  // rule cannot know that.
  // oxlint-disable-next-line no-underscore-dangle
  const __BUILD_META__: { sha: string; builtAt: string };

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    interface Platform {
      env: {
        // Cross-script binding to the realtime Worker's GameRoomDO (wrangler.jsonc).
        // Typed structurally on purpose: pulling @cloudflare/workers-types' globals into a
        // DOM-lib SvelteKit app trades one line of shape for a world of lib conflicts.
        // The shape is the sliver of DurableObjectNamespace the routes actually use.
        GAME_ROOM: {
          idFromName(name: string): unknown;
          get(id: unknown): { fetch(request: Request): Promise<Response> };
        };
      };
    }
  }
}

// The empty export makes this file a module so `declare global` augments instead of
// polluting; the lint rule cannot know that, hence the targeted disable.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
