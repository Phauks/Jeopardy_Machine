// The one place surfaces obtain a RoomStore - and therefore the one line the M3 reconcile
// flips. Today every room is a local simulation (mock-first architecture, docs/design/
// surfaces.md); after reconcile the default becomes WsRoomStore and local-sim remains
// reachable for rehearse mode and the dev sim panel.
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import type { LocalSimStoreOptions } from "#lib/room/local-sim-store.svelte.ts";

export type CreateRoomStoreOptions = LocalSimStoreOptions;

export function createRoomStore(options: CreateRoomStoreOptions): LocalSimRoomStore {
  // Reconcile: `return options.mock ? new LocalSimRoomStore(options) : new WsRoomStore(...)`.
  // The return type then widens to RoomStore; surfaces already consume only the interface.
  return new LocalSimRoomStore(options);
}
