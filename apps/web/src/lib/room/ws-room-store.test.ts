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

const settings = { ...defaultRoomSettings, entry: "open" as const, title: "", hostLabel: "" };

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
    teamsMode: false,
    board: emptyBoard,
    paused: false,
    clueContent: null,
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
    const room = harness({ password: "hunter22" });
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
      // The password rides the MESSAGE, never the url (join-hand-off.ts).
      password: "hunter22",
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
        teamsMode: true,
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
    expect(view.teamsMode).toBe(true);
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
      response: null,
    });
    expect(room.store.view.content?.clueAt(0, 0, 0)).toBeNull();
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
