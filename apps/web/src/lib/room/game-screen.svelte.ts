// The live half of the game screen: the window this console opened, and whether it is still
// there. Rules and copy live in game-screen.ts; this file owns the handle and the poll.
//
// Why a poll rather than an event: a popup that the host closes fires nothing at the opener that
// can be relied on across browsers (`unload` in the child is not delivered on every path, and a
// projector unplugged mid-game closes nothing at all). `window.closed` on a handle we own is the
// one check that is true everywhere, cheap, and honest - so the console asks, on a slow interval
// a host will never perceive and a laptop will never notice.
import { gameScreenWindowFeatures, gameScreenWindowName } from "#lib/room/game-screen.ts";
import type { GameScreenState, ScreenMetrics } from "#lib/room/game-screen.ts";

/**
 * The slice of `Window` this controller needs - so a test can hand it a plain object and drive
 * every state, and so nothing here depends on a DOM being present.
 */
export type GameScreenHandle = {
  readonly closed: boolean;
  focus?: () => void;
  close?: () => void;
};

export type GameScreenOpener = (
  url: string,
  name: string,
  features: string,
) => GameScreenHandle | null;

export type GameScreenWindowOptions = {
  /** Defaults to `globalThis.open`; absent (SSR, tests) means "cannot open", never a crash. */
  open?: GameScreenOpener | null;
  /** Defaults to `globalThis.screen`; only used to size the popup. */
  metrics?: ScreenMetrics | null;
  /** How often the handle is asked whether it is still there. */
  pollMs?: number;
};

export class GameScreenWindow {
  #state = $state<GameScreenState>("never-opened");
  #handle: GameScreenHandle | null = null;
  #opener: GameScreenOpener | null;
  #metrics: ScreenMetrics | null;
  #pollMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: GameScreenWindowOptions = {}) {
    const globalOpen = (globalThis as { open?: unknown }).open;
    this.#opener =
      options.open ??
      (typeof globalOpen === "function"
        ? (url, name, features) =>
            (globalOpen as (u: string, n: string, f: string) => GameScreenHandle | null)(
              url,
              name,
              features,
            )
        : null);
    this.#metrics = options.metrics ?? (globalThis as { screen?: ScreenMetrics }).screen ?? null;
    this.#pollMs = options.pollMs ?? 1500;
  }

  /** Reading this in a template or an effect tracks it. */
  get state(): GameScreenState {
    return this.#state;
  }

  /** True when this console can open a window at all (false during SSR). */
  get canOpen(): boolean {
    return this.#opener !== null;
  }

  /**
   * Open (or re-adopt) the game screen for this room. Returns false when the browser refused -
   * a pop-up blocker is the ordinary case, and the console has to say so rather than sit there
   * claiming a screen is open. Called from a click, which is what keeps blockers quiet.
   */
  open(url: string, roomCode: string): boolean {
    if (this.#opener === null) return false;
    const handle = this.#opener(
      url,
      gameScreenWindowName(roomCode),
      gameScreenWindowFeatures(this.#metrics),
    );
    if (handle === null) {
      // A blocked pop-up must not read as "still open" - if we had a window, we no longer know
      // that we do, and `closed` is the state that offers the host a way back.
      this.#state = this.#state === "never-opened" ? "never-opened" : "closed";
      return false;
    }
    this.#handle = handle;
    this.#state = "open";
    handle.focus?.();
    this.#startPolling();
    return true;
  }

  /** Bring the game screen forward - the "where did that window go" button. */
  focus(): void {
    this.#handle?.focus?.();
    this.poll();
  }

  /** Close it from here; the host's own close is caught by the poll instead. */
  close(): void {
    this.#handle?.close?.();
    this.poll();
  }

  /** Ask the handle whether it is still there. Public so tests drive it without a clock. */
  poll(): void {
    if (this.#handle === null) return;
    if (!this.#handle.closed) return;
    this.#handle = null;
    this.#state = "closed";
    this.#stopPolling();
  }

  /** Release the interval; the window itself is deliberately left alone (see the comment). */
  destroy(): void {
    this.#stopPolling();
    // The window is NOT closed here. A console reload must not blank the projector mid-game -
    // the display is an independent client of the room and outliving its opener is the point.
    this.#handle = null;
  }

  #startPolling(): void {
    if (this.#timer !== null) return;
    if (typeof setInterval !== "function") return;
    this.#timer = setInterval(() => {
      this.poll();
    }, this.#pollMs);
  }

  #stopPolling(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }
}
