// Spawns the single-origin dev loop (both Workers, one process, cross-script DO binding
// live) for the e2e suite and tears it down after. The web build must exist - the
// test:e2e script chain runs it first - because wrangler serves the BUILT worker
// (.svelte-kit/cloudflare/_worker.js), which is exactly the artifact whose upgrade
// passthrough the suite proves.
// Polling readiness sequentially is the point of this file's loops.
/* oxlint-disable no-await-in-loop */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const e2eOrigin = process.env["E2E_ORIGIN"] ?? "http://localhost:8790";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const webDirectory = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.resolve(webDirectory, "../../..");
  const builtWorker = path.resolve(repoRoot, "apps/web/.svelte-kit/cloudflare/_worker.js");
  if (!existsSync(builtWorker)) {
    throw new Error(
      "no built web worker - run via `pnpm -F @jeopardy/web test:e2e` (it builds first)",
    );
  }
  const port = new URL(e2eOrigin).port || "8790";
  const child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "-c",
      "apps/web/wrangler.jsonc",
      "-c",
      "apps/realtime/wrangler.jsonc",
      "--port",
      port,
    ],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  // Ready when the health-ish route answers; wrangler needs a few seconds to boot workerd.
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const response = await fetch(`${e2eOrigin}/api/version`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(
        `wrangler dev never became ready on ${e2eOrigin}; output:\n${output.slice(-2000)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return async () => {
    // Negative pid = the whole detached process group (wrangler spawns workerd children).
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  };
}
