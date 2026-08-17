// GET /api/rooms/<CODE>/live - one boolean: does this code still name a room?
//
// The front door's rejoin offer is the only caller (docs/decisions/2026-08-16-persistent-
// layout-and-pregame-rework.md, "Rejoin memory"). A browser that was in a room remembers the
// code in sessionStorage and asks this before offering to walk back in, so a game that ended
// during the coffee break stops being advertised on the front page.
//
// Three deliberate properties:
//
// 1. NO host token, unlike its sibling GET /api/rooms/<CODE> (the diagnostics inspector). This
//    answers a question anyone holding the code can already answer by opening the socket and
//    being refused with `no-such-room` - so it adds no oracle, and it is one D1 read instead of
//    a WebSocket handshake. It says NOTHING else: no title, no phase, no counts, no listing.
//    A private room's facts stay private; only its existence is visible, exactly as before.
// 2. It reads the REGISTRY, which is a cache and never authority
//    (docs/decisions/2026-08-14-room-visibility-and-lobby.md). Drift is survivable in both
//    directions: a row that outlived its room costs one wasted tap and a refusal from the DO;
//    a room whose row never landed reports `registry: unavailable` and the caller treats that
//    as "unknown" rather than as "dead" (src/lib/lobby/room-liveness.ts).
// 3. Never cached. A rejoin offer for a room that ended thirty seconds ago is precisely the
//    thing this exists to prevent.
import { normalizeRoomCode } from "#lib/realtime/room-url.ts";
import {
  readRegistryRow,
  registryRowIsLive,
  registryStatusFromError,
} from "#lib/server/room-registry.ts";
import type { RoomLiveness } from "#lib/lobby/room-liveness.ts";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async ({ params, platform, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });

  let code: string;
  try {
    code = normalizeRoomCode(params["code"] ?? "");
  } catch {
    // A code that cannot exist is a settled answer, not an unknown one: the caller forgets it.
    return Response.json({ error: "bad-code" }, { status: 400 });
  }

  const database = platform?.env.DB;
  if (database === undefined) {
    // vite dev has no D1 binding at all, and cannot create rooms either. Saying so beats
    // reporting every remembered room as dead (docs/DEVELOPMENT.md, the single-origin loop).
    return Response.json({
      code,
      live: false,
      registry: { status: "unavailable", reason: "no-binding" },
    } satisfies RoomLiveness);
  }

  const now = Date.now();
  try {
    const row = await readRegistryRow(database, code, now);
    return Response.json({
      code,
      live: row !== null && registryRowIsLive(row, now),
      registry: { status: "ok" },
    } satisfies RoomLiveness);
  } catch (error) {
    console.warn("room liveness probe failed - answering unavailable", error);
    return Response.json({
      code,
      live: false,
      registry: registryStatusFromError(error),
    } satisfies RoomLiveness);
  }
};
