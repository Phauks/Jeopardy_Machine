// THE RULE THIS GATE HOLDS: a control panel is never painted by the thing it controls.
//
// It has now been broken twice in the same way. The theme gallery's preset picker rendered in
// the preset under review and vanished on the light paper theme (dev-gallery bug, 2026-08-13);
// the host console's settings cog rendered in the ROOM's theme, so the type-scale sliders wore
// a condensed poster face at whatever contrast that theme gave them (owner, 2026-08-17:
// "Display text size and other settings show the theme assets, which makes them difficult to
// read"). Both times the surface looked fine under the theme it was built against.
//
// Asserted at source level, like display-responsive.gate.test.ts, because CSS custom properties
// do not resolve in an SSR render: nothing an SSR markup test can assert would have caught
// either bug. The check is deliberately crude - a themed token inside a control panel's style
// block is the bug - with one sanctioned exception: a PREVIEW is a picture of the theme and is
// supposed to look like one.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Panels a host operates the room with. Both are chrome; neither may be themed. */
const controlPanels = ["../room/host-roster-panel.svelte", "./settings-panel.svelte"] as const;

/** Selectors allowed to consume theme tokens, and why each one is a picture and not a control. */
const themedSelectorAllowList = [
  // The display type-scale preview: same tokens, same calc, same faces as the projector, so
  // what the host judges is what the room will see (settings-panel.svelte).
  ".preview",
  ".preview-category",
  ".preview-value",
];

const themedTokenPattern =
  /var\(--(?:font-|surface-|accent|board-|clue-text|page-bg|effect-|score-)/;

function styleBlockOf(relativePath: string): string {
  const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  const start = source.indexOf("<style>");
  const end = source.lastIndexOf("</style>");
  expect(start, `${relativePath} has a style block`).toBeGreaterThan(-1);
  return source.slice(start + "<style>".length, end);
}

/** Rule-sized chunks: everything up to and including each declaration block's closing brace. */
function cssRules(styleBlock: string): { selector: string; body: string }[] {
  const withoutComments = styleBlock.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const rules: { selector: string; body: string }[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" });
  }
  return rules;
}

describe("the host's control panels are not painted by the room's theme", () => {
  for (const panel of controlPanels) {
    it(`${panel} consumes only the fixed --control-* palette`, () => {
      const offenders = cssRules(styleBlockOf(panel))
        .filter((rule) => themedTokenPattern.test(rule.body))
        .filter(
          (rule) =>
            !themedSelectorAllowList.some((allowed) =>
              rule.selector.split(",").some((part) => part.trim().startsWith(allowed)),
            ),
        );
      expect(
        offenders.map((rule) => rule.selector),
        "a control panel may not consume theme tokens - use --control-* (src/lib/theme/tokens.css)",
      ).toEqual([]);
    });

    it(`${panel} actually paints from the control palette`, () => {
      // The inverse of the check above: a panel that used NO tokens at all would pass the first
      // assertion and be a pile of hand-picked hexes, which is how the palette drifts.
      expect(styleBlockOf(panel)).toContain("var(--control-");
    });
  }

  it("the control palette is fixed, and lives outside the theme contract", () => {
    const tokens = readFileSync(
      fileURLToPath(new URL("../theme/tokens.css", import.meta.url)),
      "utf8",
    );
    for (const token of [
      "--control-font",
      "--control-page",
      "--control-raised",
      "--control-border",
      "--control-text",
      "--control-text-muted",
      "--control-accent",
      "--control-danger",
    ]) {
      expect(tokens, token).toContain(`${token}:`);
    }
    // Fixed values: a control token derived from a theme color is a themed token with extra
    // steps, and would fail exactly where the two original bugs failed.
    const block = tokens.slice(
      tokens.indexOf("--control-font"),
      tokens.indexOf("--control-radius"),
    );
    expect(block).not.toContain("var(--");
    expect(block).not.toContain("color-mix");
  });
});
