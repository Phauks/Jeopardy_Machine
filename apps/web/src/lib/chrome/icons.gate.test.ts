// ONE DRAWING FOR EVERY ICON (owner, 2026-08-20: "use lucide icons for icons and replace all
// custom svg's like the settings icon at the top right").
//
// Before this there were exactly two icons in the app and they were two hand-authored `<svg>`
// blocks - a gear in the masthead and a chevron on the home button - each a set of path data
// somebody had eyeballed against its own grid. Two is precisely the number at which the
// problem is invisible and the habit sets: nothing looked inconsistent, because there was
// almost nothing to be inconsistent WITH, and every future icon would have been drawn the
// same ad-hoc way.
//
// The rule that did NOT change is the one CLAUDE.md states: no emojis in the UI. The old
// comments also refused an icon FONT, and that objection was specific and correct - a whole
// download for one glyph. Per-icon Svelte components are tree-shaken, so the bundle carries
// the handful this app imports and nothing else, which is why lucide answers the same
// objection differently.
//
// Asserted at SOURCE level because nothing renders an absence: a hand-drawn icon that came
// back would look fine, ship fine, and simply be a second drawing style nobody noticed.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Every .svelte file under src/, recursively. */
function svelteFiles(directory: string = sourceRoot): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) {
      found.push(...svelteFiles(path));
      continue;
    }
    if (entry.endsWith(".svelte")) found.push(path);
  }
  return found;
}

describe("icons come from one set", () => {
  it("hand-authored <svg> appears in no component", () => {
    const offenders = svelteFiles().filter((path) => {
      const source = readFileSync(path, "utf8");
      // The QR code is generated SVG from `uqr` over the room's own join URL and arrives as a
      // string - it is a picture of data, not an icon, and there is no lucide equivalent for
      // "this room's address". It is injected with {@html}, so it never appears as literal
      // markup here and needs no exception.
      return source.includes("<svg");
    });
    expect(offenders.map((path) => path.slice(sourceRoot.length))).toEqual([]);
  });

  it("the two that used to be drawn by hand are lucide now", () => {
    const masthead = readFileSync(`${sourceRoot}/lib/landing/masthead-bar.svelte`, "utf8");
    expect(masthead).toContain('from "@lucide/svelte"');
    expect(masthead).toContain("<Settings");

    const home = readFileSync(`${sourceRoot}/lib/chrome/home-button.svelte`, "utf8");
    expect(home).toContain('from "@lucide/svelte"');
    expect(home).toContain("<ChevronLeft");
  });

  it("still forbids emojis in the UI, which lucide does not change (CLAUDE.md)", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const offenders = svelteFiles().filter((path) => emoji.test(readFileSync(path, "utf8")));
    expect(offenders.map((path) => path.slice(sourceRoot.length))).toEqual([]);
  });
});
