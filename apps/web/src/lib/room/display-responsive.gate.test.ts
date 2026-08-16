// The display is not only a projector.
//
// A host checking their own room from their hand is an ordinary thing to do, and the failure
// mode is worse than "small": the projector layout is a FIXED, inset-0, overflow-hidden pane,
// so on a phone everything past the first viewport height is not shrunk, it is unreachable.
// These are source-level gates because that is what a headless test can actually see - CSS
// media queries do not resolve in an SSR render, and adding a browser to `pnpm test` for a
// layout would break the PR gate (docs/design/surfaces.md's standing note about the diorama).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import DisplayScreen from "#lib/room/display-screen.svelte";
import { LocalSimRoomStore } from "#lib/room/local-sim-store.svelte.ts";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(sourceRoot + relativePath, "utf8");
}

const screen = source("lib/room/display-screen.svelte");
const route = source("routes/room/[code]/display/+page.svelte");
/** The one breakpoint, catching a phone in both orientations and neither laptop nor projector. */
const compactQuery = "@media (max-width: 48rem), (max-height: 26rem)";

describe("the display survives a phone", () => {
  it("declares the compact breakpoint in both the screen and its shell", () => {
    expect(screen).toContain(compactQuery);
    expect(route).toContain(compactQuery);
  });

  it("stops being a fixed pane, so the page can scroll", () => {
    // The shell and the screen are BOTH fixed/inset for the projector; either one left behind
    // re-traps the page at one viewport height, which is the whole bug.
    const compactScreen = screen.slice(screen.indexOf(compactQuery));
    expect(compactScreen).toMatch(/\.display-screen \{[^}]*position: static/);
    expect(compactScreen).toMatch(/\.display-screen \{[^}]*overflow: visible/);
    const compactRoute = route.slice(route.indexOf(compactQuery));
    expect(compactRoute).toMatch(/\.display-shell \{[^}]*position: static/);
  });

  it("gives the type scale a width term - the projector scale is height-only", () => {
    const compactScreen = screen.slice(screen.indexOf(compactQuery));
    for (const token of ["--board-category-size", "--board-value-size", "--clue-text-size"]) {
      const line = new RegExp(`${token}: clamp\\([^)]*vw`);
      expect(compactScreen, token).toMatch(line);
    }
  });

  it("makes the scores scrollable rather than letting them push the board away", () => {
    const compactScreen = screen.slice(screen.indexOf(compactQuery));
    expect(compactScreen).toMatch(/\.display-scores \{[^}]*overflow-y: auto/);
  });

  it("scrolls the board sideways instead of shrinking columns into illegibility", () => {
    const compactScreen = screen.slice(screen.indexOf(compactQuery));
    expect(compactScreen).toMatch(/\.board-holder \{[^}]*overflow-x: auto/);
    expect(compactScreen).toContain("min-width: 34rem");
  });

  it("puts the staged lobby into the flow rather than floating it over the content", () => {
    const compactScreen = screen.slice(screen.indexOf(compactQuery));
    expect(compactScreen).toMatch(/\.diorama-layer \{[^}]*position: static/);
    expect(compactScreen).toMatch(/\.diorama-layer \{[^}]*order: 2/);
  });

  it("keeps the pause veil over the viewport once the page scrolls", () => {
    const compactScreen = screen.slice(screen.indexOf(compactQuery));
    expect(compactScreen).toMatch(/\.pause-veil \{[^}]*position: fixed/);
  });

  it("ships the viewport meta - without it a phone renders a 980px desktop page", () => {
    expect(route).toContain('name="viewport"');
    expect(route).toContain("width=device-width");
  });

  it("uses no fixed pixel layout sizes anywhere in the screen", () => {
    // Everything that positions or scales is relative (rem/vw/vh/%/clamp), so there is no
    // dimension that can be right on a projector and wrong on a phone. A radius is not a
    // layout size, which is why one is allowed through by name.
    const styles = screen.slice(screen.indexOf("<style>"));
    const pixelDeclarations = [
      ...styles.matchAll(
        /^\s*(width|height|font-size|padding|margin|gap|min-width|max-width|min-height|max-height):[^;]*\d+px/gm,
      ),
    ];
    expect(pixelDeclarations.map((match) => match[0].trim())).toEqual([]);
  });
});

describe("the display's lobby is the staged lobby on any device", () => {
  it("renders the staged layout server-side, which is also the no-WebGL case", () => {
    const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "display", seed: "mobile" });
    const { body } = render(DisplayScreen, { props: { store, joinOrigin: "https://play.test" } });
    // The title screen's own content, plus the staging beneath it.
    expect(body).toContain("TESTA");
    expect(body).toContain("staged-lobby");
    expect(body).toContain("the water");
  });

  it("goes back to the free-roaming diorama once the game is running", () => {
    const store = new LocalSimRoomStore({ roomCode: "TESTA", role: "display", seed: "mobile" });
    store.startGame();
    store.endRound();
    const { body } = render(DisplayScreen, { props: { store } });
    expect(body).not.toContain("staged-lobby");
  });
});
