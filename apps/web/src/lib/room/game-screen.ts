// THE GAME SCREEN: how the room actually sees the board, as one decision with two answers.
//
// A host has exactly two setups (docs/design/user-flows.md C1/C1b), and until now the console
// treated them as unrelated features: mirror mode was a toggle in the cog, and the second-screen
// setup was a URL a host had to know (`/room/CODE/display`) printed as a hint in a checklist.
// That is backwards. Which screen the room is looking at is the FIRST thing a host settles on
// arrival, so it is one choice (`DevicePreferences.screenSetup`) with a first-class action
// attached to each answer:
//
//   second-screen  the laptop is on the podium and the projector is a second output. The console
//                  OPENS the game screen as a window the host drags across and fullscreens, and
//                  then tracks whether it is still there.
//   mirror         the laptop screen IS the projector. There is no second window to open; the
//                  console itself wears the display layout (C1b) and answers stop rendering.
//
// This module is the pure half: the window's address, the window features, the three states the
// opened window can be in, and the two questions the console asks about them. Everything that
// touches a real `window` lives in game-screen.svelte.ts, so all of the reasoning below is
// testable without a DOM.

/**
 * What this console knows about the game-screen window IT opened - first-hand, and therefore
 * true even in mock mode where the room census cannot see across tabs.
 *
 * - `never-opened` - this console has not opened one this session (a reload lands here too).
 * - `open` - we hold a live handle to it.
 * - `closed` - we opened one and it has since gone (host closed it, projector unplugged, crash).
 *
 * `closed` is deliberately NOT folded back into `never-opened`: "you had a game screen and it is
 * gone" is the state worth shouting about mid-game, and it is the one a host does not notice,
 * because the window that vanished was on the other screen.
 */
export type GameScreenState = "never-opened" | "open" | "closed";

/**
 * One named window per room, so a second press of "Open game screen" REUSES the window instead of
 * littering a projector with duplicates - and so a console that was reloaded (state back to
 * `never-opened`, window still up) re-adopts the window it already had rather than opening a
 * rival one.
 */
export function gameScreenWindowName(roomCode: string): string {
  return `jeopardy-game-screen-${roomCode.toUpperCase()}`;
}

/**
 * The display route, with the console's own theme carried across so the projector opens wearing
 * what the host has been previewing rather than the default preset. Nothing else rides this URL:
 * no token, no player id, no setting - the display is an ordinary client of the room (C1).
 */
export function gameScreenUrl(roomCode: string, themeId: string | null = null): string {
  const path = `/room/${roomCode.toUpperCase()}/display`;
  return themeId === null || themeId.length === 0
    ? path
    : `${path}?theme=${encodeURIComponent(themeId)}`;
}

/** The screen metrics the features string is computed against; `globalThis.screen` supplies them. */
export type ScreenMetrics = { availWidth: number; availHeight: number };

/**
 * Window features for the game screen: a POPUP, not a tab.
 *
 * A tab cannot be dragged to a second output without being torn off first, and it carries a tab
 * strip the room would read. A popup opens as its own window the host drags across and fullscreens
 * (F11 / green button) in one motion, which is the actual C1 gesture.
 *
 * 16:9 at 70% of the available width, because the window is a preview that gets fullscreened -
 * sizing it to the laptop's screen only makes it awkward to grab and drag. `noopener` is
 * deliberately absent: the whole point is to keep the handle, which is how the console can say
 * "game screen connected" at all.
 */
export function gameScreenWindowFeatures(metrics: ScreenMetrics | null): string {
  const availWidth = metrics === null ? 1280 : metrics.availWidth;
  const availHeight = metrics === null ? 800 : metrics.availHeight;
  const width = Math.max(
    640,
    Math.round(Math.min(availWidth * 0.7, (availHeight - 80) * (16 / 9))),
  );
  const height = Math.max(360, Math.round((width * 9) / 16));
  const left = Math.max(0, Math.round((availWidth - width) / 2));
  const top = Math.max(0, Math.round((availHeight - height) / 2));
  return `popup=yes,width=${String(width)},height=${String(height)},left=${String(left)},top=${String(top)}`;
}

/** The console's readout for the game screen: one line of state plus the action it offers next. */
export type GameScreenStatus = {
  /** `attached` = the room can see the board; `lost` = it could and now cannot. */
  tone: "attached" | "missing" | "lost";
  headline: string;
  detail: string;
  /** Primary action label - and the reason the button is not just "Open" forever. */
  action: "open" | "reopen" | "focus";
};

/**
 * What the console says about the game screen, from the two facts it can have: the window this
 * console opened, and the room's own connection census (`RoomView.connections`, null when the
 * store cannot know - see room-view.ts).
 *
 * The census OUTRANKS the window handle, because a display driven by a different machine, a
 * Chromecast, or a co-host's laptop is a real game screen this console never opened - and a
 * console that only believed its own window would call that room blind. The handle is the
 * fallback, and it is the only truth available in mock mode.
 */
export function gameScreenStatus(
  state: GameScreenState,
  connectedDisplays: number | null,
): GameScreenStatus {
  if (connectedDisplays !== null && connectedDisplays > 0) {
    return {
      tone: "attached",
      headline:
        connectedDisplays === 1
          ? "Game screen connected"
          : `${String(connectedDisplays)} game screens connected`,
      detail: "The room can see the board.",
      action: state === "open" ? "focus" : "open",
    };
  }
  if (state === "open") {
    return {
      tone: "attached",
      headline: "Game screen open",
      detail: "Opened from this laptop - drag it to the projector and fullscreen it.",
      action: "focus",
    };
  }
  if (state === "closed") {
    return {
      tone: "lost",
      headline: "Game screen was closed",
      detail: "Nothing is on the projector. Reopening restores it from room state.",
      action: "reopen",
    };
  }
  return {
    tone: "missing",
    headline: "No game screen open",
    detail: "Open one and drag it to the projector, or switch this laptop to mirror mode.",
    action: "open",
  };
}

/**
 * Whether a room is ready to start, and if not, whether that is a refusal or a warning.
 *
 * Two different failures, deliberately kept apart:
 *
 * - `blocked` - the engine has nobody to seat, so `start-game` is refused. A button that does
 *   nothing was the 2026-08-16 host-loop finding; this says why instead.
 * - `warn` - the game would start perfectly well and nobody in the room would see it. The
 *   2026-08-16 walk found starting with nothing attached to be a real footgun: the host reads a
 *   clue off their own screen while the projector shows a desktop. Warned once, never blocked -
 *   a host running a small room off one laptop is a legitimate setup, and so is a projector that
 *   is about to be plugged in.
 */
export type StartReadiness =
  | { kind: "ready" }
  | { kind: "blocked"; headline: string; detail: string }
  | { kind: "warn"; headline: string; detail: string };

export function startReadiness(params: {
  seatedPlayers: number;
  /** The device's answer to "how does the room see this game" (device-preferences.ts). */
  mirrored: boolean;
  gameScreen: GameScreenState;
  connectedDisplays: number | null;
}): StartReadiness {
  // AN EMPTY ROOM IS NO LONGER BLOCKED (owner, 2026-08-20: "allow for starting a room with 0
  // players") - it is WARNED, which is the same shape the missing-game-screen case has always
  // used: say the thing that is probably a mistake, once, and let the host proceed.
  //
  // Starting empty is a legitimate thing to do - rehearsing before the doors open, running the
  // board on a projector while people arrive, driving the night by hand because the wi-fi
  // died - and people can still join a running game (late join, matrix #43). It is also
  // usually an accident, which is why it still says so.
  if (params.seatedPlayers === 0) {
    return {
      kind: "warn",
      headline: "Nobody has joined yet",
      detail: "You can start anyway and let people join as they arrive.",
    };
  }
  // Mirror mode IS the game screen: this laptop is what the room is looking at, so there is
  // nothing to attach and nothing to warn about.
  if (params.mirrored) return { kind: "ready" };
  if (params.connectedDisplays !== null && params.connectedDisplays > 0) return { kind: "ready" };
  if (params.gameScreen === "open") return { kind: "ready" };
  return {
    kind: "warn",
    headline: "No game screen is attached",
    detail: "The room will not see the board. Open the game screen, or start anyway.",
  };
}
