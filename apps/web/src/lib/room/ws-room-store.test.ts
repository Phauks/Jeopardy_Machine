// The ws store held to the SAME shape the local-sim store is held to (room-store.contract
// .test.ts): messages in, a RoomView out. Nothing here mocks the protocol - every frame the
// fake socket serves is a real one, parsed by parseRoomServerMessage inside the store, so a
// catalog change that this store has not learned fails here rather than at 11pm on game night.
import { describe, expect, it, vi } from "vitest";
import { defaultRoomSettings } from "@jeopardy/protocol/room/room-settings";
import { protocolVersion } from "@jeopardy/protocol/envelope";
import { createRoomStore, demoRoomCode, roomStoreModeFor } from "#lib/room/create-room-store.ts";
import { WsRoomStore } from "#lib/room/ws-room-store.svelte.ts";
import type { RoomSocketFactory, RoomSocketHandlers } from "#lib/room/room-socket.ts";
import type { RoomStore } from "#lib/room/room-store.ts";
import type { WsRoomStoreOptions } from "#lib/room/ws-room-store.svelte.ts";

const origin = "http://localhost:5173";
const roomCode = "BQKX7";

const settings = { ...defaultRoomSettings, title: "", hostLabel: "" };

function rosterEntry(playerId: string, nickname: string, teamId: string | null = null) {
  return {
    playerId,
    identity: { nickname, avatarId: "fox", accentId: "gold", buzzSoundId: "gong" },
    teamId,
    connected: true,
    joinedAt: 10,
  };
}

const emptyBoard = {
  rounds: [
    {
      categoryTitles: ["Firsts", "Seconds"],
      cellValues: [
        [100, 200],
        [100, 200],
      ],
    },
  ],
};

function snapshotFrame(overrides: Record<string, unknown> = {}) {
  return {
    type: "snapshot",
    stateVersion: 0,
    phase: "lobby",
    game: null,
    roster: { players: [], teams: [] },
    playerMode: "individuals" as const,
    board: emptyBoard,
    paused: false,
    clueContent: null,
    // The room's running countdowns as REMAINING ms (M6). Mandatory on the wire, because a
    // console reopening mid-clue had no other way to know how long the window had left.
    timers: [],
    ...overrides,
  };
}

type Harness = {
  store: WsRoomStore;
  sent: Record<string, unknown>[];
  urls: string[];
  closes: number[];
  open: () => void;
  serve: (payload: Record<string, unknown>) => void;
  drop: (code: number) => void;
  sockets: () => number;
};

function harness(options: Partial<WsRoomStoreOptions> = {}): Harness {
  const sent: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const closes: number[] = [];
  let handlers: RoomSocketHandlers | null = null;
  const connect: RoomSocketFactory = (url, incoming) => {
    urls.push(url);
    handlers = incoming;
    return {
      send: (data) => sent.push(JSON.parse(data) as Record<string, unknown>),
      close: (code) => closes.push(code ?? 1000),
    };
  };
  const store = new WsRoomStore({
    roomCode,
    role: "player",
    origin,
    connect,
    ...options,
  });
  return {
    store,
    sent,
    urls,
    closes,
    open: () => handlers?.onOpen(),
    serve: (payload) =>
      handlers?.onMessage(JSON.stringify({ version: protocolVersion, ...payload })),
    drop: (code) => handlers?.onClose(code),
    sockets: () => urls.length,
  };
}

describe("ws room store: the door", () => {
  it("dials the single origin and says nothing until the player asks to join", () => {
    const room = harness();
    expect(room.urls).toEqual([`ws://localhost:5173/room/${roomCode}/ws`]);
    room.open();
    // A phone on the pre-game screen is connected and seatless: the room hears from it when
    // somebody presses the button, not before.
    expect(room.sent).toHaveLength(0);
    expect(room.store.view.connection).toBe("connected");
    expect(room.store.view.myPlayerId).toBeNull();
  });

  it("joins with the whole character, omitting what was never chosen", () => {
    const room = harness();
    room.open();
    room.store.join({
      nickname: "Ada",
      avatarId: "fox",
      accentId: "moss",
      buzzSoundId: null,
      skinToneId: null,
      team: { kind: "create", name: "Team Sequoia" },
    });
    expect(room.sent[0]).toEqual({
      version: protocolVersion,
      type: "join",
      role: "player",
      nickname: "Ada",
      avatarId: "fox",
      accentId: "moss",
      team: { kind: "create", name: "Team Sequoia" },
      // No credential rides the url; the ones that exist ride their own message
      // (join-hand-off.ts).
    });
    // Absence is the protocol's "not chosen", and a skin tone especially is never guessed.
    expect(room.sent[0]).not.toHaveProperty("buzzSoundId");
    expect(room.sent[0]).not.toHaveProperty("skinToneId");
  });

  it("a host proves itself with the creation token, unprompted", () => {
    const room = harness({ role: "host", hostToken: "a".repeat(32) });
    room.open();
    expect(room.sent[0]).toMatchObject({ type: "join", role: "host", hostToken: "a".repeat(32) });
  });

  it("resumes instead of joining when this tab already holds a seat", () => {
    const room = harness({ sessionToken: "b".repeat(32) });
    room.open();
    expect(room.sent[0]).toMatchObject({ type: "resume", sessionToken: "b".repeat(32) });
  });

  it("treats an empty stored token as no seat at all", () => {
    // "" is what sessionStorage answers for a tab that never joined. Resuming with it earns a
    // malformed-frame error and - because the store thought it had resumed - the pending join
    // never went out. Found by the browser walk, held here.
    const room = harness({ sessionToken: "" });
    room.store.join({
      nickname: "Ada",
      avatarId: null,
      accentId: null,
      buzzSoundId: null,
      skinToneId: null,
    });
    room.open();
    expect(room.sent).toHaveLength(1);
    expect(room.sent[0]).toMatchObject({ type: "join", nickname: "Ada" });
  });

  it("hands the minted session token out for sessionStorage and takes the seat", () => {
    const tokens: (string | null)[] = [];
    const room = harness({ onSessionToken: (token) => tokens.push(token) });
    room.open();
    room.serve({
      type: "welcome",
      roomCode,
      role: "player",
      playerId: "p-1",
      sessionToken: "c".repeat(32),
    });
    expect(tokens).toEqual(["c".repeat(32)]);
    expect(room.store.view.myPlayerId).toBe("p-1");
  });
});

describe("ws room store: messages become a view", () => {
  it("takes roster, seating rule, board and settings from the snapshot", () => {
    const room = harness();
    room.open();
    room.serve(
      snapshotFrame({
        phase: "lobby",
        playerMode: "teams" as const,
        roster: {
          players: [rosterEntry("p-1", "Ada", "t-1")],
          teams: [
            {
              teamId: "t-1",
              name: "Sequoia",
              colorId: "moss",
              buzzSoundId: "horn",
              leaderPlayerId: "p-1",
              locked: false,
            },
          ],
        },
      }),
    );
    room.serve({ type: "room-settings", settings: { ...settings, hideJoinCode: true }, at: 1 });

    const view = room.store.view;
    expect(view.playerMode).toBe("teams");
    expect(view.roster.players[0]).toMatchObject({
      playerId: "p-1",
      nickname: "Ada",
      avatarId: "fox",
      teamId: "t-1",
      // Absent on the wire; null on the view, which renders as the pack's own colours.
      skinToneId: null,
    });
    expect(view.roster.teams[0]?.leaderPlayerId).toBe("p-1");
    expect(view.settings.hideJoinCode).toBe(true);
    expect(view.content?.categoryTitles[0]).toEqual(["Firsts", "Seconds"]);
    expect(view.content?.cellValues[0]?.[1]).toEqual([100, 200]);
  });

  it("admits it has not heard this room's settings, and never counts an audience it was not given", () => {
    // The two "say nothing rather than something plausible" fields, together because they are
    // the same rule: a console that draws protocol defaults as this room's settings, or "0
    // watching" for a room nobody has counted, has told the host something untrue about their
    // own room (owner, 2026-08-17).
    const room = harness();
    room.open();
    expect(room.store.view.settingsKnown).toBe(false);
    expect(room.store.view.roster.spectatorCount).toBeNull();

    // A roster without the optional count leaves it unknown; the shell settings stay flagged.
    room.serve(snapshotFrame());
    expect(room.store.view.roster.spectatorCount).toBeNull();
    expect(room.store.view.settingsKnown).toBe(false);

    room.serve({
      type: "roster",
      roster: { players: [rosterEntry("p-1", "Ada")], teams: [], spectatorCount: 4 },
    });
    expect(room.store.view.roster.spectatorCount).toBe(4);
    // Zero is a REPORTED fact and must survive as one, distinct from "not reported".
    room.serve({
      type: "roster",
      roster: { players: [rosterEntry("p-1", "Ada")], teams: [], spectatorCount: 0 },
    });
    expect(room.store.view.roster.spectatorCount).toBe(0);

    room.serve({ type: "room-settings", settings: { ...settings, maxPlayers: 24 }, at: 3 });
    expect(room.store.view.settingsKnown).toBe(true);
    expect(room.store.view.settings.maxPlayers).toBe(24);
  });

  it("folds an event batch and takes the state it carries", () => {
    const room = harness();
    room.open();
    room.serve({
      type: "welcome",
      roomCode,
      role: "player",
      playerId: "p-1",
      sessionToken: "c".repeat(32),
    });
    room.serve(snapshotFrame());
    room.serve({
      type: "event",
      stateVersion: 1,
      game: { phase: "armed", scores: {}, entityOrder: ["p-1"] },
      events: [
        { type: "game-started", entityCount: 1 },
        { type: "buzzers-armed", rebound: false, armedAt: 1000 },
        { type: "timer-set", kind: "buzz-window", durationMs: 5000, at: 1000 },
      ],
    });

    const view = room.store.view;
    // The room's phase follows the engine's, which is what moves every phone off pre-game.
    expect(view.phase).toBe("active");
    expect(view.game?.phase).toBe("armed");
    expect(view.pendingTimers.map((timer) => timer.kind)).toEqual(["buzz-window"]);
    expect(view.myBuzz.status).toBe("idle");
  });

  it("prunes timer hints the new phase cannot be waiting on", () => {
    const room = harness();
    room.open();
    room.serve(snapshotFrame());
    room.serve({
      type: "event",
      stateVersion: 1,
      game: { phase: "armed" },
      events: [{ type: "timer-set", kind: "buzz-window", durationMs: 5000, at: 1 }],
    });
    expect(room.store.view.pendingTimers).toHaveLength(1);
    room.serve({
      type: "event",
      stateVersion: 2,
      game: { phase: "awaiting-selection" },
      events: [{ type: "clue-finished", resolution: "correct", reveal: null }],
    });
    expect(room.store.view.pendingTimers).toHaveLength(0);
  });

  it("resolves the room-audible buzz from the message, and only my own win rings my phone", () => {
    const heard: (string | null)[] = [];
    const room = harness({ onBuzzWon: (buzz) => heard.push(buzz.buzzSoundId) });
    room.open();
    room.serve({
      type: "welcome",
      roomCode,
      role: "player",
      playerId: "p-1",
      sessionToken: "c".repeat(32),
    });
    room.serve(snapshotFrame());

    room.serve({
      type: "buzz-won",
      stateVersion: 1,
      playerId: "p-2",
      entityId: "t-9",
      teamId: "t-9",
      buzzSoundId: "team-horn",
      at: 5,
    });
    expect(heard).toEqual(["team-horn"]);
    expect(room.store.view.myBuzz.status).toBe("idle");

    room.serve({
      type: "buzz-won",
      stateVersion: 2,
      playerId: "p-1",
      entityId: "p-1",
      teamId: null,
      buzzSoundId: "gong",
      at: 6,
    });
    expect(room.store.view.myBuzz.status).toBe("won");
  });

  it("shows the personal buzz rejection with its penalty deadline", () => {
    const room = harness();
    room.open();
    room.serve(snapshotFrame());
    room.serve({ type: "buzz-rejected", reason: "early-lockout", lockedUntil: 9999 });
    expect(room.store.view.myBuzz).toEqual({
      status: "rejected",
      reason: "early-lockout",
      lockedUntil: 9999,
    });
  });

  it("keeps the open clue's words per role, and never invents a cell it was not told about", () => {
    const room = harness();
    room.open();
    room.serve(snapshotFrame());
    room.serve({
      type: "clue-content",
      content: {
        target: { kind: "cell", roundIndex: 0, category: 1, row: 2 },
        category: "Seconds",
        prompt: { text: "This is the clue" },
        // Players are never sent an answer; the field arrives null rather than absent.
        answer: null,
      },
    });
    expect(room.store.view.content?.clueAt(0, 1, 2)).toEqual({
      categoryTitle: "Seconds",
      prompt: "This is the clue",
      // A words-only clue carries no media, and the store says so with null rather than
      // leaving the field off - a surface must never have to tell "absent" from "none".
      media: null,
      response: null,
      responseMedia: null,
    });
    expect(room.store.view.content?.clueAt(0, 0, 0)).toBeNull();

    // The room resolves media before it sends it, and the store passes the descriptor straight
    // through: a client holds no document, so any lookup here would be a guess.
    room.serve({
      type: "clue-content",
      content: {
        target: { kind: "cell", roundIndex: 0, category: 1, row: 3 },
        category: "Seconds",
        prompt: {
          text: "Name this bird",
          media: {
            mediaId: "0198f00d-0002-7000-8000-000000000211",
            kind: "audio",
            mime: "audio/ogg",
            alt: "A short birdsong clip",
            url: "https://media.test/birdsong.ogg",
          },
        },
        answer: null,
      },
    });
    expect(room.store.view.content?.clueAt(0, 1, 3)?.media).toMatchObject({
      kind: "audio",
      url: "https://media.test/birdsong.ogg",
      alt: "A short birdsong clip",
    });
  });

  it("reflects the host's freeze", () => {
    const room = harness();
    room.open();
    room.serve(snapshotFrame());
    room.serve({ type: "paused", paused: true, at: 3 });
    expect(room.store.view.paused).toBe(true);
  });
});

describe("ws room store: gaps and refusals", () => {
  it("asks for a sync when a state version jumps, and stays quiet when it does not", () => {
    const room = harness();
    room.open();
    room.serve(snapshotFrame({ stateVersion: 4 }));
    room.serve({
      type: "event",
      stateVersion: 5,
      game: null,
      events: [{ type: "round-started", roundIndex: 0 }],
    });
    expect(room.sent.filter((frame) => frame["type"] === "sync")).toHaveLength(0);

    room.serve({
      type: "event",
      stateVersion: 9,
      game: null,
      events: [{ type: "round-started", roundIndex: 1 }],
    });
    expect(room.sent.filter((frame) => frame["type"] === "sync")).toHaveLength(1);
  });

  it("does not mistake a buzz-won for a missed batch (they share one version)", () => {
    const room = harness();
    room.open();
    room.serve(snapshotFrame({ stateVersion: 1 }));
    room.serve({
      type: "buzz-won",
      stateVersion: 2,
      playerId: "p-2",
      entityId: "p-2",
      teamId: null,
      buzzSoundId: null,
      at: 1,
    });
    room.serve({
      type: "event",
      stateVersion: 2,
      game: null,
      events: [{ type: "answers-open", at: 1 }],
    });
    expect(room.sent.filter((frame) => frame["type"] === "sync")).toHaveLength(0);
  });

  it("carries the refusal REASON, not a sentence, and keeps the socket for a team retry", () => {
    const room = harness();
    room.open();
    room.store.joinTeam("t-9");
    room.serve({ type: "refused", reason: "team-locked" });
    expect(room.store.view.refusal?.reason).toBe("team-locked");
    expect(room.store.view.connection).toBe("connected");

    // Tapping another card clears the message: it was about that team, not about this phone.
    room.store.joinTeam("t-2");
    expect(room.store.view.refusal).toBeNull();
  });

  it("drops a seat token the room no longer recognises, so the next dial is a fresh join", () => {
    const tokens: (string | null)[] = [];
    const room = harness({
      sessionToken: "b".repeat(32),
      onSessionToken: (token) => tokens.push(token),
    });
    room.open();
    room.serve({ type: "refused", reason: "bad-session-token" });
    expect(room.store.view.refusal?.reason).toBe("bad-session-token");
    expect(room.store.view.myPlayerId).toBeNull();
    expect(tokens).toEqual([null]);
  });

  it("shows the polite screen when the host ends the room, and stops reconnecting", () => {
    vi.useFakeTimers();
    try {
      const room = harness({ reconnectDelaysMs: [10] });
      room.open();
      room.serve(snapshotFrame());
      room.serve({ type: "room-closed", reason: "host-closed" });
      room.drop(4000);
      vi.advanceTimersByTime(1000);
      expect(room.store.view.connection).toBe("closed");
      expect(room.store.view.phase).toBe("ended");
      expect(room.sockets()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never comes back after a 44xx - the room already said no", () => {
    vi.useFakeTimers();
    try {
      const room = harness({ reconnectDelaysMs: [10] });
      room.open();
      room.serve({ type: "refused", reason: "room-full" });
      room.drop(4409);
      vi.advanceTimersByTime(1000);
      expect(room.store.view.refusal?.reason).toBe("room-full");
      expect(room.store.view.connection).toBe("closed");
      expect(room.sockets()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ws room store: reconnection restores the screen", () => {
  it("backs off, re-dials, and resumes the same seat", () => {
    vi.useFakeTimers();
    try {
      const room = harness({ reconnectDelaysMs: [100, 400] });
      room.open();
      room.store.join({
        nickname: "Ada",
        avatarId: null,
        accentId: null,
        buzzSoundId: null,
        skinToneId: null,
      });
      room.serve({
        type: "welcome",
        roomCode,
        role: "player",
        playerId: "p-1",
        sessionToken: "c".repeat(32),
      });
      room.serve(snapshotFrame({ roster: { players: [rosterEntry("p-1", "Ada")], teams: [] } }));

      // The venue's Wi-Fi hiccups.
      room.drop(1006);
      expect(room.store.view.connection).toBe("reconnecting");
      expect(room.sockets()).toBe(1);

      vi.advanceTimersByTime(99);
      expect(room.sockets()).toBe(1);
      vi.advanceTimersByTime(1);
      expect(room.sockets()).toBe(2);

      room.open();
      // Resume, not join: the same seat, the same nickname, the same team.
      expect(room.sent.at(-1)).toMatchObject({ type: "resume", sessionToken: "c".repeat(32) });
      room.serve({
        type: "welcome",
        roomCode,
        role: "player",
        playerId: "p-1",
        sessionToken: "c".repeat(32),
      });
      room.serve(
        snapshotFrame({
          stateVersion: 3,
          phase: "active",
          game: { phase: "reading" },
          roster: { players: [rosterEntry("p-1", "Ada")], teams: [] },
        }),
      );
      expect(room.store.view.connection).toBe("connected");
      expect(room.store.view.myPlayerId).toBe("p-1");
      expect(room.store.view.game?.phase).toBe("reading");
    } finally {
      vi.useRealTimers();
    }
  });

  it("walks the backoff ladder and stops dialling once the surface is destroyed", () => {
    vi.useFakeTimers();
    try {
      const room = harness({ reconnectDelaysMs: [100, 400] });
      room.open();
      room.drop(1006);
      vi.advanceTimersByTime(100);
      expect(room.sockets()).toBe(2);
      room.drop(1006);
      // Second rung, not the first: a room that keeps refusing to come back is given room.
      vi.advanceTimersByTime(399);
      expect(room.sockets()).toBe(2);
      vi.advanceTimersByTime(1);
      expect(room.sockets()).toBe(3);

      room.store.destroy();
      room.drop(1006);
      vi.advanceTimersByTime(5000);
      expect(room.sockets()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ws room store: the client half of buzz latency compensation", () => {
  // docs/decisions/2026-08-17-buzz-latency-compensation.md "What clients owe". Every one of
  // these is silent when it breaks: the room falls back to arrival order and nothing on any
  // screen says the race stopped being about thumbs.
  function armed(now: () => number): Harness {
    const room = harness({ now });
    room.open();
    room.serve({
      type: "welcome",
      roomCode,
      role: "player",
      playerId: "p-1",
      sessionToken: "c".repeat(32),
    });
    room.serve(snapshotFrame());
    room.sent.length = 0;
    return room;
  }

  it("acks an arming as its very first act, because the reply IS the measurement", () => {
    let clock = 1000;
    const room = armed(() => clock);
    room.serve({
      type: "arm-window",
      arm: { armId: 4, at: 900, compensationMs: 250, rebound: false },
    });
    // FIRST frame out, not merely one of them: the server times its own broadcast against this
    // reply, so anything sent ahead of it would be charged to this phone as latency.
    expect(room.sent[0]).toEqual({ version: protocolVersion, type: "arm-ack", armId: 4 });
    expect(room.sent).toHaveLength(1);
    // The arming is on the view, and NOT yet painted - nothing has reached a screen.
    expect(room.store.view.arming).toEqual({
      armId: 4,
      compensationMs: 250,
      rebound: false,
      paintedAt: null,
    });
  });

  it("measures elapsed from the PAINT, not from the moment the frame arrived", () => {
    let clock = 1000;
    const room = armed(() => clock);
    room.serve({
      type: "arm-window",
      arm: { armId: 4, at: 900, compensationMs: 250, rebound: false },
    });
    // 80ms of this device's own work between reading the frame and showing the hot button.
    // That is not reaction time and must not be billed as any.
    clock = 1080;
    room.store.markArmedPainted(4);
    expect(room.store.view.arming?.paintedAt).toBe(1080);
    clock = 1300;
    room.store.buzz();
    expect(room.sent.at(-1)).toEqual({
      version: protocolVersion,
      type: "action",
      action: { type: "buzz" },
      timing: { armId: 4, elapsedMs: 220 },
    });
    // The presser's own confirmation does not wait for the room's verdict, whatever the
    // compensation window is holding.
    expect(room.store.view.myBuzz).toEqual({ status: "pending", at: 1300 });
  });

  it("keeps the FIRST paint as t0 and ignores a paint for another arming", () => {
    let clock = 1000;
    const room = armed(() => clock);
    room.serve({
      type: "arm-window",
      arm: { armId: 4, at: 900, compensationMs: 250, rebound: false },
    });
    room.store.markArmedPainted(4);
    // A re-render, or the buzzer screen's coarse clock ticking - it must not move t0 forward
    // under a player who has been looking at a hot button for half a second.
    clock = 1500;
    room.store.markArmedPainted(4);
    room.store.markArmedPainted(9);
    expect(room.store.view.arming?.paintedAt).toBe(1000);
  });

  it("sends NO claim rather than a wrong one when nothing was painted", () => {
    // The un-wired case the decision doc promises is safe: an arming this surface never showed
    // (or no arming at all) produces a bare buzz, which the room ranks by arrival - exactly
    // the pre-M6 behaviour, never a penalty.
    const room = armed(() => 1000);
    room.store.buzz();
    expect(room.sent.at(-1)).toEqual({
      version: protocolVersion,
      type: "action",
      action: { type: "buzz" },
    });
    room.serve({
      type: "arm-window",
      arm: { armId: 6, at: 900, compensationMs: 0, rebound: true },
    });
    room.store.buzz();
    expect(room.sent.at(-1)).not.toHaveProperty("timing");
  });

  it("renders the room's live countdowns from the snapshot, and forgets the arming with it", () => {
    // C6: a console reopened mid-answer, or a phone that slept through the arm. `timer-set`
    // went out while it was away, so the snapshot's remaining-ms is the only source there is.
    let clock = 5000;
    const room = harness({ now: () => clock });
    room.open();
    room.serve({
      type: "arm-window",
      arm: { armId: 4, at: 900, compensationMs: 250, rebound: false },
    });
    room.serve(
      snapshotFrame({
        phase: "active",
        game: { phase: "answering" },
        timers: [
          { kind: "answer-window", remainingMs: 3200 },
          { kind: "round-time-limit", remainingMs: 900_000 },
          // A window this phase cannot be waiting on, and a kind this build does not know:
          // neither may reach a screen as a countdown nobody can explain.
          { kind: "wager-entry", remainingMs: 4000 },
          { kind: "quantum-flux", remainingMs: 50 },
        ],
      }),
    );
    expect(room.store.view.pendingTimers).toEqual([
      { kind: "answer-window", durationMs: 3200, firesAt: 8200 },
      { kind: "round-time-limit", durationMs: 900_000, firesAt: 905_000 },
    ]);
    // The arming resets with the rest of the ephemeral layer; the room re-sends `arm-window`
    // to a connection that resumed into an open one, so it is measured afresh.
    expect(room.store.view.arming).toBeNull();
  });
});

describe("ws room store: what the surfaces send", () => {
  function joined(): Harness {
    const room = harness();
    room.open();
    room.serve({
      type: "welcome",
      roomCode,
      role: "player",
      playerId: "p-1",
      sessionToken: "c".repeat(32),
    });
    room.serve(snapshotFrame());
    room.sent.length = 0;
    return room;
  }

  it("relays engine actions with no timestamp and no actor - the room stamps both", () => {
    const room = joined();
    room.store.buzz();
    expect(room.sent.at(-1)).toEqual({
      version: protocolVersion,
      type: "action",
      action: { type: "buzz" },
    });
    // The press shows immediately; the room's verdict replaces it a round trip later.
    expect(room.store.view.myBuzz.status).toBe("pending");

    room.store.selectCell(2, 3);
    expect(room.sent.at(-1)).toMatchObject({
      action: { type: "select-cell", category: 2, row: 3 },
    });
    room.store.judge("correct");
    expect(room.sent.at(-1)).toMatchObject({ action: { type: "judge", verdict: "correct" } });
    room.store.commitWager(400);
    expect(room.sent.at(-1)).toMatchObject({ action: { type: "commit-wager", amount: 400 } });
  });

  it("sends the room verbs as ROOM messages, not as engine actions", () => {
    const room = joined();
    room.store.setPaused(true);
    expect(room.sent.at(-1)).toEqual({ version: protocolVersion, type: "set-pause", paused: true });
    room.store.expireTimer("buzz-window");
    expect(room.sent.at(-1)).toEqual({ version: protocolVersion, type: "expire-timer" });
    room.store.updateRoomSettings({ hideJoinCode: true });
    expect(room.sent.at(-1)).toEqual({
      version: protocolVersion,
      type: "update-room-settings",
      settings: { hideJoinCode: true },
    });
  });

  it("covers the roster tier: identity, teams, and the host's supremacy over both", () => {
    const room = joined();
    room.store.updateIdentity({ nickname: "Ada Prime", skinToneId: null });
    expect(room.sent.at(-1)).toMatchObject({
      type: "identity-update",
      nickname: "Ada Prime",
      skinToneId: null,
    });
    room.store.createTeam("The Newts");
    expect(room.sent.at(-1)).toMatchObject({ type: "team-create", name: "The Newts" });
    room.store.joinTeam("t-2");
    expect(room.sent.at(-1)).toMatchObject({ type: "team-join", teamId: "t-2" });
    room.store.leaveTeam();
    expect(room.sent.at(-1)).toMatchObject({ type: "team-leave" });
    // Leaders omit the team id; the host must name the team it is overriding.
    room.store.updateTeam({ locked: true });
    expect(room.sent.at(-1)).toEqual({
      version: protocolVersion,
      type: "team-update",
      locked: true,
    });
    room.store.updateTeam({ name: "Renamed" }, "t-4");
    expect(room.sent.at(-1)).toMatchObject({ type: "team-update", name: "Renamed", teamId: "t-4" });
    room.store.kickFromTeam("p-7");
    expect(room.sent.at(-1)).toMatchObject({ type: "team-kick", playerId: "p-7" });
    room.store.handOffLeadership("p-7");
    expect(room.sent.at(-1)).toMatchObject({ type: "team-handoff", playerId: "p-7" });
    room.store.renamePlayer("p-7", "Grace");
    expect(room.sent.at(-1)).toMatchObject({ type: "rename-player", playerId: "p-7" });
    room.store.kickFromRoom("p-7");
    expect(room.sent.at(-1)).toMatchObject({ type: "kick-player", playerId: "p-7" });
    // Seating SOMEBODY ELSE rides the same message with the host-only `playerId` - the one
    // roster power the console review had to add to the protocol (client-messages.ts).
    room.store.assignPlayerToTeam("p-7", "t-2");
    expect(room.sent.at(-1)).toMatchObject({
      type: "team-join",
      teamId: "t-2",
      playerId: "p-7",
    });
  });

  it("picks the right answer action for the phase it is in", () => {
    const room = joined();
    room.serve({ type: "event", stateVersion: 1, game: { phase: "all-answering" }, events: [] });
    room.store.submitFinalAnswer("what is a test");
    expect(room.sent.at(-1)).toMatchObject({
      action: { type: "submit-typed-answer", text: "what is a test" },
    });
    room.serve({ type: "event", stateVersion: 2, game: { phase: "final-writing" }, events: [] });
    room.store.submitFinalAnswer("what is a test");
    expect(room.sent.at(-1)).toMatchObject({
      action: { type: "submit-final-answer", text: "what is a test" },
    });
  });
});

describe("which store a room gets", () => {
  it("gives real codes the socket and the demo code the simulation", () => {
    expect(roomStoreModeFor(roomCode)).toBe("ws");
    expect(roomStoreModeFor(demoRoomCode)).toBe("local-sim");
    expect(roomStoreModeFor(demoRoomCode.toLowerCase())).toBe("local-sim");
    // The dev override, for reviewing a real room's URL against fixture material.
    expect(roomStoreModeFor(roomCode, true)).toBe("local-sim");
  });

  it("builds each one without dialling anything a test did not ask for", () => {
    const demo: RoomStore = createRoomStore({ roomCode: demoRoomCode, role: "host" });
    expect(demo.mode).toBe("local-sim");
    expect(demo.view.roster.players.length).toBeGreaterThan(0);

    const dialled: string[] = [];
    const real: RoomStore = createRoomStore({
      roomCode,
      role: "display",
      origin,
      connect: (url) => {
        dialled.push(url);
        return { send: () => {}, close: () => {} };
      },
    });
    expect(real.mode).toBe("ws");
    expect(dialled).toEqual([`ws://localhost:5173/room/${roomCode}/ws`]);
    // Same VIEW from both, field for field - which is the entire point of the seam: a surface
    // reads one shape and never learns which store it is looking at.
    expect(Object.keys(real.view).toSorted()).toEqual(Object.keys(demo.view).toSorted());
    real.destroy();
    demo.destroy();
  });
});
