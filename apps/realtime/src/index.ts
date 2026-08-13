// Worker entry for the realtime surface. Deliberately tiny: validate the route, hand the
// request to the room's DO. Everything stateful lives in GameRoomDO.
//
// Route shape is the canonical vocabulary from docs/design/user-flows.md: clients connect to
// wss://<realtime-host>/room/<CODE>/ws. We route by hand with getServerByName instead of
// partyserver's routePartykitRequest because the latter imposes its /parties/<class>/<name>
// URL scheme, and the room URL is user-visible product surface (QR codes, join links).
import { limits } from "@jeopardy/protocol/limits";
import { getServerByName } from "partyserver";
import { GameRoomDO } from "./game-room-do.ts";

// DO classes must be named exports of the Worker entry module for the runtime to find them.
export { GameRoomDO };

// Uppercase alphanumerics only, exact length from the limits module - the same alphabet the
// join screen accepts. Anchored so a crafted path can never smuggle a weird DO name.
const roomPathPattern = new RegExp(`^/room/([A-Z0-9]{${limits.room.roomCodeLength}})/ws$`);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health probe for uptime checks and the dev loop's "is the realtime worker up" banner.
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "jeopardy-realtime" });
    }

    const match = roomPathPattern.exec(url.pathname);
    if (match !== null) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("expected a WebSocket upgrade", { status: 426 });
      }
      // match[1] is guaranteed by the regex, but noUncheckedIndexedAccess rightly wants proof.
      const roomCode = match[1] ?? "";
      const room = await getServerByName(env.GAME_ROOM, roomCode);
      return room.fetch(request);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
