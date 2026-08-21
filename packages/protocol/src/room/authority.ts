// The role-authority matrix for relayed engine actions: who may send each engine action
// type through an `action` message, and what the server stamps onto it before it reaches
// the engine. This is the documented contract the GameRoomDO enforces; a gate test in
// apps/realtime asserts the matrix covers the engine's action catalog exactly (the two
// packages meet there - the engine depends on protocol, so the type names are strings here).
//
// Authority levels:
// - "server-only":  never accepted from any connection. player-join/player-leave are
//   DO-synthesized (join flow, start-game seating, kicks), and every *-timeout is an
//   alarm-driven expiry - accepting them from clients would let a phone forge time.
//   Exception carved into the DO: the HOST may send buzz-timeout ("no takers"),
//   selection-timeout, wager/final timeouts early - the host closing a window by hand is
//   the manual override guaranteed by guiding principle 4. That carve-out is expressed as
//   "host" on those rows instead of server-only.
// - "host":         host connections only (arm, judge, score overrides, undo, round flow).
// - "player":       any player seat; the server stamps `playerId` = the sender's seat, so a
//   phone can never buzz as somebody else. Hosts deliberately CANNOT buzz.
// - "acting-player": a player action the host may also perform on a player's behalf from
//   the console (select for the room, type a wager for a dead phone - user-flows C4).
//   From a player: identity fields are stamped from the session (entityId = the sender's
//   scoring entity). From the host: provided identity fields pass through untouched.
//
// Wager note: commit-wager carries no entity field (the engine binds it to the clue's
// selector), so the DO additionally checks a player sender IS the selecting entity.
export type ActionAuthority = "server-only" | "host" | "player" | "acting-player";

export const actionAuthority: Record<string, ActionAuthority> = {
  // Lobby + seating: DO-synthesized from the roster at start-game / late join / kick.
  "player-join": "server-only",
  "player-leave": "server-only",
  "start-game": "host",

  // Selection: engine validates control; entityId stamped for players, host may select
  // with no entityId at all (select on the room's behalf).
  "select-cell": "acting-player",
  "selection-timeout": "host",

  // Clue lifecycle.
  "arm-buzzers": "host",
  buzz: "player",
  "buzz-timeout": "host",
  judge: "host",
  "answer-timeout": "host",
  "submit-typed-answer": "player",
  "close-answers": "host",
  "judge-entity": "host",

  // Wager cells.
  "commit-wager": "acting-player",
  "wager-timeout": "host",

  // Host controls.
  "host-award": "host",
  "cancel-clue": "host",
  "reopen-cell": "host",
  "score-adjust": "host",
  "score-set": "host",
  undo: "host",

  // Round flow.
  "end-round": "host",
  // The host's own ending, from anywhere in a running game. Host-only for the obvious reason
  // and one less obvious: it is the single action that can take the whole room to game-over
  // without the board being played out.
  "end-game": "host",
  "round-timeout": "host",
  proceed: "host",

  // Final round: wager/answer are per-entity; the host may enter them for an absent phone.
  "commit-final-wager": "acting-player",
  "final-wager-timeout": "host",
  "submit-final-answer": "acting-player",
  "final-writing-timeout": "host",

  // Tiebreaker.
  "tiebreaker-next-clue": "host",
};

// Convenience the DO and tests share: may `role` relay `actionType` at all? (The per-action
// stamping and the commit-wager selector check remain the DO's job.)
export function roleMayRelay(role: "host" | "player", actionType: string): boolean {
  const authority = actionAuthority[actionType];
  if (authority === undefined || authority === "server-only") return false;
  if (authority === "host") return role === "host";
  if (authority === "player") return role === "player";
  return true; // acting-player: both
}
