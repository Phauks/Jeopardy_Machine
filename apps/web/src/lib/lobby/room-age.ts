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

/** The phase badge text. "Playing" is the dimming cue, not a joinability promise: whether a
 * running room accepts arrivals is the late-join setting's business, and the DO's answer. */
export function formatRoomPhase(phase: "lobby" | "active" | "ended"): string {
  if (phase === "lobby") return "In lobby";
  if (phase === "active") return "Playing";
  return "Finished";
}
