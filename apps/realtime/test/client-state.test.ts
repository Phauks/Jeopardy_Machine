// What a STATEFUL client is handed - the half of the protocol the M4 reconcile needed
// (apps/web/src/lib/room/ws-room-store.svelte.ts).
//
// The bots exercise the protocol as reactors: they see `buzzers-armed` and press. A display or
// a host console is not a reactor - it renders the room, so it needs the board's words, the
// room's seating rule, and the engine state after every transition. This suite holds the three
// answers the DO now gives it, because each one was missing when the surfaces were wired:
//
// - the snapshot's `board` (category titles + face values; the engine's state carries neither)
// - the snapshot's `teamsMode` (a rule-set fact no client can derive from an empty lobby)
// - the event batch's `game` (events are narration; nothing else on the wire carries state)
import { describe, expect, it } from "vitest";
import { connectBot, connectHost, initializeRoom, instantBot, uniqueCode } from "./helpers.ts";
import { authoredGame } from "./authored-game.ts";
import type { CreateRoomRequestInput } from "@jeopardy/protocol/room/create";
import type { GameState } from "@jeopardy/engine/state";

const teamsGame: CreateRoomRequestInput["game"] = {
  kind: "compact",
  rounds: [{ columns: 3, rows: 3 }],
  preset: "casual-party",
  overrides: {
    teams: { playerMode: "teams" },
    wagers: { countRoundOne: 0, countRoundTwo: 0 },
  },
  hasFinalClue: false,
};

describe("the snapshot carries the room's static facts", () => {
  it("ships the board's titles and values so a display has something to paint", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, authoredGame, "board-material");
    const host = await connectHost(code, hostToken);
    const snapshot = await host.waitFor("snapshot");

    expect(snapshot.board.rounds).toHaveLength(1);
    expect(snapshot.board.rounds[0]?.categoryTitles).toEqual([
      "Category 0",
      "Category 1",
      "Category 2",
    ]);
    // 3x3 tv ladder at multiplier 1: values ascend down each column, and every column agrees.
    const values = snapshot.board.rounds[0]?.cellValues ?? [];
    expect(values).toHaveLength(3);
    expect(values[0]).toEqual(values[2]);
    expect(values[0]?.[0]).toBeLessThan(values[0]?.[2] ?? 0);
  });

  it("says how the room seats people - a lobby's empty team record cannot", async () => {
    const individualsCode = uniqueCode();
    const individuals = await initializeRoom(individualsCode, undefined, "seating-solo");
    const soloHost = await connectHost(individualsCode, individuals.hostToken);
    expect((await soloHost.waitFor("snapshot")).teamsMode).toBe(false);

    const teamsCode = uniqueCode();
    const teams = await initializeRoom(teamsCode, teamsGame, "seating-teams");
    const teamsHost = await connectHost(teamsCode, teams.hostToken);
    const snapshot = await teamsHost.waitFor("snapshot");
    expect(snapshot.teamsMode).toBe(true);
    // Nothing else on the wire says it: the engine has met nobody yet.
    expect(Object.keys((snapshot.game as GameState).teams)).toHaveLength(0);
  });

  it("a compact room reports empty titles rather than inventing any", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "compact-board");
    const host = await connectHost(code, hostToken);
    const snapshot = await host.waitFor("snapshot");
    expect(snapshot.board.rounds[0]?.categoryTitles).toEqual(["", "", ""]);
    expect(snapshot.board.rounds[0]?.cellValues[0]).toHaveLength(3);
  });
});

describe("every event batch carries the state it produced", () => {
  it("keeps a display's state current without a single sync round trip", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "event-state");
    const host = await connectHost(code, hostToken);
    await connectBot(code, instantBot("Ada"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);

    host.sendAction({ type: "start-game" });
    const started = await host.waitFor("event", (message) =>
      (message.events as { type: string }[]).some((e) => e.type === "game-started"),
    );
    expect((started.game as GameState).phase).toBe("awaiting-selection");

    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    const presented = await host.waitFor("event", (message) =>
      (message.events as { type: string }[]).some((e) => e.type === "clue-presented"),
    );
    const state = presented.game as GameState;
    expect(state.phase).toBe("reading");
    expect(state.clue).toMatchObject({ category: 0, row: 0 });
    // The recovery internals are emptied, exactly as they are in a snapshot.
    expect(state.actionLog).toEqual([]);
    expect(state.rngState).toBe(0);
  });

  it("redacts that state per role: a phone never receives wager positions", async () => {
    const code = uniqueCode();
    const wagerGame: CreateRoomRequestInput["game"] = {
      kind: "compact",
      rounds: [{ columns: 3, rows: 3 }],
      preset: "casual-party",
      overrides: { wagers: { countRoundOne: 1 } },
      hasFinalClue: false,
    };
    const { hostToken } = await initializeRoom(code, wagerGame, "event-redaction");
    const host = await connectHost(code, hostToken);
    const phone = await connectBot(code, instantBot("Grace"));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);

    host.sendAction({ type: "start-game" });
    const hostView = await host.waitFor("event", (message) =>
      (message.events as { type: string }[]).some((e) => e.type === "game-started"),
    );
    const phoneView = await phone.waitFor(
      (message) =>
        message.type === "event" &&
        (message.events as { type: string }[]).some((e) => e.type === "game-started"),
    );
    if (phoneView.type !== "event") throw new Error("wrong message type");

    expect((hostView.game as GameState).boards[0]?.wagerCells).toHaveLength(1);
    expect((phoneView.game as GameState).boards[0]?.wagerCells).toHaveLength(0);
  });
});

describe("personal identity survives the round trip", () => {
  it("stores the skin tone from join and from a later edit, and never invents one", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, undefined, "skin-tone");
    const host = await connectHost(code, hostToken);

    const chose = await connectBot(code, { nickname: "Toned", seed: "tone-a" });
    chose.sendMessage({ type: "identity-update", skinToneId: "tone-4" });
    const withTone = await host.waitFor("roster", (message) =>
      message.roster.players.some((entry) => entry.identity.skinToneId === "tone-4"),
    );
    expect(withTone.roster.players[0]?.identity.skinToneId).toBe("tone-4");

    // Explicit null means "back to the pack's own colors" and must land as null, not as absent.
    chose.sendMessage({ type: "identity-update", skinToneId: null });
    const cleared = await host.waitFor("roster", (message) =>
      message.roster.players.some((entry) => entry.identity.skinToneId === null),
    );
    expect(cleared.roster.players[0]?.identity.skinToneId).toBeNull();

    // A join that never mentioned a tone leaves the field ABSENT - nothing guesses one.
    const untouched = await connectBot(code, { nickname: "Neutral", seed: "tone-b" });
    const roster = await host.waitFor("roster", (message) => message.roster.players.length === 2);
    const entry = roster.roster.players.find(
      (candidate) => candidate.playerId === untouched.playerId,
    );
    expect(entry?.identity.skinToneId).toBeUndefined();
  });
});
