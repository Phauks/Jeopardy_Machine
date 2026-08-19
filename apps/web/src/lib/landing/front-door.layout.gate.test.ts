// Three invariants that live in CSS and in the file tree rather than in rendered markup, so
// they are gated against the source itself.
//
// 1. NO REFLOW. The standing layout law (docs/decisions/2026-08-16-persistent-layout-and-
//    pregame-rework.md): "reserve the space up front so nothing reflows when content arrives",
//    and prose gets a hard measure so it breaks where the design decided rather than where the
//    window happens to end. A rendered DOM cannot prove this - there is no layout engine in
//    these tests - but the declarations that produce it can be required to exist.
// 2. THE MASTHEAD IS A WORDMARK, not a hero (docs/decisions/2026-08-18-front-door-
//    architecture.md §5). The band it replaced was roughly 340px of the first screen above the
//    only control anyone came for, and it grew back once already after being "reduced".
// 3. NOTHING RESURRECTS. /lobby, the lobby screen, the standing password field's component and
//    the rejoin panel were deleted outright, with no redirect and no shim (docs/research/
//    00-user-directives.md, "No legacy code").
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

function routeNames(): string[] {
  return readdirSync(fileURLToPath(new URL("../../routes", import.meta.url)));
}

describe("no reflow when content arrives", () => {
  const frontDoor = sourceOf("lib/landing/front-door.svelte");

  it("reserves the counter's verdict block, so an arriving answer changes words not positions", () => {
    expect(sourceOf("lib/landing/entry-counter.svelte")).toMatch(
      /\.verdict-block\s*{[^}]*min-height/,
    );
  });

  it("reserves the create form's verdict block, so validation never shifts the button", () => {
    expect(sourceOf("lib/landing/create-room-panel.svelte")).toMatch(
      /\.verdict\s*{[^}]*min-height/,
    );
  });

  it("reserves the room list's block, so all five of its states are the same size", () => {
    expect(sourceOf("lib/lobby/room-browser.svelte")).toMatch(/\.browser-body\s*{[^}]*min-height/);
  });

  it("gives the surviving prose a hard measure", () => {
    // One paragraph is left on the page - the counter's verdict line - and it breaks where the
    // design decided rather than where the window happens to end. The footer that carried the
    // other one was deleted with the rest of the pitch copy (owner call 2026-08-17).
    expect(sourceOf("lib/landing/entry-counter.svelte")).toMatch(
      /\.verdict-line\s*{[^}]*max-inline-size:\s*\d+ch/,
    );
  });

  it("declares one spacing rhythm and one measure instead of ad-hoc values", () => {
    for (const token of ["--space-1", "--space-7", "--rule", "--page-inset", "--measure"]) {
      expect(frontDoor).toContain(`${token}:`);
    }
  });
});

describe("the masthead is a wordmark, not a hero", () => {
  const masthead = sourceOf("lib/landing/masthead-bar.svelte");

  it("is one line of text tall, and says so in a declaration rather than by accident", () => {
    const height = /\.masthead-inner\s*{[^}]*min-height:\s*([\d.]+)rem/.exec(masthead)?.[1] ?? "99";
    expect(Number(height)).toBeLessThanOrEqual(3.5);
  });

  it("sets the wordmark at chrome scale - no display step, no viewport-scaled title", () => {
    const wordmark = /\.wordmark\s*{[^}]*}/.exec(masthead)?.[0] ?? "";
    expect(wordmark).toMatch(/font-size:\s*1\.\d+rem/);
    expect(wordmark).not.toContain("clamp(");
    // The hero's display step is gone from the page's scale, so it cannot be reached for.
    expect(sourceOf("lib/landing/front-door.svelte")).not.toContain("--step-display");
  });

  it("spends its remaining width on the developer gear, not on a facts strip", () => {
    expect(masthead).toContain("Developer surfaces");
    // The hero's parts by name: an eyebrow, a lead, a supporting line and a definition list of
    // facts. None of them may reappear in the strip that replaced them.
    expect(masthead).not.toMatch(/class="(eyebrow|lead|support|facts|fact)"/);
    expect(masthead).not.toContain("<dl");
  });
});

describe("the front door is the only door, and nothing it replaced survives", () => {
  it("has no /lobby route left to visit", () => {
    expect(routeNames()).not.toContain("lobby");
  });

  it("keeps no lobby screen behind it either", () => {
    expect(() => sourceOf("lib/lobby/lobby-screen.svelte")).toThrow();
    expect(() => sourceOf("lib/landing/landing-screen.svelte")).toThrow();
  });

  it("keeps no component from the four-panel deck", () => {
    // The rejoin PANEL became a strip and the standing code+password field became the counter;
    // both old files are deleted rather than left importable (no-legacy directive).
    expect(() => sourceOf("lib/landing/rejoin-panel.svelte")).toThrow();
    expect(() => sourceOf("lib/lobby/room-code-field.svelte")).toThrow();
  });
});
