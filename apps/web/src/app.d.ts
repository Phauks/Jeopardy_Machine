// SvelteKit ambient types. App.Platform carries this Worker's Cloudflare bindings.
import type { RegistryDatabase } from "#lib/server/room-registry.ts";

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
        // D1, the room registry's home (migrations/0001_create_rooms.sql). Optional because
        // vite dev has no bindings at all and because a deploy whose migration has not been
        // applied must degrade to "no lobby", never to a 500 - the routes handle both. The
        // shape is the structurally-typed sliver the repository uses, for the same
        // lib-conflict reason as GAME_ROOM above.
        DB?: RegistryDatabase;
      };
    }
  }
}

// The empty export makes this file a module so `declare global` augments instead of
// polluting; the lint rule cannot know that, hence the targeted disable.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
