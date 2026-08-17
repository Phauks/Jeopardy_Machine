// Two invariants that live in CSS and in the route tree rather than in rendered markup, so
// they are gated against the source itself.
//
// 1. NO REFLOW. The standing layout law (docs/decisions/2026-08-16-persistent-layout-and-
//    pregame-rework.md): "reserve the space up front so nothing reflows when content arrives",
//    and prose gets a hard measure so it breaks where the design decided rather than where the
//    window happens to end. A rendered DOM cannot prove this - there is no layout engine in
//    these tests - but the declarations that produce it can be required to exist.
// 2. NO /lobby. It folded back into the front door and was DELETED, with no redirect kept
//    (docs/research/00-user-directives.md, "No legacy code"). A route that quietly reappears,
//    or a link that outlives it, is the failure this half of the gate catches.
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

  it("reserves the join note's block, so a code-wins message moves nothing", () => {
    expect(frontDoor).toMatch(/\.join-note\s*{[^}]*min-height/);
  });

  it("gives the hero's lead and supporting line a hard measure each", () => {
    expect(frontDoor).toMatch(/\.lead\s*{[^}]*max-inline-size:\s*\d+ch/);
    expect(frontDoor).toMatch(/\.support\s*{[^}]*max-inline-size:\s*\d+ch/);
    // A balanced short lead is what keeps "Quiz night, on everyone's phone." from breaking
    // into one word on a line of its own.
    expect(frontDoor).toMatch(/\.lead\s*{[^}]*text-wrap:\s*balance/);
  });

  it("reserves the create form's verdict block, so validation never shifts the button", () => {
    expect(sourceOf("lib/landing/create-room-panel.svelte")).toMatch(
      /\.verdict\s*{[^}]*min-height/,
    );
  });

  it("reserves the room list's block, so all four of its states are the same size", () => {
    expect(sourceOf("lib/lobby/room-browser.svelte")).toMatch(/\.room-browser\s*{[^}]*min-height/);
  });

  it("declares one type scale and one spacing rhythm instead of ad-hoc sizes", () => {
    for (const token of ["--step-0", "--step-display", "--space-1", "--space-7", "--rule"]) {
      expect(frontDoor).toContain(`${token}:`);
    }
  });
});

describe("the front door is the only door", () => {
  it("has no /lobby route left to visit", () => {
    expect(routeNames()).not.toContain("lobby");
  });

  it("keeps no lobby screen behind it either", () => {
    expect(() => sourceOf("lib/lobby/lobby-screen.svelte")).toThrow();
    expect(() => sourceOf("lib/landing/landing-screen.svelte")).toThrow();
  });
});
