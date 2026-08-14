// POST /api/rooms - the "Host this game" server action (user-flows C1): allocate a
// server-side room code, initialize the GameRoomDO through the cross-script binding, and
// hand back code + host token. Creation is EXPLICIT - this route is the only way a room
// comes to exist; connecting to a code never creates one
// (docs/decisions/2026-08-13-single-origin-binding.md, room lifecycle).
import { createRoomRequestSchema, generateRoomCode } from "@jeopardy/protocol/room/create";
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

  // Sequential on purpose: each retry needs the previous draw's 409 verdict before
  // spending another code.
  // oxlint-disable no-await-in-loop
  for (let attempt = 0; attempt < allocationAttempts; attempt += 1) {
    const code = generateRoomCode();
    const stub = namespace.get(namespace.idFromName(code));
    const response = await stub.fetch(
      new Request("https://game-room/initialize", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      }),
    );
    if (response.status === 201) {
      const body = (await response.json()) as { hostToken: string; expiresAt: number };
      return Response.json(
        { code, hostToken: body.hostToken, expiresAt: body.expiresAt },
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
