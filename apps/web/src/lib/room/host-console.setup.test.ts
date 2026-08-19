// C1 on the console: how the game gets onto a projector, and how people get into the room.
//
// Two features that used to have no home at all - the display route was a URL printed in a
// checklist, and the join code lived only on the big screen - so these assertions are mostly
// about things being PRESENT and about one boundary being deliberately inverted (see the
// streamer-mode describe at the bottom). Server-render, per the repo pattern.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import DisplayScreen from "#lib/room/display-screen.svelte";
import GameScreenPanel from "#lib/room/game-screen-panel.svelte";
import HostConsole from "#lib/room/host-console.svelte";
import HostRosterPanel from "#lib/room/host-roster-panel.svelte";
import JoinPanel from "#lib/room/join-panel.svelte";
import { DevicePreferencesStore } from "#lib/host-settings/device-preferences.svelte.ts";
import { GameScreenWindow } from "#lib/room/game-screen.svelte.ts";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import type { RoomSettings } from "@jeopardy/protocol/room/room-settings";

const roomCode = "BQKX7";

/** The panel's own source, for the size assertions CSS cannot make in an SSR render. */
const joinPanelSource = readFileSync(
  fileURLToPath(new URL("./join-panel.svelte", import.meta.url)),
  "utf8",
);

function hostStore(
  settings: Partial<RoomSettings> = {},
  seedRoster: "fixture" | "empty" = "fixture",
): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode, role: "host", seed: "setup", seedRoster, settings });
}

/** A game-screen window in a chosen state, without a browser anywhere near it. */
function screenIn(state: "never-opened" | "open" | "closed"): GameScreenWindow {
  const handle = { closed: false, focus: () => undefined, close: () => undefined };
  const screen = new GameScreenWindow({ open: () => handle });
  if (state === "never-opened") return screen;
  screen.open("/room/BQKX7/display", roomCode);
  if (state === "closed") {
    handle.closed = true;
    screen.poll();
  }
  return screen;
}

function consoleMarkup(props: Record<string, unknown>): string {
  return render(HostConsole, { props: { store: hostStore(), ...props } }).body;
}

describe("opening the game screen (C1)", () => {
  it("offers the two setups as one choice, with the current one marked", () => {
    const body = consoleMarkup({});
    expect(body).toContain("How the room sees this game");
    expect(body).toContain("Second screen");
    expect(body).toContain("Mirror this screen");
    // The default setup is the common one, and it is the one showing as chosen.
    expect(body).toContain('aria-pressed="true"');
  });

  it("says the game screen has never been opened, and offers to open it", () => {
    const body = consoleMarkup({ gameScreen: screenIn("never-opened") });
    expect(body).toContain("No game screen open");
    expect(body).toContain("Open game screen");
  });

  it("says it is open once it is, and offers to bring it forward instead", () => {
    const body = consoleMarkup({ gameScreen: screenIn("open") });
    expect(body).toContain("Game screen open");
    expect(body).toContain("Bring it to the front");
    expect(body).not.toContain("No game screen open");
  });

  it("shouts when a game screen that existed has gone - the one nobody notices", () => {
    const body = consoleMarkup({ gameScreen: screenIn("closed") });
    expect(body).toContain("Game screen was closed");
    expect(body).toContain("Reopen game screen");
    expect(body).toContain('data-tone="lost"');
  });

  it("carries the console's theme onto the window it opens", () => {
    const { body } = render(GameScreenPanel, {
      props: {
        view: hostStore().view,
        gameScreen: screenIn("never-opened"),
        preferences: new DevicePreferencesStore(),
        themeId: "paper",
      },
    });
    // Only visible in the blocked-pop-up fallback copy, but it is the URL the button uses.
    expect(body).toContain("Open game screen");
    expect(
      render(GameScreenPanel, {
        props: {
          view: hostStore().view,
          gameScreen: screenIn("never-opened"),
          preferences: new DevicePreferencesStore(),
          variant: "chip",
        },
      }).body,
    ).toContain("screen-chip");
  });

  it("keeps the state visible in the header in every phase, not only the lobby", () => {
    const store = hostStore();
    store.startGame();
    const body = render(HostConsole, {
      props: { store, gameScreen: screenIn("never-opened") },
    }).body;
    expect(body).toContain("screen-chip");
    expect(body).toContain("No game screen open");
  });

  it("mirror mode has nothing to open: this screen IS the game screen", () => {
    const body = consoleMarkup({ mirror: true, gameScreen: screenIn("never-opened") });
    // The mirrored layout is the display, with its dock - no setup panel, no open button.
    expect(body).toContain("Exit mirror");
    expect(body).not.toContain("Open game screen");
  });
});

describe("starting without a game screen", () => {
  it("warns rather than blocks - and does not nag before the host has pressed anything", () => {
    const body = consoleMarkup({ gameScreen: screenIn("never-opened") });
    expect(body).toContain("Start game");
    // The calm state: the game-screen panel already says what is missing (one place per fact),
    // so the start row stays quiet until the host actually presses it.
    expect(body).not.toContain("Start anyway");
    expect(body).not.toContain("No game screen is attached");
  });

  it("refuses an empty room with the reason attached to the button", () => {
    const body = render(HostConsole, { props: { store: hostStore({}, "empty") } }).body;
    expect(body).toContain("Nobody has joined yet");
    expect(body).toContain("disabled");
  });

  it("says nothing at all once a game screen is attached", () => {
    const body = consoleMarkup({ gameScreen: screenIn("open") });
    expect(body).not.toContain("Nobody has joined yet");
    expect(body).not.toContain("Start anyway");
  });
});

describe("what the console knows about connected displays", () => {
  it("renders the room's own census when the store can count it", () => {
    const store = hostStore();
    store.simSetConnections({ displays: 2, spectators: 3 });
    const body = render(HostConsole, { props: { store } }).body;
    expect(body).toContain("2 game screens connected");
    expect(body).toContain("displays connected to the room");
    // Spectators hold no seat, so they are counted from connections and named separately.
    expect(body).toContain("3 watching");
  });

  it("believes a display it never opened over its own empty window handle", () => {
    const store = hostStore();
    store.simSetConnections({ displays: 1 });
    const body = render(HostConsole, {
      props: { store, gameScreen: screenIn("never-opened") },
    }).body;
    expect(body).toContain("Game screen connected");
    expect(body).not.toContain("No game screen open");
  });

  it("falls back to its own window when the store cannot know (mock mode's isolated rooms)", () => {
    const view = { ...hostStore().view, connections: null };
    const { body } = render(GameScreenPanel, {
      props: { view, gameScreen: screenIn("open"), preferences: new DevicePreferencesStore() },
    });
    expect(body).toContain("Game screen open");
    expect(body).not.toContain("displays connected to the room");
  });

  it("answers 'who is here' with the names, and marks the phones that dropped", () => {
    const store = hostStore();
    const playerId = store.view.roster.players[0]?.playerId ?? "";
    store.simSetConnected(playerId, false);
    const { body } = render(HostRosterPanel, { props: { view: store.view } });
    expect(body).toContain("In the room");
    expect(body).toContain(store.view.roster.players[0]?.nickname ?? "");
    // A seat survives a dropped phone (A5) - "away" is health, never a removal.
    expect(body).toContain("away");
  });
});

describe("the join panel (C2 doors open)", () => {
  function joinPanel(props: Record<string, unknown> = {}): string {
    return render(JoinPanel, {
      props: { store: hostStore(), joinOrigin: "https://play.test", ...props },
    }).body;
  }

  it("is open in the lobby by default - the console has one job at that moment", () => {
    expect(consoleMarkup({})).toContain("How people join");
  });

  it("carries the code big, the QR, and the link, all three", () => {
    const body = joinPanel();
    expect(body).toContain(roomCode);
    expect(body).toContain("<svg");
    expect(body).toContain(`play.test/room/${roomCode}`);
    expect(body).toContain("room-code");
  });

  it("offers the share sheet and the clipboard as separate buttons", () => {
    const body = joinPanel();
    expect(body).toContain("Share link");
    expect(body).toContain("Copy link");
  });

  it("can be held up to the room, and stays the same element while it is", () => {
    const normal = joinPanel();
    expect(normal).toContain("Show fullscreen");
    const big = joinPanel({ expanded: true });
    expect(big).toContain("join-panel");
    expect(big).toContain("big");
    expect(big).toContain("Done");
    // Same panel, same content - a state change, not a second screen.
    expect(big).toContain(roomCode);
    expect(big).toContain("<svg");
  });

  it("draws a QR big enough to scan from a few feet, at both sizes", () => {
    // Source-level, like display-responsive.gate.test.ts: CSS does not resolve in an SSR render,
    // and a QR that is technically present but 40px wide is not a join path.
    const source = joinPanelSource;
    expect(source).toMatch(/\.qr-holder :global\(svg\) \{[^}]*width: min\(14rem/);
    expect(source).toMatch(/\.join-panel\.big \.qr-holder :global\(svg\) \{[^}]*width: min\(46vh/);
    // ...and the code is sized like a board value rather than like chrome.
    expect(source).toMatch(/\.join-panel\.big \.room-code \{[^}]*font-size: min\(22vh/);
  });
});

describe("streamer mode: the console is the host's own screen", () => {
  const streaming = { hideJoinCode: true };

  it("hides the code, the QR and the URL on the display, which is the shared surface", () => {
    const { body } = render(DisplayScreen, {
      props: {
        store: new LocalSimRoomStore({
          roomCode,
          role: "display",
          seed: "setup",
          settings: streaming,
        }),
        joinOrigin: "https://play.test",
      },
    });
    expect(body).not.toContain(roomCode);
    expect(body).not.toContain("<svg");
    expect(body).not.toContain("play.test/room");
  });

  it("KEEPS them on the console, and says they are not being broadcast", () => {
    // The opposite rule, deliberately: this console already shows every answer, so a room that
    // can read it can read those too - and a streaming host still has to admit latecomers.
    const { body } = render(JoinPanel, {
      props: { store: hostStore(streaming), joinOrigin: "https://play.test" },
    });
    expect(body).toContain(roomCode);
    expect(body).toContain("<svg");
    expect(body).toContain(`play.test/room/${roomCode}`);
    expect(body).toContain("Streamer mode");
    expect(body).toContain("Hidden on the game screen");
  });

  it("mirror mode inherits the DISPLAY's rule, because it renders the display", () => {
    const store = hostStore(streaming);
    const body = render(HostConsole, { props: { store, mirror: true } }).body;
    expect(body).not.toContain("How people join");
    expect(body).not.toContain("<svg");
  });
});
