// The M3 exit-criteria end-to-end proof: real chromium contexts as phones + display + host
// against the BUILT app under multi-config wrangler dev - deterministic buzz ordering and
// roster sync through the single origin, plus the owner's /dev/rooms panel flow. Run via
// `pnpm -F @jeopardy/web test:e2e` (not part of `pnpm test`/CI: needs a local chromium -
// see ./chromium.ts - and a free port). The PRODUCT surfaces have their own suite next door
// (surfaces.e2e.ts); this one drives the wire directly.
//
// Sequential awaits in loops are the point here (ordered protocol scripts, per-context
// assertions against one shared server), so the parallelize-your-awaits rule is off.
/* oxlint-disable no-await-in-loop */
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumExecutable, chromiumLaunchArgs } from "./chromium.ts";
import { e2eOrigin } from "./global-setup.ts";
import type { Browser, BrowserContext, Page } from "playwright";

type WireMessage = { type: string } & Record<string, unknown>;
// What joinRoom installs on the page's globalThis for later evaluate/waitForFunction calls.
type PageHarness = { messages: WireMessage[]; send(payload: Record<string, unknown>): void };
type HarnessGlobal = { roomTestHarness: PageHarness };

let browser: Browser;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    args: chromiumLaunchArgs,
  });
});

afterAll(async () => {
  for (const context of contexts) await context.close();
  await browser?.close();
});

async function newPage(): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

async function createRoom(): Promise<{ code: string; hostToken: string }> {
  const response = await fetch(`${e2eOrigin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: {
        kind: "compact",
        rounds: [{ columns: 3, rows: 3 }],
        preset: "casual-party",
        overrides: { wagers: { countRoundOne: 0, countRoundTwo: 0 } },
        hasFinalClue: false,
      },
      seed: "e2e-room-seed",
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { code: string; hostToken: string };
}

// Open the room socket INSIDE a browser page (same-origin, exactly like a phone) and join.
// buzzDelayMs non-null makes the page an auto-buzzing phone: on every buzzers-armed event
// it presses after the given delay - the cross-context determinism knob.
async function joinRoom(
  page: Page,
  code: string,
  join: Record<string, unknown>,
  buzzDelayMs: number | null,
): Promise<void> {
  await page.goto(`${e2eOrigin}/`);
  await page.evaluate(
    (args: { code: string; join: Record<string, unknown>; buzzDelayMs: number | null }) => {
      return new Promise<void>((resolve, reject) => {
        const harness: PageHarness & { ws?: WebSocket } = {
          messages: [],
          send(payload: Record<string, unknown>) {
            this.ws?.send(JSON.stringify({ version: 1, ...payload }));
          },
        };
        (globalThis as unknown as HarnessGlobal).roomTestHarness = harness;
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/room/${args.code}/ws`);
        harness.ws = ws;
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data)) as WireMessage;
          harness.messages.push(message);
          if (message.type === "welcome") resolve();
          if (message.type === "refused")
            reject(new Error(`refused: ${String(message["reason"])}`));
          if (message.type === "event" && args.buzzDelayMs !== null) {
            const events = message["events"] as { type: string }[];
            if (events.some((entry) => entry.type === "buzzers-armed")) {
              setTimeout(
                () => harness.send({ type: "action", action: { type: "buzz" } }),
                args.buzzDelayMs,
              );
            }
          }
        });
        ws.addEventListener("close", (event) => reject(new Error(`closed ${String(event.code)}`)));
        ws.addEventListener("open", () => harness.send(args.join));
        setTimeout(() => reject(new Error("no welcome within 10s")), 10_000);
      });
    },
    { code, join, buzzDelayMs },
  );
}

function countMessages(page: Page, type: string): Promise<number> {
  return page.evaluate(
    (wanted: string) =>
      (globalThis as unknown as HarnessGlobal).roomTestHarness.messages.filter(
        (message) => message.type === wanted,
      ).length,
    type,
  );
}

async function waitForMessage(
  page: Page,
  predicateSource: string,
  timeoutMs = 10_000,
): Promise<WireMessage> {
  await page.waitForFunction(
    (source: string) => {
      // eslint-style dynamic predicate: the source is authored in THIS file below, never
      // user input. Function construction keeps waitForFunction serializable.
      const predicate = new Function("m", `return (${source});`) as (m: WireMessage) => boolean;
      return (globalThis as unknown as HarnessGlobal).roomTestHarness.messages.some(predicate);
    },
    predicateSource,
    { timeout: timeoutMs },
  );
  return page.evaluate((source: string) => {
    const predicate = new Function("m", `return (${source});`) as (m: WireMessage) => boolean;
    const found = (globalThis as unknown as HarnessGlobal).roomTestHarness.messages.find(predicate);
    if (found === undefined) throw new Error("predicate matched then vanished");
    return found;
  }, predicateSource);
}

function sendFrom(page: Page, payload: Record<string, unknown>): Promise<void> {
  return page.evaluate((frame: Record<string, unknown>) => {
    (globalThis as unknown as HarnessGlobal).roomTestHarness.send(frame);
  }, payload);
}

describe("single-origin rooms end to end", () => {
  it("syncs the roster and adjudicates a deterministic buzz race across browser contexts", async () => {
    const { code, hostToken } = await createRoom();
    const host = await newPage();
    const display = await newPage();
    const phoneFast = await newPage();
    const phoneMid = await newPage();
    const phoneSlow = await newPage();

    await joinRoom(host, code, { type: "join", role: "host", hostToken }, null);
    await joinRoom(display, code, { type: "join", role: "display" }, null);
    // Staggered auto-buzz delays: Ada must win every race; 150ms gaps dwarf cross-process
    // jitter, so the ordering assertion is deterministic run over run.
    await joinRoom(phoneFast, code, { type: "join", role: "player", nickname: "Ada" }, 0);
    await joinRoom(phoneMid, code, { type: "join", role: "player", nickname: "Grace" }, 150);
    await joinRoom(phoneSlow, code, { type: "join", role: "player", nickname: "Edsger" }, 300);

    // Roster sync: every surface converges on the same three seats.
    const rosterPredicate = `m.type === "roster" && m.roster.players.length === 3`;
    for (const page of [host, display, phoneFast]) {
      const roster = await waitForMessage(page, rosterPredicate);
      const players = (roster["roster"] as { players: { identity: { nickname: string } }[] })
        .players;
      expect(players.map((entry) => entry.identity.nickname).toSorted()).toEqual([
        "Ada",
        "Edsger",
        "Grace",
      ]);
    }

    // Host drives one clue; the phones' auto-buzzers race.
    await sendFrom(host, { type: "action", action: { type: "start-game" } });
    await waitForMessage(
      host,
      `m.type === "event" && m.events.some(e => e.type === "game-started")`,
    );
    await sendFrom(host, { type: "action", action: { type: "select-cell", category: 0, row: 0 } });
    await waitForMessage(
      host,
      `m.type === "event" && m.events.some(e => e.type === "clue-presented")`,
    );
    await sendFrom(host, { type: "action", action: { type: "arm-buzzers" } });

    const won = await waitForMessage(display, `m.type === "buzz-won"`);
    // Exactly one winner room-wide, and it is the fastest phone - on EVERY surface.
    await new Promise((resolve) => setTimeout(resolve, 700));
    for (const page of [host, display, phoneFast, phoneMid, phoneSlow]) {
      expect(await countMessages(page, "buzz-won")).toBe(1);
    }
    const adaWelcome = await waitForMessage(phoneFast, `m.type === "welcome"`);
    expect(won["playerId"]).toBe(adaWelcome["playerId"]);

    // Judge it; the display sees the score land.
    await sendFrom(host, { type: "action", action: { type: "judge", verdict: "correct" } });
    const judged = await waitForMessage(
      display,
      `m.type === "event" && m.events.some(e => e.type === "judged" && e.delta > 0)`,
    );
    expect(judged["type"]).toBe("event");
  });

  it("walks the owner's /dev/rooms panel: probe PASS, create two rooms, host a lobby", async () => {
    const page = await newPage();
    await page.goto(`${e2eOrigin}/dev/rooms`);

    // The refusal probe in the test area: connects never create, and the chip says PASS.
    const uncreatedProbe = page.locator("li", { hasText: "Connect to an uncreated room" });
    await uncreatedProbe.getByRole("button", { name: "Run" }).click();
    await uncreatedProbe.locator('[data-verdict="pass"]').waitFor({ timeout: 10_000 });

    // Create TWO real rooms: the second must not evict the first from the session list -
    // the owner-reported "creating a room deletes a previously created room".
    await page.getByRole("button", { name: "Create room" }).click();
    await page.getByRole("heading", { name: /Rooms this tab created \(1\)/ }).waitFor({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "Create room" }).click();
    await page.getByRole("heading", { name: /Rooms this tab created \(2\)/ }).waitFor({
      timeout: 10_000,
    });

    // Connect through the single origin and join as host; the status panel reflects it.
    await page.getByRole("button", { name: "Connect", exact: true }).first().click();
    await page.getByRole("button", { name: "Join as host" }).click();
    await page.getByText("role:").locator("strong").filter({ hasText: "host" }).waitFor({
      timeout: 10_000,
    });
    await page.getByText("room:").locator("strong").filter({ hasText: "lobby" }).waitFor({
      timeout: 10_000,
    });

    // Streamer mode from the Room settings panel, over the socket door this host now holds:
    // the change is applied by the DO and comes back as the broadcast every display reacts to.
    // By its HEADING, not by its text: the create panel mentions the Room settings panel in
    // prose, and a hasText filter would happily match that instead.
    const settingsPanel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Room settings" }) });
    await settingsPanel.getByRole("combobox").first().selectOption("socket");
    await settingsPanel.getByText("hide join code (streamer mode)").click();
    await settingsPanel.locator("[data-broadcast]").filter({ hasText: "HIDDEN" }).waitFor({
      timeout: 10_000,
    });

    // Run all: sequential, with a summary line. The rate-limit probe is SKIPPED here (this
    // connection is the host, which is exempt from the cap by design) - skipped, never failed.
    await page.getByRole("button", { name: "Run all" }).click();
    await page.locator("[data-run-summary]").filter({ hasText: "passed" }).waitFor({
      timeout: 30_000,
    });
  });
});
