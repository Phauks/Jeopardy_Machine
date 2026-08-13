// Server-render smoke test, same pattern as board-display.test.ts: SSR through
// svelte/server exercises the real component tree (lobby state, key help, theme scope).
// Interactive coverage lives headlessly in lib/hotseat/sample-game.test.ts (the full-game
// engine drive); browser-mode interaction tests arrive with the M4 surfaces.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import HotseatPage from "./+page.svelte";

describe("hotseat page server render", () => {
  const { body } = render(HotseatPage, { props: {} });

  it("renders the lobby with the start affordance and key help", () => {
    expect(body).toContain("Hotseat");
    expect(body).toContain("Start game (S)");
    expect(body).toContain("buzz as player");
  });

  it("starts in the engine lobby phase", () => {
    expect(body).toContain("<strong>lobby</strong>");
  });
});
