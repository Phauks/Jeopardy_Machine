// POST /api/rooms - the "Host this game" server action (user-flows C1): allocate a
// server-side room code, initialize the GameRoomDO through the cross-script binding, and
// hand back code + host token. Creation is EXPLICIT - this route is the only way a room
// comes to exist; connecting to a code never creates one
// (docs/decisions/2026-08-13-single-origin-binding.md, room lifecycle).
//
// GET /api/rooms - the public lobby listing (docs/decisions/2026-08-14-room-visibility-and-
// lobby.md): live PUBLIC rooms from the D1 registry, newest first, capped and briefly cached.
// It is a browse surface, not a live room - clients poll it, nothing pushes.
import { limits } from "@jeopardy/protocol/limits";
import { createRoomRequestSchema, generateRoomCode } from "@jeopardy/protocol/room/create";
import { listPublicRooms, registerRoom, sweepExpiredRooms } from "#lib/server/room-registry.ts";
import type { RegistryDatabase } from "#lib/server/room-registry.ts";
import type { LobbyListing } from "@jeopardy/protocol/room/registry";
import type { RequestHandler } from "@sveltejs/kit";

// Collision policy: codes are random over ~24M values and rooms expire within hours, so a
// collision means the code names a LIVE room (DO answers 409) - draw again. Five draws
// failing is a cosmic-ray scenario; answer 503 and let the host tap the button again.
const allocationAttempts = 5;

export const POST: RequestHandler = async ({ request, platform }) => {
  const namespace = platform?.env.GAME_ROOM;
  if (namespace === undefined) {
    // vite dev has no cross-script DO emulation; the single-origin loop runs under
    // multi-config wrangler dev (docs/DEVELOPMENT.md).
    return Response.json({ error: "realtime-binding-unavailable" }, { status: 503 });
  }
  const parsed = createRoomRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }
  const body = parsed.data;

  // Sequential on purpose: each retry needs the previous draw's 409 verdict before
  // spending another code.
  // oxlint-disable no-await-in-loop
  for (let attempt = 0; attempt < allocationAttempts; attempt += 1) {
    const code = generateRoomCode();
    const stub = namespace.get(namespace.idFromName(code));
    const response = await stub.fetch(
      new Request("https://game-room/initialize", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    if (response.status === 201) {
      const initialized = (await response.json()) as { hostToken: string; expiresAt: number };
      // The registry write is deliberately AFTER the room exists and deliberately
      // best-effort: a D1 hiccup may cost the room its lobby row, never its existence. The
      // DO re-reports itself on its next transition, so drift heals on its own.
      await recordInRegistry(platform?.env.DB, {
        code,
        title: body.title ?? "",
        hostLabel: body.hostLabel ?? "",
        visibility: body.visibility,
        hasPassword: body.password !== undefined,
        createdAt: Date.now(),
        expiresAt: initialized.expiresAt,
      });
      return Response.json(
        {
          code,
          hostToken: initialized.hostToken,
          expiresAt: initialized.expiresAt,
          visibility: body.visibility,
          hasPassword: body.password !== undefined,
        },
        { status: 201 },
      );
    }
    if (response.status !== 409) {
      return Response.json({ error: "initialize-failed" }, { status: 502 });
    }
    // 409: the code names a live room - loop for a fresh draw.
  }
  return Response.json({ error: "no-code-available" }, { status: 503 });
};

export const GET: RequestHandler = async ({ platform, setHeaders }) => {
  const now = Date.now();
  const database = platform?.env.DB;
  // No binding (vite dev) or no table yet (registry migration unapplied) = an empty lobby,
  // not an error: rooms still work, they simply cannot be browsed. The runbook's migration
  // step is what turns listing on (docs/cloudflare-setup.md).
  const rooms = database === undefined ? [] : await listRoomsSafely(database, now);
  // Brief shared cache: a lobby full of phones polling every listingRefreshMs costs one D1
  // read per interval, not one per viewer.
  setHeaders({
    "cache-control": `public, max-age=${String(limits.lobby.listingCacheSeconds)}`,
  });
  return Response.json({ rooms, fetchedAt: now } satisfies LobbyListing);
};

async function recordInRegistry(
  database: RegistryDatabase | undefined,
  registration: Parameters<typeof registerRoom>[1],
): Promise<void> {
  if (database === undefined) return;
  try {
    await registerRoom(database, registration);
    // Reconcile on the rare path rather than the hot one: creation happens once per game,
    // the lobby query happens constantly. Rows past their expiry deadline can never be
    // valid, so deleting them needs no coordination with any DO.
    await sweepExpiredRooms(database, Date.now());
  } catch (error) {
    console.warn("room registry write failed - the room exists but may not be listed", error);
  }
}

async function listRoomsSafely(
  database: RegistryDatabase,
  now: number,
): Promise<LobbyListing["rooms"]> {
  try {
    return await listPublicRooms(database, now);
  } catch (error) {
    console.warn("room registry read failed - answering an empty lobby", error);
    return [];
  }
}
