// The team tier (user-flows "Teams & leadership"): lobby-fluid membership, leader-only
// customization, kick/handoff, the lock, leader-disconnect succession after the grace, and
// the team-scoped buzz sound on the room's buzz-won message (the double-confirmation
// directive).
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import {
  connectBot,
  connectHost,
  initializeRoom,
  instantBot,
  roomStub,
  uniqueCode,
} from "./helpers.ts";
import type { AlarmSchedule } from "../src/room/storage.ts";
import type { CreateRoomRequest } from "@jeopardy/protocol/room/create";
import type { GameRoomDO } from "../src/index.ts";

const teamsGame: CreateRoomRequest["game"] = {
  kind: "compact",
  rounds: [{ columns: 3, rows: 3 }],
  preset: "casual-party",
  overrides: {
    teams: { playerMode: "teams", teamBuzzer: "any-member" },
    wagers: { countRoundOne: 0, countRoundTwo: 0 },
  },
  hasFinalClue: false,
};

async function teamsRoom(seed: string) {
  const code = uniqueCode();
  const { hostToken } = await initializeRoom(code, teamsGame, seed);
  const host = await connectHost(code, hostToken);
  return { code, host };
}

describe("team lifecycle in the lobby", () => {
  it("create makes you leader; joiners land as members; rename/color/sound/lock are leader-only", async () => {
    const { code, host } = await teamsRoom("teams-basic");
    const founder = await connectBot(code, {
      ...instantBot("Founder"),
      team: { kind: "create", name: "Team Sequoia" },
    });
    let roster = await host.waitFor("roster", (message) => message.roster.teams.length === 1);
    const teamId = roster.roster.teams[0]?.teamId ?? "";
    expect(roster.roster.teams[0]).toMatchObject({
      name: "Team Sequoia",
      leaderPlayerId: founder.playerId,
      locked: false,
    });

    const member = await connectBot(code, {
      ...instantBot("Member"),
      team: { kind: "join", teamId },
    });
    roster = await host.waitFor("roster", (message) => message.roster.players.length === 2);
    expect(roster.roster.players.find((entry) => entry.playerId === member.playerId)?.teamId).toBe(
      teamId,
    );

    // A member touching team customization is refused; the leader's edit lands.
    member.sendMessage({ type: "team-update", name: "Hijacked" });
    const denied = await member.waitFor((message) => message.type === "error");
    expect(denied).toMatchObject({ reason: "unauthorized" });
    founder.sendMessage({
      type: "team-update",
      name: "Sequoia Prime",
      colorId: "forest-green",
      buzzSoundId: "pack/redwood-horn",
    });
    roster = await host.waitFor("roster", (message) =>
      message.roster.teams.some((team) => team.name === "Sequoia Prime"),
    );
    expect(roster.roster.teams[0]).toMatchObject({
      colorId: "forest-green",
      buzzSoundId: "pack/redwood-horn",
    });

    // Lock: no new joiners (refused WITHOUT closing, so the phone retries another team).
    founder.sendMessage({ type: "team-update", locked: true });
    await host.waitFor("roster", (message) => message.roster.teams[0]?.locked === true);
    const latecomer = await connectBot(code, { ...instantBot("Late"), seed: "late-seed" });
    latecomer.sendMessage({ type: "team-join", teamId });
    const lockedOut = await latecomer.waitFor((message) => message.type === "error");
    expect(lockedOut).toMatchObject({ reason: "rejected" });
  });

  it("kick returns the member to team selection; handoff moves the crown; kicked can rejoin unless locked", async () => {
    const { code, host } = await teamsRoom("teams-kick");
    const leader = await connectBot(code, {
      ...instantBot("Leader"),
      team: { kind: "create", name: "Kickers" },
    });
    await host.waitFor("roster", (message) => message.roster.teams.length === 1);
    const teamId = (await host.waitFor("roster")).roster.teams[0]?.teamId ?? "";
    const target = await connectBot(code, {
      ...instantBot("Target"),
      team: { kind: "join", teamId },
    });
    await host.waitFor("roster", (message) => message.roster.players.length === 2);

    leader.sendMessage({ type: "team-kick", playerId: target.playerId ?? "" });
    const afterKick = await host.waitFor("roster", (message) =>
      message.roster.players.some(
        (entry) => entry.playerId === target.playerId && entry.teamId === null,
      ),
    );
    expect(afterKick.roster.teams.length).toBe(1); // team survives, member is teamless

    // Not a ban list: the kicked player rejoins the same (unlocked) team.
    target.sendMessage({ type: "team-join", teamId });
    await host.waitFor("roster", (message) =>
      message.roster.players.some(
        (entry) => entry.playerId === target.playerId && entry.teamId === teamId,
      ),
    );

    // Handoff: explicit, instant, and the old leader becomes a regular member.
    leader.sendMessage({ type: "team-handoff", playerId: target.playerId ?? "" });
    const afterHandoff = await host.waitFor("roster", (message) =>
      message.roster.teams.some((team) => team.leaderPlayerId === target.playerId),
    );
    expect(afterHandoff.roster.teams[0]?.leaderPlayerId).toBe(target.playerId);
  });

  it("passes leadership to the longest-tenured connected member after the disconnect grace", async () => {
    const { code, host } = await teamsRoom("teams-succession");
    const leader = await connectBot(code, {
      ...instantBot("Leader"),
      team: { kind: "create", name: "Grace" },
    });
    await host.waitFor("roster", (message) => message.roster.teams.length === 1);
    const teamId = (await host.waitFor("roster")).roster.teams[0]?.teamId ?? "";
    const elder = await connectBot(code, {
      ...instantBot("Elder"),
      team: { kind: "join", teamId },
    });
    await connectBot(code, { ...instantBot("Younger"), team: { kind: "join", teamId } });
    await host.waitFor("roster", (message) => message.roster.players.length === 3);

    leader.close();
    await host.waitFor("roster", (message) =>
      message.roster.players.some(
        (entry) => entry.playerId === leader.playerId && !entry.connected,
      ),
    );
    // Inside the grace the crown has NOT moved.
    expect((await host.waitFor("roster")).roster.teams[0]?.leaderPlayerId).toBe(leader.playerId);

    // Fast-forward the succession entry past its due time and fire the alarm.
    await runInDurableObject(roomStub(code), async (instance: GameRoomDO, state) => {
      const schedule = await state.storage.get<AlarmSchedule>("schedule");
      if (schedule === undefined) throw new Error("no schedule");
      for (const entry of Object.values(schedule.successions)) {
        entry.dueAt = Date.now() - 1000;
      }
      await state.storage.put("schedule", schedule);
      (instance as unknown as { room: undefined }).room = undefined;
    });
    await runDurableObjectAlarm(roomStub(code));

    const succeeded = await host.waitFor("roster", (message) =>
      message.roster.teams.some((team) => team.leaderPlayerId === elder.playerId),
    );
    // Longest-tenured connected member (Elder joined before Younger) wears the crown.
    expect(succeeded.roster.teams[0]?.leaderPlayerId).toBe(elder.playerId);
  });
});

describe("team-scoped buzzing", () => {
  it("resolves buzz-won to the TEAM's room-audible sound, not the presser's personal one", async () => {
    const { code, host } = await teamsRoom("teams-sound");
    const leader = await connectBot(code, {
      ...instantBot("Leader"),
      buzzSoundId: "pack/personal-quack",
      team: { kind: "create", name: "Audio" },
    });
    await host.waitFor("roster", (message) => message.roster.teams.length === 1);
    const teamId = (await host.waitFor("roster")).roster.teams[0]?.teamId ?? "";
    leader.sendMessage({ type: "team-update", buzzSoundId: "pack/team-foghorn" });
    await host.waitFor("roster", (message) =>
      message.roster.teams.some((team) => team.buzzSoundId === "pack/team-foghorn"),
    );
    const presser = await connectBot(code, {
      ...instantBot("Presser"),
      buzzSoundId: "pack/personal-kazoo",
      team: { kind: "join", teamId },
    });
    await host.waitFor("roster", (message) => message.roster.players.length === 2);

    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");
    presser.sendAction({ type: "buzz" });

    const won = await host.waitFor("buzz-won");
    expect(won).toMatchObject({
      playerId: presser.playerId,
      entityId: teamId,
      teamId,
      buzzSoundId: "pack/team-foghorn", // the leader-picked TEAM sound carries the room
    });
  });

  it("enforces the rename rate limit on team names but never on the host", async () => {
    const { code, host } = await teamsRoom("teams-rename-limit");
    const leader = await connectBot(code, {
      ...instantBot("Leader"),
      team: { kind: "create", name: "Rename Me" },
    });
    await host.waitFor("roster", (message) => message.roster.teams.length === 1);
    const teamId = (await host.waitFor("roster")).roster.teams[0]?.teamId ?? "";

    for (let attempt = 0; attempt < limits.player.renameBurstMax; attempt += 1) {
      leader.sendMessage({ type: "team-update", name: `Name ${String(attempt)}` });
    }
    leader.sendMessage({ type: "team-update", name: "One Too Many" });
    const limited = await leader.waitFor((message) => message.type === "error");
    expect(limited).toMatchObject({ reason: "rate-limited" });

    // Host supremacy: renames through the console are never metered.
    host.send({ type: "team-update", teamId, name: "Host Says This" });
    const renamed = await host.waitFor("roster", (message) =>
      message.roster.teams.some((team) => team.name === "Host Says This"),
    );
    expect(renamed.roster.teams[0]?.name).toBe("Host Says This");
  });
});
