// Deployment identity endpoint: `curl <origin>/api/version` answers "what exactly is
// deployed right now" (owner request). Build metadata is baked at build time via vite
// `define`; the wire protocol version ties the deploy to the WS compatibility story.
//
// It also answers "and does this deployment actually work": the two bindings rooms depend on
// report their state here (2026-08-14). An owner debugging an empty lobby should not have to
// create a room to discover that the D1 migration was never applied - one curl says so.
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { probeRegistry } from "#lib/server/room-registry.ts";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async ({ platform, setHeaders }) => {
  // Never cached: this is the endpoint people curl to check whether a fix landed.
  setHeaders({ "cache-control": "no-store" });
  return json({
    name: "jeopardy-machine-web",
    sha: __BUILD_META__.sha,
    builtAt: __BUILD_META__.builtAt,
    protocolVersion,
    // The cross-script DO binding: absent under vite dev, which is why rooms cannot be
    // created there at all (docs/DEVELOPMENT.md, the single-origin loop).
    realtimeBinding: platform?.env.GAME_ROOM === undefined ? "unavailable" : "bound",
    // ok = the lobby lists; no-binding/no-table/error = it cannot, and this says why.
    registry: await probeRegistry(platform?.env.DB),
  });
};
