// Server-render test: what the repo's plain-vitest setup supports today (no browser mode -
// docs/DEVELOPMENT.md). SSR through svelte/server exercises the real component: markup,
// props, and the token-only styling contract. Interaction coverage (open clue, mark used)
// needs browser mode and arrives with the M4 phase 2 surfaces.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import BoardDisplay from "#lib/board/board-display.svelte";
import { sampleBoard } from "#lib/board/sample-board.ts";

describe("board-display server render", () => {
  const { body } = render(BoardDisplay, { props: { board: sampleBoard } });

  it("renders every category header", () => {
    for (const category of sampleBoard.categories) {
      // SSR output is HTML-escaped ("Dice & Cards" -> "Dice &amp; Cards").
      expect(body).toContain(category.title.replaceAll("&", "&amp;"));
    }
  });

  it("renders every value cell with the currency label", () => {
    const buttonCount = (body.match(/<button/g) ?? []).length;
    const cellCount = sampleBoard.categories.reduce((sum, entry) => sum + entry.clues.length, 0);
    expect(buttonCount).toBe(cellCount);
    expect(body).toContain("$1000");
    expect(body).toContain("$200");
  });

  it("keeps clue text and answers off the board (clue overlay closed, display never shows responses)", () => {
    const firstClue = sampleBoard.categories[0]?.clues[0];
    expect(firstClue).toBeDefined();
    expect(body).not.toContain(firstClue?.clue);
    expect(body).not.toContain(firstClue?.response);
  });
});
