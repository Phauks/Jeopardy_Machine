// Deployment identity endpoint: `curl <origin>/api/version` answers "what exactly is
// deployed right now" (owner request). Build metadata is baked at build time via vite
// `define`; the wire protocol version ties the deploy to the WS compatibility story.
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { json } from "@sveltejs/kit";

export function GET() {
  return json({
    name: "jeopardy-machine-web",
    sha: __BUILD_META__.sha,
    builtAt: __BUILD_META__.builtAt,
    protocolVersion,
  });
}
