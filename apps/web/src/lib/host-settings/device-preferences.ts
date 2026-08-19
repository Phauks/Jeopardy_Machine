// DEVICE PREFERENCES - the half of the host's cog that belongs to this laptop and to nobody
// else, and the reason the panel has two halves at all.
//
// The distinction the UI has to make unmissable (owner, 2026-08-16): a DEVICE preference is
// local, instant, and nobody else's business - it changes what THIS machine renders and plays.
// A ROOM setting is server state, is broadcast to every connection, and changes the room for
// everybody in it (packages/protocol/src/room/room-settings.ts). A host who confuses the two
// mid-game either whispers when they meant to shout or the reverse, so the two live in
// different modules, are stored in different places, and are labelled differently on screen.
//
// localStorage is exactly right here and not a shortcut: "how big is the type on the projector
// this laptop drives" is a property of the laptop and the venue, not of the game, and it must
// survive a reload of the console mid-evening without a round trip. It also gets us the one
// piece of cross-window behaviour the setup actually needs for free - see `preferencesKey`.
//
// Everything in this module is pure. The runes-backed store that loads, saves, and syncs it
// lives next door in device-preferences.svelte.ts.

/**
 * Storage key, versioned. A shape change bumps the version rather than migrating: these are
 * device preferences with sane defaults, and a host who loses their type scale once is a far
 * smaller cost than a migration path nobody will ever test.
 *
 * ONE key for the whole document, deliberately. The console writes it and the display window
 * READS it - two tabs of the same browser, which is the C1 setup (laptop drives the projector
 * on an extended desktop). A `storage` event fires in the other tab on every write, so the
 * host changes the display type scale on their console and the projector re-lays itself out
 * without the room ever becoming aware of a setting.
 */
export const preferencesKey = "jeopardy.device-preferences.v2";

/**
 * HOW THE ROOM SEES THIS GAME - the first decision a host makes on arrival, and one decision
 * rather than two features (docs/design/user-flows.md C1/C1b).
 *
 * - `second-screen` - the laptop is on the podium and the projector is a second output. The
 *   console opens the game screen as its own window (src/lib/room/game-screen.ts), the host drags
 *   it across, and the console keeps the private layer: answers, wager cells, the judge row.
 * - `mirror` - the laptop screen IS the projector, so whatever the host sees, the room sees. The
 *   console wears the display layout with a slim dock, and the private layer does not render at
 *   all.
 *
 * Per DEVICE, never a room setting: a co-host on a second laptop runs the full private console at
 * the same time. It replaced the old `mirror` boolean at the 2026-08-19 game-screen pass - the
 * boolean made mirror mode look like an unrelated toggle, so the other setup had no home and no
 * action, which is exactly the gap the owner reported.
 */
export type ScreenSetup = "second-screen" | "mirror";

/** How the stage (the 3D diorama / staged lobby) behaves on this device's display surfaces. */
export type StageMotion =
  /** As designed: avatars walk, wait, and react. */
  | "full"
  /** Everything renders, nothing moves - the same freeze prefers-reduced-motion applies. */
  | "still"
  /** No 3D at all: the clean 2D lobby. The escape hatch for a laptop that is struggling. */
  | "off";

/** How tightly the console packs its roster, score, and award rows. */
export type RosterDensity = "comfortable" | "compact";

export type DevicePreferences = {
  /**
   * Type scale for DISPLAY surfaces rendered by this browser - the projector window and the
   * console's own mirror mode. Separate from the console's scale because the two are read from
   * completely different distances (owner: "display text and host text are different things").
   */
  displayTypeScale: number;
  /** Type scale for the host console's private chrome, read at arm's length. */
  consoleTypeScale: number;
  /** Room audio plays out of the display window on this device (resolved UX question 3). */
  displayAudio: boolean;
  /** Room audio plays out of the console on this device. Off by default, per the same answer. */
  consoleAudio: boolean;
  /** Master volume for whichever of the two is on, 0..1. One pair of speakers per device. */
  audioVolume: number;
  /** Which of the two projector setups this laptop is in (user-flows C1/C1b). */
  screenSetup: ScreenSetup;
  /** Manual mode: no buzzers, the host awards from the console (resolved UX question 1). */
  manualMode: boolean;
  /** Whether the console draws the pending-timer countdowns (game-anatomy section 8 step 4). */
  showTimers: boolean;
  rosterDensity: RosterDensity;
  stageMotion: StageMotion;
};

/** Smallest and largest type scale either surface may be set to, and the step the UI moves in. */
export const minimumTypeScale = 0.8;
export const maximumTypeScale = 2;
export const typeScaleStep = 0.05;

export const defaultDevicePreferences: DevicePreferences = {
  displayTypeScale: 1,
  consoleTypeScale: 1,
  displayAudio: true,
  consoleAudio: false,
  audioVolume: 0.8,
  screenSetup: "second-screen",
  manualMode: false,
  showTimers: true,
  rosterDensity: "comfortable",
  stageMotion: "full",
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Per-field readers for the tolerant parse below: a wrong type costs one setting, not all. */
function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Round to the UI's step, so a stored 1.0000000000000002 does not come back as a slider jitter. */
export function normalizeTypeScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const stepped = Math.round(value / typeScaleStep) * typeScaleStep;
  return Number(clamp(stepped, minimumTypeScale, maximumTypeScale).toFixed(2));
}

/**
 * Read a stored document back into a complete, in-range preferences object.
 *
 * Tolerant on purpose: the input is whatever was in localStorage, which may be from an older
 * build, another tab mid-write, or a user with a console open. Every field falls back
 * independently, so one bad value costs one setting rather than all of them - and a host mid-game
 * never sees a crash from a preferences read.
 */
export function parseDevicePreferences(raw: string | null): DevicePreferences {
  if (raw === null || raw.length === 0) return { ...defaultDevicePreferences };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...defaultDevicePreferences };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...defaultDevicePreferences };
  const source = parsed as Partial<Record<keyof DevicePreferences, unknown>>;
  return {
    displayTypeScale: normalizeTypeScale(readNumber(source.displayTypeScale, 1)),
    consoleTypeScale: normalizeTypeScale(readNumber(source.consoleTypeScale, 1)),
    displayAudio: readBoolean(source.displayAudio, defaultDevicePreferences.displayAudio),
    consoleAudio: readBoolean(source.consoleAudio, defaultDevicePreferences.consoleAudio),
    audioVolume: clamp(readNumber(source.audioVolume, defaultDevicePreferences.audioVolume), 0, 1),
    screenSetup: source.screenSetup === "mirror" ? "mirror" : "second-screen",
    manualMode: readBoolean(source.manualMode, defaultDevicePreferences.manualMode),
    showTimers: readBoolean(source.showTimers, defaultDevicePreferences.showTimers),
    rosterDensity: source.rosterDensity === "compact" ? "compact" : "comfortable",
    stageMotion:
      source.stageMotion === "off" || source.stageMotion === "still" ? source.stageMotion : "full",
  };
}

export function serializeDevicePreferences(preferences: DevicePreferences): string {
  return JSON.stringify(preferences);
}

/**
 * The style attribute a surface wears to take a type scale.
 *
 * ONE token, scoped per surface - that is the whole per-surface mechanism. `--type-scale`
 * multiplies the board type tokens (src/lib/theme/tokens.css) and the root font size of every
 * surface that opts in, so the console can be at 1.0 while the projector it drives is at 1.4
 * and neither knows about the other. Returning a string rather than setting properties keeps
 * this testable and keeps the surfaces declarative.
 */
export function typeScaleStyle(scale: number): string {
  return `--type-scale: ${String(normalizeTypeScale(scale))}`;
}

/** Human label for a scale, for the panel's live readout: "120%". */
export function typeScaleLabel(scale: number): string {
  return `${String(Math.round(normalizeTypeScale(scale) * 100))}%`;
}
