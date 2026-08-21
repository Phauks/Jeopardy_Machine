// The room's resolved settings, projected down to the rules a SURFACE is told about.
//
// A projection rather than a passthrough, deliberately: `setup.settings` is the whole rules
// object, most of which is either meaningless to a phone or a fact about the authored game
// rather than about what is happening tonight. What travels is exactly what a surface has to
// draw or say - the clock it is counting against, and what a wrong answer will cost.
//
// The projection ITSELF lives in the protocol (@jeopardy/protocol room/live-rules.ts) beside
// the schema it has to satisfy and the default it also produces. This module is the seam onto
// the engine's `GameSetup`, and nothing more: two copies of "which fields travel" is exactly
// the drift the room-code alphabet taught us about (server-messages.ts, 2026-08-20).
import { liveRulesOfSettings } from "@jeopardy/protocol/room/live-rules";
import type { LiveRules } from "@jeopardy/protocol/room/live-rules";
import type { GameSetup } from "@jeopardy/engine/setup";

export function liveRulesOf(setup: GameSetup): LiveRules {
  return liveRulesOfSettings(setup.settings);
}
