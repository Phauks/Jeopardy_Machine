// The room-store seam contract, proven against the complete implementation (local-sim): a
// full game driven ONLY through RoomStore methods - the exact call surface the components
// use - from fixture lobby to game over. When the ws store is wired at reconcile, this suite
// re-runs against it behind a real DO (the M3 realtime tests own that half); the mock and
// the wire must satisfy the same assertions.
import { describe, expect, it } from "vitest";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";
import { buzzerStageFor, standingsFor, viewEntityForPlayer } from "#lib/room/room-view.ts";
import { fixtureRosterView } from "#lib/room/fixture-room.ts";
import type { RoomStore } from "#lib/room/room-store.ts";

const fixtureRoster = fixtureRosterView();

function hostStore(seed = "contract-test"): LocalSimRoomStore {
  return new LocalSimRoomStore({ roomCode: "TESTA", role: "host", seed });
}

// Drive to a judged-ready state: start, select a known NON-wager cell, arm, buzz as the
// given player. Wager cells in the fixture game: R1 (2,3), R2 (1,2) and (4,4).
function startAndPresent(store: LocalSimRoomStore, category = 0, row = 0): void {
  store.startGame();
  store.selectCell(category, row);
}

// Judge the whole final in the engine's enforced drama order (#33): batched entities in any
// order first, then the individual queue strictly by revealIndex.
function judgeAllFinal(store: LocalSimRoomStore, verdict: "correct" | "wrong"): void {
  let guard = 0;
  while (store.view.game?.phase === "final-reveal" && guard < 20) {
    const final = store.view.game.final;
    if (final === null) break;
    const nextBatched = final.batchedEntities.find(
      (entityId) => final.judged[entityId] === undefined,
    );
    const next = nextBatched ?? final.individualOrder[final.revealIndex];
    if (next === undefined) break;
    store.judgeEntity(next, verdict);
    guard += 1;
  }
}

describe("room-store contract: lobby and roster tier", () => {
  it("seeds the fixture room: 30 players, 6 teams, teams mode, no engine state yet", () => {
    const store = hostStore();
    expect(store.view.phase).toBe("lobby");
    expect(store.view.game).toBeNull();
    expect(store.view.teamsMode).toBe(true);
    expect(store.view.roster.players).toHaveLength(fixtureRoster.players.length);
    expect(store.view.roster.teams).toHaveLength(fixtureRoster.teams.length);
  });

  it("join creates a seat; team create makes the joiner its leader (A2)", () => {
    const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "player", seed: "join" });
    store.join({
      nickname: "Lorax",
      avatarId: "fish",
      accentId: "moss",
      buzzSoundId: "loon",
      team: { kind: "create", name: "Team Sequoia Two" },
    });
    const me = store.view.roster.players.find((entry) => entry.playerId === store.view.myPlayerId);
    expect(me?.nickname).toBe("Lorax");
    const myTeam = store.view.roster.teams.find((entry) => entry.teamId === me?.teamId);
    expect(myTeam?.name).toBe("Team Sequoia Two");
    expect(myTeam?.leaderPlayerId).toBe(me?.playerId);
  });

  it("refuses joining a locked team (protocol team-locked keeps the socket for a retry)", () => {
    const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "player", seed: "lock" });
    const lockedTeam = store.view.roster.teams.find((entry) => entry.locked);
    expect(lockedTeam).toBeDefined();
    store.join({
      nickname: "Nuisance",
      avatarId: null,
      accentId: null,
      buzzSoundId: null,
      team: { kind: "join", teamId: lockedTeam?.teamId ?? "" },
    });
    expect(store.view.myPlayerId).toBeNull();
  });

  it("post-join customization updates the personal tier; leader ops move the team tier", () => {
    const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "player", seed: "custom" });
    store.join({ nickname: "Newt", avatarId: null, accentId: null, buzzSoundId: null });
    store.updateIdentity({ nickname: "Newt Prime", buzzSoundId: "gong" });
    const me = store.view.roster.players.find((entry) => entry.playerId === store.view.myPlayerId);
    expect(me?.nickname).toBe("Newt Prime");
    expect(me?.buzzSoundId).toBe("gong");

    store.createTeam("The Newts");
    store.updateTeam({ colorId: "teal", buzzSoundId: "klaxon", locked: true });
    const team = store.view.roster.teams.find((entry) => entry.name === "The Newts");
    expect(team?.colorId).toBe("teal");
    expect(team?.buzzSoundId).toBe("klaxon");
    expect(team?.locked).toBe(true);
  });

  it("kick returns a member to team selection; handoff moves the crown", () => {
    const store = hostStore();
    const team = store.view.roster.teams[0];
    if (team === undefined) throw new Error("fixture team missing");
    const members = store.view.roster.players.filter((entry) => entry.teamId === team.teamId);
    const victim = members.find((entry) => entry.playerId !== team.leaderPlayerId);
    if (victim === undefined) throw new Error("fixture team has no non-leader member");
    store.kickFromTeam(victim.playerId);
    const kicked = store.view.roster.players.find((entry) => entry.playerId === victim.playerId);
    expect(kicked?.teamId).toBeNull();

    const successor = store.view.roster.players.find(
      (entry) => entry.teamId === team.teamId && entry.playerId !== team.leaderPlayerId,
    );
    if (successor === undefined) throw new Error("no successor available");
    store.handOffLeadership(successor.playerId);
    const updatedTeam = store.view.roster.teams.find((entry) => entry.teamId === team.teamId);
    expect(updatedTeam?.leaderPlayerId).toBe(successor.playerId);
  });

  it("leadership auto-passes to the longest-tenured member when the leader is kicked", () => {
    const store = hostStore();
    const team = store.view.roster.teams[0];
    if (team?.leaderPlayerId == null) throw new Error("fixture team/leader missing");
    store.kickFromRoom(team.leaderPlayerId);
    const updatedTeam = store.view.roster.teams.find((entry) => entry.teamId === team.teamId);
    expect(updatedTeam?.leaderPlayerId).not.toBeNull();
    expect(updatedTeam?.leaderPlayerId).not.toBe(team.leaderPlayerId);
  });
});

describe("room-store contract: game flow through the action layer", () => {
  it("startGame seats the whole roster: 6 team entities + 2 solo players", () => {
    const store = hostStore();
    store.startGame();
    const game = store.view.game;
    expect(store.view.phase).toBe("active");
    expect(game?.phase).toBe("awaiting-selection");
    expect(game?.entityOrder).toHaveLength(8);
    expect(Object.keys(game?.players ?? {})).toHaveLength(fixtureRoster.players.length);
  });

  it("plays a clue end to end: select, arm, buzz race, judge correct, score and control move", () => {
    const store = hostStore();
    startAndPresent(store);
    expect(store.view.game?.phase).toBe("reading");
    store.armBuzzers();
    expect(store.view.game?.phase).toBe("armed");
    store.simBuzzRace();
    expect(store.view.game?.phase).toBe("answering");
    const winner = store.view.game?.clue?.buzzWinner;
    expect(winner).not.toBeNull();
    store.judge("correct");
    const game = store.view.game;
    expect(game?.phase).toBe("awaiting-selection");
    expect(game?.scores[winner?.entityId ?? ""]).toBeGreaterThan(0);
    expect(game?.controlEntity).toBe(winner?.entityId);
    expect(store.view.lastJudged?.verdict).toBe("correct");
    expect(game?.boards[0]?.status[0]?.[0]).toBe("played");
  });

  it("wrong answers rebound; no takers closes the clue dead", () => {
    const store = hostStore();
    startAndPresent(store, 0, 1);
    store.armBuzzers();
    store.simBuzzRace();
    store.judge("wrong");
    // Rebound: the engine re-arms for the remaining entities.
    expect(store.view.game?.phase).toBe("armed");
    store.closeBuzzWindow();
    expect(store.view.game?.phase).toBe("awaiting-selection");
  });

  it("manual mode: host awards from the console with no buzzers involved", () => {
    const store = hostStore();
    startAndPresent(store, 1, 0);
    const entityId = store.view.game?.entityOrder[0];
    if (entityId === undefined) throw new Error("no entities");
    store.hostAward(entityId, "correct");
    expect(store.view.game?.scores[entityId]).toBeGreaterThan(0);
    expect(store.view.game?.phase).toBe("awaiting-selection");
  });

  it("wager cell: range surfaces, wager commits, single answerer judged", () => {
    const store = hostStore();
    store.startGame();
    // Control must exist for a wager cell to wager (engine rule); give it to entity 0.
    const first = store.view.game?.entityOrder[0];
    if (first === undefined) throw new Error("no entities");
    // Win a plain clue as p01's team first so control is deterministic.
    store.selectCell(0, 0);
    store.hostAward(first, "correct");
    store.selectCell(2, 3); // the R1 authored wager cell
    expect(store.view.game?.phase).toBe("wagering");
    const range = store.view.wagerRange;
    expect(range?.entityId).toBe(first);
    expect(range?.maximum).toBeGreaterThan(0);
    store.hostCommitWager(first, range?.maximum ?? 0);
    expect(store.view.game?.phase).toBe("wager-answering");
    store.judge("correct");
    expect(store.view.game?.scores[first]).toBe(200 + (range?.maximum ?? 0));
  });

  it("undo rewinds the last action; score override is first-class", () => {
    const store = hostStore();
    startAndPresent(store);
    store.armBuzzers();
    store.simBuzzRace();
    const winner = store.view.game?.clue?.buzzWinner?.entityId;
    store.judge("correct");
    const scored = store.view.game?.scores[winner ?? ""] ?? 0;
    expect(scored).toBeGreaterThan(0);
    store.undo();
    expect(store.view.game?.phase).toBe("answering");
    expect(store.view.game?.scores[winner ?? ""] ?? 0).toBe(0);

    store.judge("wrong");
    store.scoreSet(winner ?? "", 5000);
    expect(store.view.game?.scores[winner ?? ""]).toBe(5000);
    store.scoreAdjust(winner ?? "", -500);
    expect(store.view.game?.scores[winner ?? ""]).toBe(4500);
  });

  it("late join lands a seat mid-game with the fixture's match-lowest score rule (#43)", () => {
    const store = hostStore();
    startAndPresent(store);
    const first = store.view.game?.entityOrder[0];
    store.hostAward(first ?? "", "correct");
    store.join({ nickname: "Latecomer", avatarId: null, accentId: null, buzzSoundId: null });
    const seatId = store.view.myPlayerId;
    expect(seatId).not.toBeNull();
    expect(store.view.game?.players[seatId ?? ""]).toBeDefined();
    // match-lowest: everyone else still sits at 0, so the late joiner matches 0.
    expect(store.view.game?.scores[seatId ?? ""]).toBe(0);
  });

  it("reaches the final via end-round, collects wagers and answers, judges to game over", () => {
    const store = hostStore();
    store.startGame();
    // Give two entities scores so eligibility and standings are interesting.
    const [alpha, beta] = store.view.game?.entityOrder ?? [];
    if (alpha === undefined || beta === undefined) throw new Error("entities missing");
    store.scoreSet(alpha, 3000);
    store.scoreSet(beta, 1200);
    store.endRound();
    expect(store.view.game?.phase).toBe("round-break");
    store.proceed();
    store.endRound();
    store.proceed();
    expect(store.view.game?.phase).toBe("final-wagers");
    expect(store.view.finalWagerRanges.length).toBeGreaterThan(0);
    store.simCompleteFinal();
    expect(store.view.game?.phase).toBe("final-writing");
    store.simCompleteFinal();
    expect(store.view.game?.phase).toBe("final-reveal");
    judgeAllFinal(store, "wrong");
    expect(store.view.game?.phase).toBe("game-over");
    expect(store.view.phase).toBe("ended");
    const standings = standingsFor(store.view);
    expect(standings.length).toBe(8);
  });

  it("pause freezes pending timers without touching engine state", () => {
    const store = hostStore();
    startAndPresent(store);
    const phaseBefore = store.view.game?.phase;
    store.setPaused(true);
    expect(store.view.paused).toBe(true);
    expect(store.view.game?.phase).toBe(phaseBefore);
    store.setPaused(false);
    expect(store.view.paused).toBe(false);
  });
});

// A player-role store sharing the host's seed will not share a game (mock stores are
// isolated per tab); to exercise the phone stages we join a player INTO one store and use
// its own view - the store is role "player" so responses are redacted too.
function playerInGame(): { store: LocalSimRoomStore; now: () => number } {
  const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "player", seed: "stage" });
  store.join({ nickname: "Stagehand", avatarId: null, accentId: null, buzzSoundId: null });
  return { store, now: () => Date.now() };
}

describe("room-store contract: the buzzer stage derivation (A4 states table)", () => {
  it("walks waiting -> reading -> armed -> you-won -> judged", () => {
    const { store } = playerInGame();
    store.startGame();
    expect(buzzerStageFor(store.view, Date.now()).kind).toBe("waiting");
    store.selectCell(0, 0);
    expect(buzzerStageFor(store.view, Date.now()).kind).toBe("reading");
    store.armBuzzers();
    expect(buzzerStageFor(store.view, Date.now()).kind).toBe("armed");
    store.buzz();
    expect(store.view.myBuzz.status).toBe("won");
    expect(buzzerStageFor(store.view, Date.now()).kind).toBe("you-won");
    store.judge("correct");
    const judged = buzzerStageFor(store.view, Date.now());
    expect(judged.kind).toBe("judged");
    if (judged.kind === "judged") expect(judged.delta).toBeGreaterThan(0);
  });

  it("shows other-won when a different entity takes the buzz", () => {
    const { store } = playerInGame();
    store.startGame();
    store.selectCell(0, 0);
    store.armBuzzers();
    const rival = store.view.roster.players.find(
      (entry) => entry.playerId !== store.view.myPlayerId,
    );
    store.simBuzz(rival?.playerId ?? "");
    const stage = buzzerStageFor(store.view, Date.now());
    expect(stage.kind).toBe("other-won");
  });

  it("an early buzz shows the visible penalty ring (locked-out) once armed", () => {
    const { store } = playerInGame();
    store.startGame();
    store.selectCell(0, 1);
    store.buzz(); // reading phase: too soon
    expect(store.view.myBuzz.status).toBe("rejected");
    store.armBuzzers();
    const stage = buzzerStageFor(store.view, Date.now());
    expect(stage.kind).toBe("locked-out");
  });

  it("wager stages: the selector gets the pad, everyone else gets the announcement", () => {
    const { store } = playerInGame();
    store.startGame();
    const myEntity = viewEntityForPlayer(store.view, store.view.myPlayerId ?? "");
    // Deterministic control: my entity wins a plain clue, then selects the wager cell.
    store.selectCell(0, 0);
    store.hostAward(myEntity ?? "", "correct");
    store.selectCell(2, 3);
    const mine = buzzerStageFor(store.view, Date.now());
    expect(mine.kind).toBe("wager");
    if (mine.kind === "wager") {
      expect(mine.trueDoubleValue).toBe(mine.range.maximum);
    }
  });

  it("final stages: wager pad, typed answer with category, then reveal and game over", () => {
    const { store } = playerInGame();
    store.startGame();
    const myEntity = viewEntityForPlayer(store.view, store.view.myPlayerId ?? "");
    store.scoreSet(myEntity ?? "", 2000);
    // A second eligible entity keeps the final's wager/answer windows open after my commits.
    const rivalEntity = store.view.game?.entityOrder.find((entry) => entry !== myEntity);
    store.scoreSet(rivalEntity ?? "", 1000);
    store.endRound();
    expect(buzzerStageFor(store.view, Date.now()).kind).toBe("between-rounds");
    store.proceed();
    store.endRound();
    store.proceed();
    expect(buzzerStageFor(store.view, Date.now()).kind).toBe("final-wager");
    store.commitFinalWager(1000);
    const committed = buzzerStageFor(store.view, Date.now());
    if (committed.kind === "final-wager") expect(committed.committed).toBe(true);
    store.simCompleteFinal();
    const writing = buzzerStageFor(store.view, Date.now());
    expect(writing.kind).toBe("final-answer");
    store.submitFinalAnswer("What is a test?");
    store.simCompleteFinal();
    expect(buzzerStageFor(store.view, Date.now()).kind).toBe("final-reveal");
    judgeAllFinal(store, "correct");
    const over = buzzerStageFor(store.view, Date.now());
    expect(over.kind).toBe("game-over");
    if (over.kind === "game-over") expect(over.placement).not.toBeNull();
  });

  it("redacts responses from player-role content (mirror-mode data rule)", () => {
    const { store } = playerInGame();
    expect(store.view.content?.clueAt(0, 0, 0)?.response).toBeNull();
    const host = hostStore();
    expect(host.view.content?.clueAt(0, 0, 0)?.response).not.toBeNull();
  });
});

// Interface conformance: both implementations satisfy RoomStore at the type level. The ws
// stub is compile-checked only (its bodies throw until reconcile).
it("local-sim store satisfies the RoomStore interface", () => {
  const store: RoomStore = hostStore();
  expect(store.mode).toBe("local-sim");
});
