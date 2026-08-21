// Buzz latency compensation against the real Durable Object, with real (simulated) phone
// networks between the bots and the room (M6, docs/decisions/2026-08-17-buzz-latency-
// compensation.md). The claim under test is the one the milestone exists to make: the fastest
// THUMB wins, not the fastest Wi-Fi - and a client that lies about its thumb gains nothing
// beyond what an honest client on the same connection is already given.
//
// The predictions come from @jeopardy/bots/race, which ranks with the SERVER'S own ordering
// module. A disagreement between the two is therefore a real defect, not two arithmetics
// drifting; the harness's contribution is the ground truth (each racer's true reaction and
// true network), which the server can never have.
/* oxlint-disable no-await-in-loop */
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { latencyProfiles } from "@jeopardy/bots/latency";
import { formatRaceReport, judgeRace, reportRaces } from "@jeopardy/bots/race";
import {
  compactGame,
  compactGameWith,
  connectBot,
  connectHost,
  initializeRoom,
  racerBot,
  roomStub,
  uniqueCode,
} from "./helpers.ts";
import type { Racer } from "@jeopardy/bots/race";
import type { Bot } from "@jeopardy/bots/bot";
import type { CompactGameSpec, TestClient } from "./helpers.ts";

// The two phones the milestone is about. Chosen so BOTH statements are true with margin:
// arrival order crowns the fast phone by ~100ms, and reaction order crowns the slow one by
// ~100ms. Anything narrower would be a coin flip dressed up as a test.
const slowPhone = { profile: latencyProfiles.slow, reactionMs: 150 } as const;
const fastPhone = { profile: latencyProfiles.fast, reactionMs: 250 } as const;

// A CHEATING Bo is given a deliberately slow thumb, because the interesting question about a
// liar is whether the clamp holds when the lie is the only thing that could win the race -
// and because the margin then survives a loaded machine inflating Bo's own measured round
// trip all the way to the ceiling. An honest Bo keeps the fast thumb the headline needs.
const cheatReactionMs = 450;

const racersFor = (extra: Partial<Racer> = {}): Racer[] => [
  { nickname: "Ada", roundTripMs: slowPhone.profile.roundTripMs, reactionMs: slowPhone.reactionMs },
  {
    nickname: "Bo",
    roundTripMs: fastPhone.profile.roundTripMs,
    reactionMs: extra.elapsedClaim === undefined ? fastPhone.reactionMs : cheatReactionMs,
    ...extra,
  },
];

// One armed clue with two racers on their own simulated networks. Returns the host and the
// bots; the bots buzz themselves, each measuring from the arm ITS OWN phone rendered.
async function racedClue(options: {
  seed: string;
  game?: CompactGameSpec;
  cheat?: { acknowledgeArming?: boolean; elapsedClaim?: "honest" | "zero" | "none" };
}): Promise<{ host: TestClient; ada: Bot; bo: Bot; code: string }> {
  const code = uniqueCode();
  const { hostToken } = await initializeRoom(code, options.game ?? compactGame, options.seed);
  const host = await connectHost(code, hostToken);
  const ada = await connectBot(code, racerBot("Ada", slowPhone.reactionMs), {
    profile: slowPhone.profile,
    seed: `${options.seed}-ada`,
  });
  const bo = await connectBot(
    code,
    racerBot(
      "Bo",
      options.cheat === undefined ? fastPhone.reactionMs : cheatReactionMs,
      options.cheat ?? {},
    ),
    { profile: fastPhone.profile, seed: `${options.seed}-bo` },
  );
  await host.waitFor("roster", (message) => message.roster.players.length === 2);
  host.sendAction({ type: "start-game" });
  await host.takeEvent("round-started");
  host.sendAction({ type: "select-cell", category: 0, row: 0 });
  await host.takeEvent("clue-presented");
  host.sendAction({ type: "arm-buzzers" });
  return { host, ada, bo, code };
}

function nicknameOf(bots: Bot[], playerId: string): string {
  return bots.find((bot) => bot.playerId === playerId)?.nickname ?? playerId;
}

describe("buzz latency compensation", () => {
  it("crowns the slow phone that pressed FIRST over the fast phone that pressed later", async () => {
    const { host, ada, bo } = await racedClue({ seed: "fair-headline" });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    const verdict = judgeRace({
      label: "slow-but-earlier",
      racers: racersFor(),
      winner: nicknameOf([ada, bo], won.playerId),
    });
    // The whole milestone in three assertions, printed as a table when it fails.
    expect(formatRaceReport(reportRaces([{ ...verdict }]))).toContain("Ada");
    expect(verdict.byArrival, "the race must be one arrival order gets wrong").toBe("Bo");
    expect(verdict.winner).toBe("Ada");
    expect(verdict.fastestThumbWon).toBe(true);
    expect(verdict.changedTheOutcome).toBe(true);
    // Still exactly one winner heard by the room, compensation or not (the audio contract).
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(host.messagesOf("buzz-won").length).toBe(1);
  }, 20_000);

  it("hands the same race to the fast phone with the setting off (this is what M3 did)", async () => {
    const { host, ada, bo } = await racedClue({
      seed: "fair-off",
      game: compactGameWith({ buzzing: { latencyCompensation: false } }),
    });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(nicknameOf([ada, bo], won.playerId)).toBe("Bo");
  }, 20_000);

  it("gains a phone nothing by claiming an instant thumb (the clamp, end to end)", async () => {
    // Bo lies: it acks honestly, so the server measures its 40ms connection, then claims a
    // zero-millisecond reaction on a 250ms press. Credited = arrival - 40, i.e. the truth.
    const { host, ada, bo } = await racedClue({
      seed: "fair-liar",
      cheat: { elapsedClaim: "zero" },
    });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    const verdict = judgeRace({
      label: "liar-claims-zero",
      racers: racersFor({ elapsedClaim: "zero" }),
      winner: nicknameOf([ada, bo], won.playerId),
    });
    expect(verdict.winner).toBe("Ada");
    expect(verdict.matchedPrediction).toBe(true);
  }, 20_000);

  it("compensates nobody who refuses to be measured (no ack, no credit)", async () => {
    // Bo declines the arm-ack AND claims zero - the maximally uncooperative client. With no
    // measurement there is no allowance, so it is ranked by raw arrival and still loses.
    const { host, ada, bo } = await racedClue({
      seed: "fair-silent",
      cheat: { acknowledgeArming: false, elapsedClaim: "zero" },
    });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(nicknameOf([ada, bo], won.playerId)).toBe("Ada");
  }, 20_000);

  it("tells every joined client the arming id, and holds only as long as it must", async () => {
    const { host, ada } = await racedClue({ seed: "fair-window" });
    const armWindow = await ada.waitFor((message) => message.type === "arm-window");
    if (armWindow.type !== "arm-window") throw new Error("unreachable");
    expect(armWindow.arm.armId).toBe(1);
    expect(armWindow.arm.compensationMs).toBe(250);
    expect(armWindow.arm.rebound).toBe(false);
    const hostArm = host.messagesOf("arm-window").at(-1);
    expect(hostArm?.arm.armId).toBe(1);

    // The hold is real but small: the winner is announced within the window, not after some
    // multiple of it (a room that pauses for a second on every buzz is not shippable).
    const armedAt = Date.now();
    await host.waitFor("buzz-won", undefined, 8000);
    expect(Date.now() - armedAt).toBeLessThan(1500);
  }, 20_000);

  it("counts a rebound as its own arming, with its own id and measurement", async () => {
    const { host, ada, bo } = await racedClue({ seed: "fair-rebound" });
    const first = await host.waitFor("buzz-won", undefined, 8000);
    host.sendAction({ type: "judge", verdict: "wrong" });
    await host.takeEvent("rebound-armed");
    const second = await host.waitFor(
      "buzz-won",
      (message) => message.stateVersion > first.stateVersion,
      8000,
    );
    expect(second.playerId).not.toBe(first.playerId);
    const ids = [ada, bo].flatMap((bot) =>
      bot.received.filter((message) => message.type === "arm-window").map((m) => m.arm.armId),
    );
    expect(new Set(ids)).toEqual(new Set([1, 2]));
    expect(
      ada.received.some((message) => message.type === "arm-window" && message.arm.rebound),
    ).toBe(true);
  }, 20_000);
});

describe("hibernation across an armed window", () => {
  it("adjudicates held buzzes after the instance is torn down mid-window", async () => {
    // The eviction that would hurt most: presses are in the holding pen, the winner has not
    // been decided, and the instance disappears. The window and its samples are storage, and
    // the alarm that closes it is storage, so a rebuilt instance finishes the race.
    const { host, ada, bo, code } = await racedClue({ seed: "fair-evict-window" });
    await ada.waitFor((message) => message.type === "arm-window");
    // INSIDE the window, and that is the whole setup. It slept 450ms here, which is longer than
    // the 250ms compensation window itself (settings.buzzing.compensationWindowMs), so whether
    // the pen was still open at eviction was down to scheduling luck - and on the unlucky run
    // the winner had already been crowned, leaving the wait below hanging on a second
    // `buzz-won` that was never coming. 200ms is after Ada's press (150ms reaction plus her
    // simulated round trip, so there is genuinely something held) and comfortably before the
    // window that press opened can close.
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Stated rather than assumed: if a future timing change lets adjudication finish first,
    // this fails as the setup problem it is instead of timing out eight seconds later.
    expect(host.messagesOf("buzz-won")).toHaveLength(0);
    await evictDurableObject(roomStub(code));
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(nicknameOf([ada, bo], won.playerId)).toBe("Ada");
  }, 20_000);

  it("survives an eviction between the arm and the presses", async () => {
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "fair-evict-arm");
    const host = await connectHost(code, hostToken);
    const ada = await connectBot(code, racerBot("Ada", 40));
    const bo = await connectBot(code, racerBot("Bo", 400));
    await host.waitFor("roster", (message) => message.roster.players.length === 2);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");
    // Evict before anyone has pressed: the window must come back from storage, not memory.
    await evictDurableObject(roomStub(code));
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(nicknameOf([ada, bo], won.playerId)).toBe("Ada");
    expect(host.messagesOf("buzz-won").length).toBe(1);
  }, 20_000);
});

describe("the compensation window never swallows a clue", () => {
  it("resolves held presses before the buzz-window timeout can kill the clue", async () => {
    // The dangerous neighbour: a press lands in the holding pen at the same moment the 3s
    // buzz window expires. Adjudication must run first, or a clue somebody rang in on would
    // die as a triple stumper.
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(
      code,
      compactGameWith({ buzzing: { buzzWindowMs: 3000 } }),
      "fair-timeout-race",
    );
    const host = await connectHost(code, hostToken);
    const bot = await connectBot(code, racerBot("Ada", 2900));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(won.playerId).toBe(bot.playerId);
    expect(
      host.engineEvents.some(
        (event) => event.type === "clue-finished" && event.resolution === "dead",
      ),
    ).toBe(false);
  }, 20_000);

  it("resolves held presses before the host's own skip-the-wait can kill the clue", async () => {
    // The host reaching for "no takers" in the same breath as somebody ringing in. The press
    // is still in the holding pen, so the impatience must queue behind it - otherwise the
    // buzz-window timeout closes the clue as a triple stumper on a player who had buzzed.
    const code = uniqueCode();
    const { hostToken } = await initializeRoom(code, compactGame, "fair-skip-race");
    const host = await connectHost(code, hostToken);
    const bot = await connectBot(code, racerBot("Ada", 0, { buzzProbability: 0 }));
    await host.waitFor("roster", (message) => message.roster.players.length === 1);
    host.sendAction({ type: "start-game" });
    await host.takeEvent("round-started");
    host.sendAction({ type: "select-cell", category: 0, row: 0 });
    await host.takeEvent("clue-presented");
    host.sendAction({ type: "arm-buzzers" });
    await host.takeEvent("buzzers-armed");

    bot.buzz();
    host.send({ type: "expire-timer" });
    const won = await host.waitFor("buzz-won", undefined, 8000);
    expect(won.playerId).toBe(bot.playerId);
    expect(
      host.engineEvents.some(
        (event) => event.type === "clue-finished" && event.resolution === "dead",
      ),
    ).toBe(false);
  }, 20_000);
});
