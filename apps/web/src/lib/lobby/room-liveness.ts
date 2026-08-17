// "Is that room still there?" - the cheapest honest answer, and how a client reads it.
//
// The front door's rejoin offer needs it (docs/decisions/2026-08-16-persistent-layout-and-
// pregame-rework.md, "Rejoin memory"): this browser remembers a room it was in, and the page
// must not offer to walk someone back into a room that ended an hour ago. The public lobby
// listing answers this for PUBLIC rooms only, and most rooms are private by default - hence a
// probe that works from the code alone.
//
// The answer is a REGISTRY read, and the registry is a cache, never authority
// (docs/decisions/2026-08-14-room-visibility-and-lobby.md): the DO refuses a dead room on
// connect no matter what any row claims. That is exactly why a cache read is enough here - the
// probe only decides whether to OFFER the trip, never whether the trip succeeds.
//
// This type lives in the web app rather than in @jeopardy/protocol on purpose: the endpoint is
// the web Worker reading its own D1 table, no DO and no wire protocol involved. It moves to
// the protocol package the day the room itself answers the question.
import type { RegistryStatus } from "@jeopardy/protocol/room/registry";

/** Body of GET /api/rooms/<CODE>/live. Deliberately says nothing else about the room: it is
 * reachable with a code alone, so it must never become a browsable description of a private
 * room - the lock is that it answers one boolean. */
export type RoomLiveness = {
  code: string;
  live: boolean;
  /** Whether the registry could answer at all - `unavailable` makes `live: false` meaningless. */
  registry: RegistryStatus;
};

/**
 * Three answers, not two. "Unknown" is the one that matters: a deployment with no D1 binding
 * (vite dev) or an unapplied migration cannot tell a live room from a dead one, and treating
 * that as "dead" would silently delete a rejoin offer for a room that is sitting right there.
 * Unknown keeps the offer and lets the room itself refuse.
 */
export type RejoinVerdict = "live" | "gone" | "unknown";

export function verdictFor(liveness: RoomLiveness): RejoinVerdict {
  if (liveness.registry.status !== "ok") return "unknown";
  return liveness.live ? "live" : "gone";
}

/**
 * Non-200 answers. A malformed code can never name a room, so it is settled (`gone` - the
 * entry is junk and cleans itself up). Everything else - a 500, a Worker restart, an offline
 * phone - is unknown, because a transient failure must not throw away a live room.
 */
export function verdictForStatus(httpStatus: number): RejoinVerdict {
  return httpStatus === 400 || httpStatus === 404 ? "gone" : "unknown";
}

/** The probe itself. `fetchImpl` is injected so the front door's polling is testable. */
export async function probeRoomLiveness(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RejoinVerdict> {
  try {
    const response = await fetchImpl(`/api/rooms/${encodeURIComponent(code)}/live`);
    if (!response.ok) return verdictForStatus(response.status);
    return verdictFor((await response.json()) as RoomLiveness);
  } catch {
    // Offline, DNS, a Worker cold start that timed out: unknown, never a deletion.
    return "unknown";
  }
}
