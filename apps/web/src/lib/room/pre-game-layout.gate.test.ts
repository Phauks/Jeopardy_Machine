// Invariant gate for the pre-game surface's LAYOUT, held at the source level.
//
// Two things here are easy to undo by accident months from now and expensive to notice:
//
// 1. THE WIDE LAYOUT. "Laptops and desktops are first-class play devices ... the current
//    layouts are tall thin columns that look wrong on a laptop - they need a wide layout, not a
//    stretched phone" (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md). A
//    genuinely wide layout is one line of CSS away from being deleted as "unused", and no unit
//    test that renders markup would notice, because the markup is identical at every width.
//
// 2. THE RESERVED SPACE. "Reserve the space up front so nothing reflows when content arrives."
//    Every region's reservation is a min-height or a fixed slot in its own stylesheet; without
//    a gate, the first person to tidy up "a min-height that does nothing" reintroduces the
//    jumping this surface was rebuilt to stop.
//
// Source-level, like the motion guardrails next door (src/lib/diorama/motion-guardrails.gate.
// test.ts), and for the same reason: the violation is visible in the source, and catching it
// needs no browser, no GPU, and no CI browser download.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const libDirectory = fileURLToPath(new URL("../", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(libDirectory + relativePath, "utf8");
}

const screen = source("room/pre-game-screen.svelte");

describe("the pre-game surface is laid out for a laptop, not just a phone", () => {
  it("measures the SURFACE rather than the device", () => {
    // A container query, not a media query: a narrow window on a big monitor should get the
    // phone layout, and a media query cannot tell the difference.
    expect(screen).toContain("container-type: inline-size");
    expect(screen).toMatch(/@container \(min-width: \d+rem\)/);
  });

  it("puts the three regions side by side at laptop width", () => {
    const wide = screen.slice(screen.indexOf("@container (min-width: 64rem)"));
    expect(wide).toContain('grid-template-areas: "character teams roster"');
    // Three real tracks, and the teams column is the elastic one - it holds a grid of cards
    // plus the staged lobby, so it is the region that should absorb extra width.
    expect(wide).toMatch(/grid-template-columns:\s*minmax\([^)]*\)\s*minmax\(0, 1fr\)\s*minmax/);
  });

  it("has a genuine intermediate layout, not one jump from column to three", () => {
    expect(screen).toContain("@container (min-width: 48rem)");
    expect(screen).toContain('"character teams"');
  });

  it("stops the action bar sticking to the bottom of a laptop window", () => {
    // Sticky is right on a phone, where the pickers are long. On a laptop the bar sits at the
    // end of a page that fits, and a floating bar there just covers content.
    const wide = screen.slice(screen.indexOf("@container (min-width: 64rem)"));
    expect(wide).toMatch(/\.action-bar \{[^}]*position: static/);
  });

  it("grows the character preview on a laptop instead of leaving a phone-sized one", () => {
    const wide = screen.slice(screen.indexOf("@container (min-width: 64rem)"));
    expect(wide).toContain("--character-preview-size");
  });

  it("starts as a single readable column on a phone", () => {
    const narrow = screen.slice(0, screen.indexOf("@container"));
    expect(narrow).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(narrow).toMatch(/\.action-bar \{[^}]*position: sticky/);
  });
});

describe("every region reserves its space, so arriving data never reflows the page", () => {
  const reservations: readonly (readonly [string, string, RegExp])[] = [
    // The avatar preview's box, so swapping avatars or finishing a recolor moves nothing.
    ["room/character-panel.svelte", ".preview", /\.preview \{[^}]*min-height:/],
    // The name error's line, so an error appearing does not shove the pickers down.
    ["room/character-panel.svelte", ".validation", /\.validation \{[^}]*min-height:/],
    // The teams lede changes sentence as you move between states; the cards must not slide.
    ["room/teams-panel.svelte", ".region-note", /\.region-note \{[^}]*min-height:/],
    // The staged lobby's band, reserved before the 3D stage has loaded anything.
    ["room/teams-panel.svelte", ".stage", /\.stage \{[^}]*min-height:/],
    // The refusal line, so a locked-team notice does not push the grid down.
    ["room/teams-panel.svelte", ".refusal", /\.refusal \{[^}]*min-height:/],
    ["room/teams-panel.svelte", ".validation", /\.validation \{[^}]*min-height:/],
    // The roster's waiting line holds three different sentences of different lengths.
    ["room/roster-panel.svelte", ".waiting-line", /\.waiting-line \{[^}]*min-height:/],
    // A roster row's chip slot, so names line up whether or not someone picked an avatar.
    ["room/roster-panel.svelte", ".chip-slot", /\.chip-slot \{[^}]*width:/],
  ];

  for (const [file, selector, pattern] of reservations) {
    it(`${file} reserves ${selector}`, () => {
      expect(source(file)).toMatch(pattern);
    });
  }

  it("keeps a team card the same height whether or not you are on it", () => {
    // The join button is replaced by a status line with the same padding and border box, so
    // boarding a team does not shorten one card in a grid of them.
    const card = source("room/team-card.svelte");
    expect(card).toMatch(/\.your-team \{[^}]*padding: 0\.5rem/);
    expect(card).toMatch(/\.your-team \{[^}]*border: 1px solid transparent/);
    expect(card).toMatch(/\.join-button \{[^}]*padding: 0\.5rem/);
  });
});
