// The game screen as a state machine: the window this console opened, what the console says
// about it, and whether a game may start without one. Pure - no DOM, no browser, no clock.
import { describe, expect, it } from "vitest";
import { GameScreenWindow } from "#lib/room/game-screen.svelte.ts";
import {
  gameScreenStatus,
  gameScreenUrl,
  gameScreenWindowFeatures,
  gameScreenWindowName,
  startReadiness,
} from "#lib/room/game-screen.ts";

/** A stand-in for the popup: `closed` flips when the "host" closes it. */
function fakeWindow(): { closed: boolean; focus: () => void; close: () => void; focused: number } {
  const handle = {
    closed: false,
    focused: 0,
    focus(): void {
      handle.focused += 1;
    },
    close(): void {
      handle.closed = true;
    },
  };
  return handle;
}

describe("the game screen's address", () => {
  it("is the display route, and carries only the theme", () => {
    expect(gameScreenUrl("bqkx7")).toBe("/room/BQKX7/display");
    expect(gameScreenUrl("BQKX7", "paper")).toBe("/room/BQKX7/display?theme=paper");
    // Never a token, never a password: this URL is opened, bookmarked and screenshotted.
    expect(gameScreenUrl("BQKX7", "paper")).not.toMatch(/token|password|session/i);
  });

  it("names the window per room, so a second press reuses it instead of littering", () => {
    expect(gameScreenWindowName("bqkx7")).toBe(gameScreenWindowName("BQKX7"));
    expect(gameScreenWindowName("BQKX7")).not.toBe(gameScreenWindowName("OTHER"));
  });

  it("opens a 16:9 popup that fits the screen it was opened from", () => {
    const features = gameScreenWindowFeatures({ availWidth: 1440, availHeight: 900 });
    expect(features).toContain("popup=yes");
    const width = Number(/width=(\d+)/.exec(features)?.[1] ?? "0");
    const height = Number(/height=(\d+)/.exec(features)?.[1] ?? "0");
    expect(width).toBeLessThanOrEqual(1440);
    expect(height).toBeLessThanOrEqual(900);
    expect(width / height).toBeCloseTo(16 / 9, 1);
    // `noopener` would throw away the handle, and with it every "is it still there" answer.
    expect(features).not.toContain("noopener");
    // No metrics (SSR) is a sane window, never a crash.
    expect(gameScreenWindowFeatures(null)).toContain("popup=yes");
  });
});

describe("never opened -> opened -> closed again", () => {
  it("starts having never opened one", () => {
    const screen = new GameScreenWindow({ open: () => null });
    expect(screen.state).toBe("never-opened");
  });

  it("opens, holds the handle, and focuses it", () => {
    const handle = fakeWindow();
    const screen = new GameScreenWindow({ open: () => handle });
    expect(screen.open("/room/TESTA/display", "TESTA")).toBe(true);
    expect(screen.state).toBe("open");
    expect(handle.focused).toBe(1);
    screen.focus();
    expect(handle.focused).toBe(2);
    expect(screen.state).toBe("open");
  });

  it("notices the host closing it - the state a console is the only one to see", () => {
    const handle = fakeWindow();
    const screen = new GameScreenWindow({ open: () => handle });
    screen.open("/room/TESTA/display", "TESTA");
    handle.closed = true;
    screen.poll();
    expect(screen.state).toBe("closed");
    // ...and reopening is a fresh handle, back to open.
    const second = fakeWindow();
    const reopening = new GameScreenWindow({ open: () => second });
    expect(reopening.open("/room/TESTA/display", "TESTA")).toBe(true);
    expect(reopening.state).toBe("open");
  });

  it("reports a blocked pop-up rather than claiming a screen is open", () => {
    const screen = new GameScreenWindow({ open: () => null });
    expect(screen.open("/room/TESTA/display", "TESTA")).toBe(false);
    expect(screen.state).toBe("never-opened");
  });

  it("leaves the window alone on destroy - a console reload must not blank the projector", () => {
    const handle = fakeWindow();
    const screen = new GameScreenWindow({ open: () => handle });
    screen.open("/room/TESTA/display", "TESTA");
    screen.destroy();
    expect(handle.closed).toBe(false);
  });

  it("cannot open at all without a browser, and says so instead of throwing", () => {
    const screen = new GameScreenWindow({ open: null });
    expect(screen.canOpen).toBe(false);
    expect(screen.open("/room/TESTA/display", "TESTA")).toBe(false);
  });
});

describe("what the console says about it", () => {
  it("names the three states in the host's own words", () => {
    expect(gameScreenStatus("never-opened", null).headline).toBe("No game screen open");
    expect(gameScreenStatus("never-opened", null).action).toBe("open");
    expect(gameScreenStatus("open", null).headline).toBe("Game screen open");
    expect(gameScreenStatus("open", null).action).toBe("focus");
    expect(gameScreenStatus("closed", null).headline).toBe("Game screen was closed");
    expect(gameScreenStatus("closed", null).action).toBe("reopen");
  });

  it("keeps 'was closed' apart from 'never opened' - one of them is an emergency", () => {
    expect(gameScreenStatus("closed", null).tone).toBe("lost");
    expect(gameScreenStatus("never-opened", null).tone).toBe("missing");
  });

  it("believes the room's census over its own window", () => {
    // A Chromecast, a co-host's laptop, a second projector: displays this console never opened.
    const status = gameScreenStatus("never-opened", 2);
    expect(status.tone).toBe("attached");
    expect(status.headline).toContain("2 game screens");
  });
});

describe("starting without a game screen", () => {
  const base = { seatedPlayers: 4, mirrored: false, connectedDisplays: null };

  // WARNS rather than blocks since 2026-08-20 (owner: "allow for starting a room with 0
  // players"). Starting empty is legitimate - a rehearsal, a board on a projector while people
  // arrive - and people can join a running game afterwards. It is also usually an accident,
  // which is why it still says so once.
  it("warns about an empty room rather than refusing it", () => {
    const readiness = startReadiness({ ...base, seatedPlayers: 0, gameScreen: "open" });
    expect(readiness.kind).toBe("warn");
    expect(readiness.kind === "warn" && readiness.headline).toBe("Nobody has joined yet");
  });

  it("warns - never blocks - when nothing is on the projector", () => {
    const readiness = startReadiness({ ...base, gameScreen: "never-opened" });
    expect(readiness.kind).toBe("warn");
    const closed = startReadiness({ ...base, gameScreen: "closed" });
    expect(closed.kind).toBe("warn");
  });

  it("is ready once a game screen exists, by either route", () => {
    expect(startReadiness({ ...base, gameScreen: "open" }).kind).toBe("ready");
    expect(startReadiness({ ...base, gameScreen: "never-opened", connectedDisplays: 1 }).kind).toBe(
      "ready",
    );
  });

  it("never warns in mirror mode - this laptop IS the game screen", () => {
    expect(startReadiness({ ...base, mirrored: true, gameScreen: "never-opened" }).kind).toBe(
      "ready",
    );
  });

  // The empty-room warning outranks mirror mode's "nothing to attach": a host who is mirroring
  // has settled the screen question, so the only thing left worth saying is that the room is
  // empty. Neither one blocks any more, so this is about which sentence is shown.
  it("still mentions an empty room in mirror mode, where the screen question is settled", () => {
    const readiness = startReadiness({
      ...base,
      seatedPlayers: 0,
      mirrored: true,
      gameScreen: "open",
    });
    expect(readiness.kind).toBe("warn");
    expect(readiness.kind === "warn" && readiness.headline).toBe("Nobody has joined yet");
  });
});
