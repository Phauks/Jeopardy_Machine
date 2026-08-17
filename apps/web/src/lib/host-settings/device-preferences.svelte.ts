// The live device preferences: one runes-backed object per browsing context, loaded from
// localStorage, written back on every change, and kept in step with the OTHER WINDOWS of the
// same browser.
//
// That last part is the reason this is a module-level singleton rather than a prop: the C1
// setup is one laptop with the console on the built-in screen and the display window dragged
// onto the projector (docs/design/user-flows.md). They are two tabs of the same origin, so a
// `storage` event fires in the display window every time the console writes - which is how
// "display type scale" on the host's cog reaches the projector at all, with no room state, no
// server, and nothing the players can ever see. A device preference stays a device preference.
//
// Everything the store does to a value first goes through the pure module next door, so the
// clamping, the tolerant parse, and the CSS mapping are all tested without a DOM.
import {
  defaultDevicePreferences,
  normalizeTypeScale,
  parseDevicePreferences,
  preferencesKey,
  serializeDevicePreferences,
} from "#lib/host-settings/device-preferences.ts";
import type { DevicePreferences } from "#lib/host-settings/device-preferences.ts";

export class DevicePreferencesStore {
  #preferences = $state<DevicePreferences>({ ...defaultDevicePreferences });
  #storage: Storage | null = null;
  #detach: (() => void) | null = null;

  /** The current values. Reading a field in a template or an effect tracks it. */
  get current(): DevicePreferences {
    return this.#preferences;
  }

  /**
   * Attach to a real browser: load what is stored and listen for other windows changing it.
   * A no-op on the server and in tests that never call it, so SSR renders the defaults rather
   * than reaching for a global that is not there.
   */
  attach(storage: Storage | null = globalThis.localStorage ?? null): void {
    this.#storage = storage;
    if (storage === null) return;
    try {
      this.#preferences = parseDevicePreferences(storage.getItem(preferencesKey));
    } catch {
      // A browser with storage blocked (private mode, a locked-down projector laptop) keeps
      // the defaults and simply does not persist. Losing a preference is not worth a crash on
      // the machine running the game.
      this.#preferences = { ...defaultDevicePreferences };
    }
    if (typeof globalThis.addEventListener !== "function") return;
    const onStorage = (event: Event): void => {
      const storageEvent = event as StorageEvent;
      if (storageEvent.key !== null && storageEvent.key !== preferencesKey) return;
      this.#preferences = parseDevicePreferences(storageEvent.newValue);
    };
    globalThis.addEventListener("storage", onStorage);
    this.#detach = () => {
      globalThis.removeEventListener("storage", onStorage);
    };
  }

  detach(): void {
    this.#detach?.();
    this.#detach = null;
  }

  /** Change one or more preferences. Applies instantly; persistence is best-effort. */
  update(patch: Partial<DevicePreferences>): void {
    const next: DevicePreferences = { ...this.#preferences, ...patch };
    if (patch.displayTypeScale !== undefined) {
      next.displayTypeScale = normalizeTypeScale(patch.displayTypeScale);
    }
    if (patch.consoleTypeScale !== undefined) {
      next.consoleTypeScale = normalizeTypeScale(patch.consoleTypeScale);
    }
    this.#preferences = next;
    try {
      this.#storage?.setItem(preferencesKey, serializeDevicePreferences(next));
    } catch {
      // Quota or a blocked store: the session keeps the setting, the next one does not.
    }
  }

  /** Back to the shipped defaults - the "I have fiddled too much, ten minutes to doors" button. */
  reset(): void {
    this.update({ ...defaultDevicePreferences });
  }
}

/**
 * The one store per browsing context. Shared by the console, the display route, and the cog,
 * so all three are looking at the same object and a change in one is a change in all.
 */
export const devicePreferences = new DevicePreferencesStore();
