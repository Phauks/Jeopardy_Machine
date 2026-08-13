// Wires the wrangler-generated Env into the cloudflare:test module so tests get typed
// access to bindings. Standard vitest-pool-workers boilerplate.
declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
