// The host's ops door onto one room (owner requests 2026-08-14: "allow for the ability to
// delete rooms" and "provide more information about the DO objects").
//
// GET    /api/rooms/<CODE>  - diagnostics: what the DO believes about itself right now, beside
//                             what the registry believes about it. Read-only, no secrets.
// PATCH  /api/rooms/<CODE>  - change the room's settings (listing, caps, spectators, streamer
//                             mode, password, title). The DO applies them, broadcasts
//                             room-settings to everyone connected, and re-projects the lobby
//                             row; this route answers with the settings AFTER the edit.
// DELETE /api/rooms/<CODE>  - close the room: everyone gets the polite screen, the lobby row
//                             is deleted, the code stays spent until the expiry alarm.
//
// BOTH require the host token (header, never a query string - see hostTokenHeader). The token
// is verified INSIDE the DO, which owns it; this route only carries it. That is deliberate:
// the web Worker forwarding a request must never be the thing that authorizes it, or every
// future internal caller inherits host powers by accident.
import { hostTokenHeader } from "@jeopardy/protocol/room/diagnostics";
import { updateRoomSettingsRequestSchema } from "@jeopardy/protocol/room/room-settings";
import { forgetRoom, readRegistryRow, registryStatusFromError } from "#lib/server/room-registry.ts";
import { normalizeRoomCode } from "#lib/realtime/room-url.ts";
import type { RegistryDatabase } from "#lib/server/room-registry.ts";
import type {
  CloseRoomResponse,
  RegistryRowState,
  RoomDiagnostics,
  RoomInspection,
  UpdateRoomSettingsResponse,
} from "@jeopardy/protocol/room/diagnostics";
import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";
import type { RegistryStatus } from "@jeopardy/protocol/room/registry";
import type { RequestHandler } from "@sveltejs/kit";

type RoomStub = { fetch(request: Request): Promise<Response> };

export const GET: RequestHandler = async ({ params, request, platform, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const target = resolveTarget(params["code"], request, platform);
  if ("response" in target) return target.response;

  const answer = await target.stub.fetch(
    new Request("https://game-room/diagnostics", {
      headers: { [hostTokenHeader]: target.hostToken },
    }),
  );
  if (!answer.ok) return relayRefusal(answer);
  const room = (await answer.json()) as RoomDiagnostics;
  const { row, registry } = await readRowSafely(platform?.env.DB, room.code);
  return Response.json({ room, registry, registryRow: row } satisfies RoomInspection);
};

export const PATCH: RequestHandler = async ({ params, request, platform }) => {
  const target = resolveTarget(params["code"], request, platform);
  if ("response" in target) return target.response;

  // Parsed HERE only to fail fast on a malformed body: the DO parses it again and is the one
  // that decides, because it is the only place that knows how many people are already in the
  // room (a cap cannot drop below them) and whether the room has a title to be listed under.
  const body = updateRoomSettingsRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad-request" }, { status: 400 });

  const answer = await target.stub.fetch(
    new Request("https://game-room/settings", {
      method: "POST",
      headers: { [hostTokenHeader]: target.hostToken, "content-type": "application/json" },
      body: JSON.stringify(body.data),
    }),
  );
  if (answer.status === 409) {
    // The DO refused the change itself (title-required / below-current). Relayed verbatim
    // because the reason IS the message a host has to act on.
    const refusal = (await answer.json().catch(() => null)) as { error?: string } | null;
    return Response.json({ error: refusal?.error ?? "rejected" }, { status: 409 });
  }
  if (!answer.ok) return relayRefusal(answer);
  const updated = (await answer.json()) as { code: string; settings: RoomSettings };
  // The lobby row's listing facts are the DO's write (registry-writer.ts relist), so this
  // route only reports what the row now says - which is what makes "you are public but NOT
  // listed because the migration is missing" sayable at the moment of the change too.
  const { registry } = await readRowSafely(platform?.env.DB, updated.code);
  return Response.json({
    code: updated.code,
    settings: updated.settings,
    registry,
  } satisfies UpdateRoomSettingsResponse);
};

export const DELETE: RequestHandler = async ({ params, request, platform }) => {
  const target = resolveTarget(params["code"], request, platform);
  if ("response" in target) return target.response;

  const answer = await target.stub.fetch(
    new Request("https://game-room/close", {
      method: "POST",
      headers: { [hostTokenHeader]: target.hostToken },
    }),
  );
  if (!answer.ok) return relayRefusal(answer);
  // The DO already marked its row ended (registry-writer.ts) - but the row is the WEB app's
  // table, and a host who just closed a room should see it leave the lobby whether or not the
  // DO's own write landed. Deleting rather than ending: the room is over, and a row for a
  // room nobody can rejoin is nothing but future drift.
  const registry = await deleteRowSafely(platform?.env.DB, target.code);
  return Response.json({ code: target.code, closed: true, registry } satisfies CloseRoomResponse);
};

// Shared preamble for both verbs: a well-formed code, a live binding, and a host token.
// Returns either the resolved target or the refusal to send back verbatim.
function resolveTarget(
  rawCode: string | undefined,
  request: Request,
  platform: App.Platform | undefined,
): { code: string; stub: RoomStub; hostToken: string } | { response: Response } {
  const namespace = platform?.env.GAME_ROOM;
  if (namespace === undefined) {
    // vite dev has no cross-script DO emulation (docs/DEVELOPMENT.md, the single-origin loop).
    return { response: Response.json({ error: "realtime-binding-unavailable" }, { status: 503 }) };
  }
  let code: string;
  try {
    code = normalizeRoomCode(rawCode ?? "");
  } catch {
    return { response: Response.json({ error: "no-such-room" }, { status: 404 }) };
  }
  const hostToken = request.headers.get(hostTokenHeader) ?? "";
  if (hostToken === "") {
    return { response: Response.json({ error: "host-token-required" }, { status: 401 }) };
  }
  return { code, stub: namespace.get(namespace.idFromName(code)), hostToken };
}

// The DO's refusals ARE this route's refusals: 403 bad token, 404 no such room. Rebuilt
// rather than streamed so nothing the DO adds later leaks out unreviewed.
async function relayRefusal(answer: Response): Promise<Response> {
  const body = (await answer.json().catch(() => null)) as { error?: string } | null;
  const error = body?.error === "bad-host-token" ? "bad-host-token" : "no-such-room";
  return Response.json({ error }, { status: answer.status === 403 ? 403 : 404 });
}

async function readRowSafely(
  database: RegistryDatabase | undefined,
  code: string,
): Promise<{ row: RegistryRowState | null; registry: RegistryStatus }> {
  if (database === undefined) {
    return { row: null, registry: { status: "unavailable", reason: "no-binding" } };
  }
  try {
    return { row: await readRegistryRow(database, code, Date.now()), registry: { status: "ok" } };
  } catch (error) {
    return { row: null, registry: registryStatusFromError(error) };
  }
}

async function deleteRowSafely(
  database: RegistryDatabase | undefined,
  code: string,
): Promise<RegistryStatus> {
  if (database === undefined) return { status: "unavailable", reason: "no-binding" };
  try {
    await forgetRoom(database, code);
    return { status: "ok" };
  } catch (error) {
    // The room IS closed - the DO said so. A failed row delete only means the lobby may show
    // a ghost until the sweep collects it, so it is reported, not raised.
    console.warn("registry row delete failed after closing a room", error);
    return registryStatusFromError(error);
  }
}
