// The single-origin WebSocket door (docs/decisions/2026-08-13-single-origin-binding.md):
// every client - phones, displays, host consoles, bots - upgrades against
// wss://<web-origin>/room/<CODE>/ws and this route forwards the upgrade to the room's
// GameRoomDO through the cross-script binding. The DO's 101 response (carrying the
// socket) is returned UNTOUCHED: SvelteKit 3's endpoint path passes a handler's Response
// through as-is, and once the runtime sees the 101 the Worker drops out of the socket
// path entirely - frames flow client<->DO with no intermediary (and no duration billing).
//
// M3 week-1 risk verdict: the passthrough WORKS on the pinned kit/adapter - proven by
// scripts/prove-single-origin.mjs against the built worker under multi-config wrangler
// dev, and continuously by the Playwright end-to-end suite. The documented fallback (a
// thin custom entry ahead of the Kit handler) was NOT needed; the decision doc addendum
// records both.
import { normalizeRoomCode } from "#lib/realtime/room-url.ts";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected a WebSocket upgrade", { status: 426 });
  }
  const namespace = platform?.env.GAME_ROOM;
  if (namespace === undefined) {
    // vite dev cannot emulate the cross-script binding; use multi-config wrangler dev for
    // the single-origin loop, or dial the realtime Worker directly (docs/DEVELOPMENT.md).
    return new Response("realtime binding unavailable in this dev mode", { status: 503 });
  }
  let code: string;
  try {
    code = normalizeRoomCode(params["code"] ?? "");
  } catch {
    // Malformed code shape = no such room could ever exist; same friendly 404 family the
    // DO answers for well-formed-but-uncreated codes (as a refused frame post-upgrade).
    return new Response("no such room", { status: 404 });
  }
  const stub = namespace.get(namespace.idFromName(code));
  return stub.fetch(request);
};
