// THE RECONCILE'S PROOF: the real product surfaces, in real browser contexts, sharing one
// real room.
//
// Its sibling (room.e2e.ts) drives the wire by hand from inside a page - it proves the
// protocol and the single-origin passthrough. This one touches no protocol at all. It clicks
// the front door's Create room button, opens the projector window, and fills in the pre-game
// screen on two more phones, then asks the three tabs whether they agree about who is in the
// room and which boat they are on. That question is the entire reconcile: until 2026-08-17
// every tab ran its own local simulation and the answer was always no.
//
// Not part of `pnpm test`/CI (a local chromium and a free port): `pnpm -F @jeopardy/web
// test:e2e`, which builds first and spawns the single-origin wrangler dev in global-setup.ts.
//
// Sequential awaits are the point (ordered flows against one shared server).
/* oxlint-disable no-await-in-loop */
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumExecutable, chromiumLaunchArgs } from "./chromium.ts";
import { e2eOrigin } from "./global-setup.ts";
import type { Browser, BrowserContext, Page } from "playwright";

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

/** A separate context per participant: separate sessionStorage, which is a separate SEAT. */
async function newPage(): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

/** Create a room the way a host does: the front door's button, which hands off to the console. */
async function createRoomFromFrontDoor(page: Page): Promise<string> {
  await page.goto(`${e2eOrigin}/`);
  await page.getByRole("button", { name: "Create room" }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]+\/host$/, { timeout: 20_000 });
  const code = /\/room\/([A-Z0-9]+)\/host$/.exec(page.url())?.[1];
  if (code === undefined) throw new Error(`no room code in ${page.url()}`);
  return code;
}

/**
 * Create a room the API way, for the shapes the front door's form cannot ask for yet (teams
 * mode is a RULE, and the form offers room controls only). The host token comes back here, so
 * the console tab is handed it exactly as the front door would have - through sessionStorage,
 * never a URL (src/lib/lobby/join-hand-off.ts owns the key).
 */
async function createTeamsRoom(): Promise<{ code: string; hostToken: string }> {
  const response = await fetch(`${e2eOrigin}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: {
        kind: "compact",
        rounds: [{ columns: 3, rows: 3 }],
        preset: "casual-party",
        overrides: {
          teams: { playerMode: "teams" },
          wagers: { countRoundOne: 0, countRoundTwo: 0 },
        },
        hasFinalClue: false,
      },
      seed: "e2e-surfaces-teams",
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { code: string; hostToken: string };
}

async function openHostConsole(page: Page, code: string, hostToken: string): Promise<void> {
  await page.goto(`${e2eOrigin}/`);
  await page.evaluate(
    (seed: { code: string; hostToken: string }) => {
      sessionStorage.setItem(`jeopardy.host-token.${seed.code}`, seed.hostToken);
    },
    { code, hostToken },
  );
  await page.goto(`${e2eOrigin}/room/${code}/host`);
}

/**
 * The projector window. `environment=none` is the documented clean-2D setting
 * (src/lib/diorama/diorama-environment.ts), which is what makes the staged lobby's names real
 * DOM text a test can read instead of pixels in a WebGL canvas.
 */
function displayUrl(code: string): string {
  return `${e2eOrigin}/room/${code}/display?environment=none`;
}

/**
 * Fill in the pre-game screen and take a seat - the actual A2 flow, no protocol frames.
 *
 * The retry loop is not flake-papering, it is the honest way to drive a hydrating page: a fill
 * that lands before Svelte takes the input over is discarded when it does, and a tap on a
 * server-rendered button has no handler behind it yet. So the name is typed until it STICKS
 * (which is itself the proof that hydration happened) and the button is pressed until the room
 * answers. `pickCharacter` additionally chooses an avatar and an accent - the identity moment,
 * which has to survive the join and reach every other surface.
 */
async function joinAsPlayer(
  page: Page,
  code: string,
  nickname: string,
  options: { pickCharacter?: boolean } = {},
): Promise<void> {
  await page.goto(`${e2eOrigin}/room/${code}`);
  const field = page.getByPlaceholder("What should the room call you?");
  await field.waitFor({ timeout: 20_000 });
  const seated = page.getByText(`You are in as ${nickname}`);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await seated.count()) > 0) return;
    await field.fill(nickname);
    if ((await field.inputValue()) !== nickname) {
      await page.waitForTimeout(250);
      continue;
    }
    if (options.pickCharacter === true) {
      await page.getByRole("group", { name: "Avatar" }).getByRole("button").nth(1).click();
      await page.getByRole("group", { name: "Accent color" }).getByRole("button").nth(2).click();
    }
    const button = page.getByRole("button", { name: "Join the room" });
    if ((await button.count()) === 0) break;
    await button.click();
    try {
      await seated.waitFor({ timeout: 5000 });
      return;
    } catch {
      // The tap landed before the handler did; the loop types and presses again.
    }
  }
  await seated.waitFor({ timeout: 20_000 });
}

describe("the reconcile: one room, three surfaces", () => {
  it("creates a room from the front door and keeps display, console and two phones in step", async () => {
    const hostPage = await newPage();
    const code = await createRoomFromFrontDoor(hostPage);

    // The console is live the moment it opens: it holds the creation token this tab was given.
    await hostPage.getByText("0 players in (0 connected)").waitFor({ timeout: 20_000 });

    const display = await newPage();
    await display.goto(displayUrl(code));
    await display.getByText(code, { exact: false }).first().waitFor({ timeout: 20_000 });

    const phoneAda = await newPage();
    const phoneGrace = await newPage();

    await joinAsPlayer(phoneAda, code, "Ada", { pickCharacter: true });
    await joinAsPlayer(phoneGrace, code, "Grace");

    // THE ASSERTION THE WHOLE RECONCILE IS FOR: three independent tabs, one roster.
    await hostPage.getByText("2 players in (2 connected)").waitFor({ timeout: 20_000 });
    await display.getByText("2 players in").waitFor({ timeout: 20_000 });
    for (const page of [display, phoneAda, phoneGrace]) {
      await page.getByText("Ada", { exact: false }).first().waitFor({ timeout: 20_000 });
      await page.getByText("Grace", { exact: false }).first().waitFor({ timeout: 20_000 });
    }
    // Ada's phone knows which of those two is her, and nobody else's does.
    await phoneAda.getByText("Ada (you)").waitFor({ timeout: 20_000 });
    await phoneGrace.getByText("Grace (you)").waitFor({ timeout: 20_000 });

    // A5: a reload is a RETURNING player. The seat token in this tab's sessionStorage resumes
    // the same seat rather than taking a second one - the room still counts two people.
    await phoneAda.reload();
    await phoneAda.getByText("You are in as Ada").waitFor({ timeout: 20_000 });
    await hostPage.getByText("2 players in (2 connected)").waitFor({ timeout: 20_000 });
    await display.getByText("2 players in").waitFor({ timeout: 20_000 });
  });

  it("boards a team on one phone and shows it on every other surface", async () => {
    const { code, hostToken } = await createTeamsRoom();
    const hostPage = await newPage();
    await openHostConsole(hostPage, code, hostToken);
    await hostPage.getByText("0 players in (0 connected)").waitFor({ timeout: 20_000 });

    const display = await newPage();
    await display.goto(displayUrl(code));

    // Teams appear once you are IN the room: an unjoined connection is told nothing about the
    // room it is standing outside (which is what makes a password room a password room), and
    // the pre-game screen's teams region fills in the moment the seat lands.
    const phoneAda = await newPage();
    await joinAsPlayer(phoneAda, code, "Ada");
    await phoneAda.getByPlaceholder("Team name").fill("Sequoia");
    await phoneAda.getByRole("button", { name: "Create and lead" }).click();
    await phoneAda.getByText("You are on this team").waitFor({ timeout: 20_000 });

    const phoneGrace = await newPage();
    await joinAsPlayer(phoneGrace, code, "Grace");
    await phoneGrace.getByRole("button", { name: "Join this team" }).click();
    await phoneGrace.getByText("You are on this team").waitFor({ timeout: 20_000 });

    // One team, two members, agreed on by the console, the projector's staged lobby, and both
    // phones - including which of them leads it.
    await hostPage.getByText("1 teams").waitFor({ timeout: 20_000 });
    for (const page of [display, phoneAda, phoneGrace]) {
      await page.getByText("Sequoia", { exact: false }).first().waitFor({ timeout: 20_000 });
      await page.getByText("Ada", { exact: false }).first().waitFor({ timeout: 20_000 });
      await page.getByText("Grace", { exact: false }).first().waitFor({ timeout: 20_000 });
    }
    await phoneAda.getByText("You are in as Ada on Sequoia").waitFor({ timeout: 20_000 });
    await phoneGrace.getByText("You are in as Grace on Sequoia").waitFor({ timeout: 20_000 });
  });

  it("tells a host console in the wrong tab what is missing instead of pretending", async () => {
    const { code } = await createTeamsRoom();
    const stranger = await newPage();
    await stranger.goto(`${e2eOrigin}/room/${code}/host`);
    // Not an error page and not a broken console: the key lives in the tab that made the room.
    await stranger
      .getByRole("heading", { name: `This tab cannot host room ${code}` })
      .waitFor({ timeout: 20_000 });
    expect(await stranger.getByRole("button", { name: "Start game" }).count()).toBe(0);
  });
});
