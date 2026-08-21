// THE RULE THIS GATE HOLDS: a room code is set in the legibility face, under every theme.
//
// The code is the only string in this product that exists to be COPIED - read off a projector
// or a laptop held above someone's head, then typed into a phone by somebody who gets one
// look at it. Until 2026-08-20 every surface rendered it in `--font-values`, the board's value
// face, which on the default preset is Six Caps: a condensed poster face where 0 and O, and 1
// and I, are very nearly the same shape. That is the right face for "$400", which nobody
// retypes, and the wrong one for five characters whose whole job is to survive the copy
// (owner: "wherever the join code is, we need to make sure that it is easy to read"; the face
// picked in answer: "use atkinsons hyperlegible next").
//
// `--font-legible` is deliberately OUTSIDE the theme contract (tokens.css), so this holds for
// presets nobody has authored yet. Asserted at source level for the same reason
// console-chrome.gate.test.ts is: custom properties do not resolve in an SSR render, so no
// markup assertion could catch a swapped token.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Every surface that puts the room code on a screen somebody reads it from. */
const codeSurfaces = [
  "../room/join-panel.svelte",
  "../room/display-screen.svelte",
  "../room/host-console.svelte",
] as const;

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/**
 * The declaration block for one selector, from its opening brace to its first closing one.
 * Crude on purpose - these are flat rule bodies, and a parser here would be a second thing to
 * keep correct.
 */
function ruleBodyFor(source: string, selector: string): string {
  const at = source.indexOf(`\n  ${selector} {`);
  expect(at, `${selector} exists`).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf("}", at));
}

describe("the room code is always set in the legibility face", () => {
  for (const surface of codeSurfaces) {
    it(`${surface} sets .room-code in --font-legible, not a theme face`, () => {
      const body = ruleBodyFor(sourceOf(surface), ".room-code");
      expect(body).toContain("var(--font-legible)");
      expect(body).not.toContain("var(--font-values)");
      expect(body).not.toContain("var(--font-display)");
    });
  }

  // The other half of the transcription: the box the code is typed INTO, on the front door.
  // Same argument, opposite direction - a person is comparing what they see against what they
  // have entered, and the two must be the same shapes.
  it("the front door's entry field is set in the same face the code is shown in", () => {
    const body = ruleBodyFor(sourceOf("../landing/entry-counter.svelte"), ".entry-input");
    expect(body).toContain("var(--font-legible)");
  });

  // The token itself: a face, then real fallbacks. A stack that falls back to nothing is a
  // stack that renders in whatever the browser feels like the first time a phone loads cold.
  it("--font-legible names the face and a fallback stack, and no theme can move it", () => {
    const tokens = sourceOf("./tokens.css");
    expect(tokens).toContain('"Atkinson Hyperlegible Next"');
    expect(tokens).toMatch(/--font-legible:[\s\S]*?sans-serif;/);
    // theme-to-css.ts writes the fontSlot tokens; --font-legible must not be among them.
    expect(sourceOf("./theme-to-css.ts")).not.toContain("--font-legible");
  });

  // The face has to actually ship, and as ONE variable file: Google serves the identical URL
  // for its 400 and 700 declarations, so a second @font-face here would mean somebody had
  // re-downloaded a static build and doubled the bytes for nothing.
  it("the face is declared once, over the whole weight range it covers", () => {
    const fonts = sourceOf("./fonts.css");
    const declarations = fonts.match(/font-family: "Atkinson Hyperlegible Next"/g) ?? [];
    expect(declarations).toHaveLength(1);
    expect(fonts).toContain("font-weight: 400 700");
    expect(fonts).toContain("/fonts/atkinson-hyperlegible-next-latin-variable.woff2");
  });
});
