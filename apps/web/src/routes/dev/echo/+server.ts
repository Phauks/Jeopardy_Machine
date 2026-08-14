// /dev/echo was the M0 echo page, then the M3 room harness, and is now the room instrument
// panel at /dev/rooms (renamed 2026-08-14 - "echo" had not described the page for two
// milestones). The old path is bookmarked in the owner's browser and cited in older docs, so
// it redirects instead of 404ing; the query string travels so the lobby hand-off link
// (/dev/echo?code=XXXXX) still lands on the right room.
//
// A +server.ts rather than a page with a load: there is nothing to render, and a route with
// only a GET handler is the cheapest possible signpost.
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = ({ url }) => {
  redirect(307, `/dev/rooms${url.search}`);
};
