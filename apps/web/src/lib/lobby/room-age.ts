// Lobby row helpers: the two derived strings a server browser shows next to a room name.
// Pure functions so they are testable without a DOM (docs/DEVELOPMENT.md testing note).

/**
 * Coarse age of a room, the way a server browser shows it: "new", "12m", "2h". Deliberately
 * imprecise - a lobby row is a glance, and the list is only as fresh as its poll interval.
 */
export function formatRoomAge(createdAt: number, now: number): string {
  const minutes = Math.floor(Math.max(now - createdAt, 0) / 60_000);
  if (minutes < 1) return "new";
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h`;
}

/**
 * The wall-clock time a listing was fetched, as `20:14:32` on this device's clock.
 *
 * Replaces the relative "Updated just now / 2m ago" phrasing (owner call 2026-08-17). A
 * relative phrase is the worse answer for the one question this line exists to settle - is
 * what I am looking at stale? - because it decays the moment it is painted: it is only honest
 * while a timer re-renders it, and "just now" says nothing about whether the poll before it
 * ever landed. A stamp is true forever and needs no ticking clock behind it.
 *
 * Built from the local Date parts rather than toLocaleTimeString: 24-hour, zero-padded and
 * identical everywhere, so the same room list does not read `8:14:32 PM` on one laptop and
 * `20:14:32` on the next.
 */
export function formatClockTime(at: number): string {
  const stamp = new Date(at);
  return [stamp.getHours(), stamp.getMinutes(), stamp.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** The phase badge text. "Playing" is the dimming cue, not a joinability promise: whether a
 * running room accepts arrivals is the late-join setting's business, and the DO's answer. */
export function formatRoomPhase(phase: "lobby" | "active" | "ended"): string {
  if (phase === "lobby") return "In lobby";
  if (phase === "active") return "Playing";
  return "Finished";
}
