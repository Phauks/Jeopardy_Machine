// Role-based redaction of engine state and events before they leave the DO. The rule
// (protocol room/server-messages.ts documents the contract): the HOST console is the only
// client that may see hidden information; phones, displays, and spectators must never
// receive Daily-Double locations, secret final wagers, or other players' typed answers -
// not in the UI, not in devtools, not on the wire at all.
import type { GameEvent } from "@jeopardy/engine/events";
import type { GameState } from "@jeopardy/engine/state";
import type { RoomRole } from "@jeopardy/protocol/room/identity";

// The snapshot payload: GameState minus server-side recovery internals. actionLog is the
// crash-recovery mechanism and rngState the determinism secret (a client that knows the rng
// state could predict wager-cell placement); neither is any client's business - a client
// needing history missed events and should sync, not replay.
export function redactStateFor(role: RoomRole, state: GameState): GameState {
  const view = structuredClone(state);
  view.actionLog = [];
  view.rngState = 0;
  if (role === "host") return view;
  for (const board of view.boards) {
    // Hidden wager cells are THE canonical secret (rules matrix #23-#25): the splash moment
    // dies if a phone can read the board. Revealed-by-hit cells reach clients as
    // wager-cell-hit events; the remaining positions stay server-only.
    board.wagerCells = [];
  }
  if (view.final !== null) {
    // Final wagers and answers are secret until the reveal (engine events carry the reveal
    // in drama order); presence/progress reaches clients via final-wager-committed /
    // final-answer-submitted events, which deliberately omit amounts and text.
    view.final.wagers = {};
    view.final.answers = {};
  }
  return view;
}

// Event-stream redaction. Everything the engine narrates is public by design (it already
// omits secrets like final wager amounts) EXCEPT everyone-answers submission text, which
// would let phones read each other's answers before judging: only the host and the
// submitting player see the text; everyone else sees the submission happened.
export function redactEventsFor(
  role: RoomRole,
  playerId: string | null,
  events: readonly GameEvent[],
): GameEvent[] {
  return events.map((event) => {
    if (event.type === "answer-submitted" && role !== "host" && event.playerId !== playerId) {
      return { ...event, text: "" };
    }
    return event;
  });
}
