// The one place surfaces obtain a RoomStore - and therefore the one place the choice between
// a real room and a simulated one is MADE, rather than assumed.
//
// Until the 2026-08-17 reconcile this function returned the local-sim store unconditionally,
// so every tab was its own isolated room: two phones and a display could not see each other.
// The choice now follows the CODE, because that is what the choice actually is:
//
//   /room/DUMYX/...  -> local-sim. The demo code the surface cards link to
//                       (#lib/landing/surface-cards.ts), so anyone can walk the screens with a
//                       full 30-player fixture roster and no server at all.
//   any other code   -> ws. A code that came from POST /api/rooms names a GameRoomDO, and the
//                       socket is the only way to be in that room.
//   ?sim             -> local-sim, whatever the code. A dev override for reviewing a real
//                       room's URL against fixture material; it never ships in a printed link.
//
// A surface can always ask which it got (`store.mode`), and the ones that matter say so on
// screen - a demo room must never be mistaken for a room your friends can join.
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { WsRoomStore } from "#lib/room/ws-room-store.svelte.ts";
import type { RoomSocketFactory } from "#lib/room/room-socket.ts";
import type { GameEvent } from "@jeopardy/engine/events";
import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";
import type { RoomBuzz, RoomStore, RoomStoreMode } from "#lib/room/room-store.ts";
import type { RoomRoleView } from "#lib/room/room-view.ts";

/**
 * The demo room. Not a magic string scattered around: the surface cards link to it, the mode
 * decision keys off it, and the pre-game screen labels it - all from here.
 */
export const demoRoomCode = "DUMYX";

/**
 * Which store a room code deserves. Pure, so a route can ask BEFORE building anything (the
 * host console checks for its creation token only when the room is a real one).
 *
 * `override` is the query string as the route read it: `?sim` present means local-sim.
 */
export function roomStoreModeFor(roomCode: string, override?: boolean): RoomStoreMode {
  if (override === true) return "local-sim";
  return roomCode.toUpperCase() === demoRoomCode ? "local-sim" : "ws";
}

export type CreateRoomStoreOptions = {
  roomCode: string;
  role: RoomRoleView;
  /** Skip the code-based decision. The dev surfaces and `?sim` are the only callers. */
  mode?: RoomStoreMode;
  /** Engine narration tap - the display's diorama beats, the console's flashes. */
  onEvent?: ((event: GameEvent) => void) | null;
  /** Room audio, with the sound already resolved team-first by whoever owns the room. */
  onBuzzWon?: ((buzz: RoomBuzz) => void) | null;

  // --- ws only -------------------------------------------------------------------------
  /** Creation-time credential for role=host (join-hand-off.ts stashed it at create). */
  hostToken?: string | null;
  /** The shared room secret, when the room has one. Rides the join message, never the URL. */
  password?: string | null;
  /** A previous join's resume credential from THIS tab (user-flows A5). */
  sessionToken?: string | null;
  /** Where a newly minted or invalidated session token goes. */
  onSessionToken?: ((token: string | null) => void) | null;
  /** Off during SSR and in tests; a route in the browser leaves it on. */
  autoConnect?: boolean;
  /** Test seams: a fake socket instead of a real dial, and a page origin without a DOM. */
  connect?: RoomSocketFactory;
  origin?: string;

  // --- local-sim only -----------------------------------------------------------------
  seed?: string;
  timerAutopilot?: boolean;
  seedRoster?: "fixture" | "empty";
  settings?: Partial<RoomSettings>;
};

export function createRoomStore(options: CreateRoomStoreOptions): RoomStore {
  const mode = options.mode ?? roomStoreModeFor(options.roomCode);
  if (mode === "ws") {
    return new WsRoomStore({
      roomCode: options.roomCode,
      role: options.role,
      hostToken: options.hostToken ?? null,
      password: options.password ?? null,
      sessionToken: options.sessionToken ?? null,
      onSessionToken: options.onSessionToken ?? null,
      onEvent: options.onEvent ?? null,
      onBuzzWon: options.onBuzzWon ?? null,
      ...(options.connect !== undefined && { connect: options.connect }),
      ...(options.origin !== undefined && { origin: options.origin }),
      ...(options.autoConnect !== undefined && { autoConnect: options.autoConnect }),
    });
  }
  return new LocalSimRoomStore({
    roomCode: options.roomCode,
    role: options.role,
    ...(options.seed !== undefined && { seed: options.seed }),
    ...(options.timerAutopilot !== undefined && { timerAutopilot: options.timerAutopilot }),
    ...(options.seedRoster !== undefined && { seedRoster: options.seedRoster }),
    ...(options.settings !== undefined && { settings: options.settings }),
    ...(options.onEvent != null && { onEvent: options.onEvent }),
    ...(options.onBuzzWon != null && { onBuzzWon: options.onBuzzWon }),
  });
}
