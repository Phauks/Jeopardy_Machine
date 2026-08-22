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
import type { RememberedRoom } from "#lib/lobby/room-memory.ts";

/** Body of GET /api/rooms/<CODE>/live. Deliberately says nothing else about the room: it is
 * reachable with a code alone, so it must never become a browsable description of a private
 * room - the lock is that it answers one boolean. */
export type RoomLiveness = {
  code: string;
  live: boolean;
  /** Whether the registry could answer at all - `unavailable` makes `live: false` meaningless. */
  registry: RegistryStatus;
  /**
   * When the room's code stops working, Unix ms - or null when nothing can say (no binding, an
   * unapplied migration, a room with no row).
   *
   * Added 2026-08-20 so the rejoin chip can count DOWN rather than assert "still live" (owner).
   * It is one more fact than this endpoint used to give, and it stays inside the rule the
   * endpoint was built on: it is answerable by anyone already holding the code, tells nothing
   * about who is in the room or what it is called, and expires along with the room itself. A
   * deadline is also strictly less than the existence it qualifies - knowing a room dies at
   * 21:40 is useless without knowing it is there, which this already said.
   */
  expiresAt: number | null;
};

/**
 * Three answers, not two. "Unknown" is the one that matters: a deployment with no D1 binding
 * (vite dev) or an unapplied migration cannot tell a live room from a dead one, and treating
 * that as "dead" would silently delete a rejoin offer for a room that is sitting right there.
 * Unknown keeps the offer and lets the room itself refuse.
 */
export type RejoinVerdict = "live" | "gone" | "unknown";

/** A verdict plus, for a live room, when its code stops working. */
export type RejoinProbe = { verdict: RejoinVerdict; expiresAt: number | null };

/** A remembered room plus the verdict the probe returned for it - what the front door's rejoin
 * strip renders. It lives here rather than in the component so the route, the strip and the
 * tests all name the same type without importing a Svelte file for it. */
export type RejoinCandidate = RememberedRoom & {
  verdict: RejoinVerdict;
  /** When this room's code stops working, or null when nothing has said. */
  expiresAt: number | null;
};

export function verdictFor(liveness: RoomLiveness): RejoinVerdict {
  if (liveness.registry.status !== "ok") return "unknown";
  return liveness.live ? "live" : "gone";
}

/**
 * How long a remembered room has left, as a countdown a chip can render: "1h 12m", "8m",
 * "under a minute". Null when the deadline is unknown, and null once it has passed - an
 * expired room is `gone`, and a countdown reading "0m" beside an offer to walk back in would
 * be the offer arguing with itself.
 *
 * Coarse on purpose, and coarser the further out it is. A room expires hours from now and the
 * question a host is asking is "do I have time for a coffee", not "how many seconds". Seconds
 * would also demand a per-second re-render of the front page for a number nobody reads that
 * closely.
 */
export function formatExpiryCountdown(expiresAt: number | null, now: number): string | null {
  if (expiresAt === null) return null;
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return null;
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
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
): Promise<RejoinProbe> {
  try {
    const response = await fetchImpl(`/api/rooms/${encodeURIComponent(code)}/live`);
    if (!response.ok) return { verdict: verdictForStatus(response.status), expiresAt: null };
    const liveness = (await response.json()) as RoomLiveness;
    return { verdict: verdictFor(liveness), expiresAt: liveness.expiresAt ?? null };
  } catch {
    // Offline, DNS, a Worker cold start that timed out: unknown, never a deletion.
    return { verdict: "unknown", expiresAt: null };
  }
}
