// The one place surfaces obtain a RoomStore - and therefore the one line the M3 reconcile
// flips. Today every room is a local simulation (mock-first architecture, docs/design/
// surfaces.md); after reconcile the default becomes WsRoomStore and local-sim remains
// reachable for rehearse mode and the dev sim panel.
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { fixtureRoomCode } from "#lib/room/fixture-room.ts";
import type { LocalSimStoreOptions } from "#lib/room/local-sim-store.svelte.ts";

export type CreateRoomStoreOptions = LocalSimStoreOptions;

export function createRoomStore(options: CreateRoomStoreOptions): LocalSimRoomStore {
  // Reconcile: `return options.mock ? new LocalSimRoomStore(options) : new WsRoomStore(...)`.
  // The return type then widens to RoomStore; surfaces already consume only the interface.
  return new LocalSimRoomStore(options);
}

/**
 * Which roster a mock room starts with - and the one rule that matters: A ROOM THE OWNER MADE
 * NEVER STARTS WITH IMAGINARY PEOPLE IN IT.
 *
 * Every play route builds a local simulation today, and the sim seeded the 30-player fixture
 * roster into whatever code was in the URL. The result was a host console reporting "26/30
 * connected" for a room nobody had joined (owner, 2026-08-17), a pre-flight checklist counting
 * six teams that did not exist, and a display listing strangers on the projector. Fixture data
 * is dev material; presenting it as the room's own is the surface lying about the room.
 *
 * So the dummy roster appears in exactly two places: the fixture room's own code (DUMYX, what
 * the demo links and the surface reviews use) and an explicit `?demo` on any code. Everything
 * else starts EMPTY and says so - which is also the shape the ws store will arrive in.
 */
export function seedRosterFor(
  roomCode: string,
  // Structural, and only the one method: SvelteKit's `page.url` hands over a READONLY
  // URLSearchParams, so asking for the mutable class here would make the routes cast.
  url: { searchParams: { has: (name: string) => boolean } },
): "fixture" | "empty" {
  if (url.searchParams.has("demo")) return "fixture";
  return roomCode.toUpperCase() === fixtureRoomCode.toUpperCase() ? "fixture" : "empty";
}
