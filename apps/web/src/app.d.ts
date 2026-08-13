// SvelteKit ambient types. App.Platform gains the Cloudflare env (D1/R2/DO bindings) once
// this Worker has any - see the commented bindings in wrangler.jsonc.
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

// The empty export makes this file a module so `declare global` augments instead of
// polluting; the lint rule cannot know that, hence the targeted disable.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
