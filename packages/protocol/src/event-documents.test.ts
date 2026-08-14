// The first-event documents (events/board-game-club-x-els/) validated through the public
// entry point, exactly as an import would open them. This is a referential-integrity gate for
// REAL data, not a schema unit test: the board draft's curation contract (every cell resolves,
// bench and alternate clues ride along unreferenced, picture cells carry verified remote media,
// the external pack link hashes to the exact sibling file bytes) must survive any hand-edit to
// those JSON files.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePortableDocument } from "./index.ts";
import { resolveGameRules } from "./index.ts";
import type { ContentPack, GameDefinition } from "./index.ts";

const eventDirectory = new URL("../../../events/board-game-club-x-els/", import.meta.url);
const packBytes = readFileSync(new URL("event-pack.pack.json", eventDirectory));
const gameBytes = readFileSync(new URL("event-game.game.json", eventDirectory));

function openDocument(bytes: Buffer) {
  const result = parsePortableDocument(JSON.parse(bytes.toString("utf8")));
  if (!result.ok) throw new Error(`event document failed to parse: ${result.reason}`);
  return result;
}

const packResult = openDocument(packBytes);
const gameResult = openDocument(gameBytes);
if (packResult.document.format !== "content-pack") throw new Error("pack has the wrong format");
if (gameResult.document.format !== "game-definition") throw new Error("game has the wrong format");
const pack: ContentPack = packResult.document;
const game: GameDefinition = gameResult.document;

const itemsById = new Map(pack.body.items.map((item) => [item.id, item]));
const mediaById = new Map(pack.body.media.map((asset) => [asset.id, asset]));
const boardCells = game.body.rounds.flatMap((round) =>
  round.categories.flatMap((category) => category.cells),
);
const referencedItemIds = new Set(boardCells.map((cell) => cell.itemId));
if (game.body.final) referencedItemIds.add(game.body.final.itemId);

// An item is either played (board cell or the final pick) or curation stock (bench swap,
// alternate category, final alternate) - the tag vocabulary the README's swap tables key on.
const stockMarkerTags = ["bench", "alternate-category", "final-alternate"];

describe("event documents open through the public entry point", () => {
  it("parses both files at their current schema versions with no migration", () => {
    expect(packResult.migratedFrom).toBeNull();
    expect(gameResult.migratedFrom).toBeNull();
  });

  it("carries the full curated inventory: two 6x5 boards plus a final", () => {
    expect(game.body.rounds).toHaveLength(2);
    for (const round of game.body.rounds) {
      expect(round.categories).toHaveLength(6);
      for (const category of round.categories) expect(category.cells).toHaveLength(5);
    }
    expect(boardCells).toHaveLength(60);
    expect(game.body.final?.category).toBe("Superlative Organisms");
  });
});

describe("cell-to-item reference integrity", () => {
  it("resolves every board cell and the final to a distinct pack item", () => {
    for (const cell of boardCells) expect(itemsById.has(cell.itemId)).toBe(true);
    expect(game.body.final && itemsById.has(game.body.final.itemId)).toBe(true);
    // 60 cells + 1 final, no item played twice.
    expect(referencedItemIds.size).toBe(61);
  });

  it("marks exactly the played items as board/final and everything else as stock - no orphans", () => {
    for (const item of pack.body.items) {
      const played = item.tags.includes("board") || item.tags.includes("final");
      const stock = stockMarkerTags.some((marker) => item.tags.includes(marker));
      if (referencedItemIds.has(item.id)) {
        expect(played).toBe(true);
        expect(stock).toBe(false);
      } else {
        // Bench and alternates are present-but-unreferenced by design (one-line swaps).
        expect(played).toBe(false);
        expect(stock).toBe(true);
      }
    }
  });

  it("keeps row values on the scheme - no per-cell value overrides were authored", () => {
    for (const cell of boardCells) expect(cell.value).toBeUndefined();
    expect(game.body.valueScheme).toEqual({ kind: "preset", preset: "tv" });
    expect(game.body.rounds[1]?.valueMultiplier).toBe(2);
  });

  it("places the three authored Double-Down cells exactly per the board draft", () => {
    const wagerPositions: string[] = [];
    for (const [roundIndex, round] of game.body.rounds.entries()) {
      expect(round.wagerPlacement).toBe("manual");
      for (const [categoryIndex, category] of round.categories.entries()) {
        for (const [rowIndex, cell] of category.cells.entries()) {
          if (cell.wager) wagerPositions.push(`${roundIndex}:${categoryIndex}:${rowIndex}`);
        }
      }
    }
    // Round 1: Before It Was Cardboard $800 - round 2: Games in Spaaace $1200 and
    // Legends & Landfills $1200 (docs/content/event-board-draft.md section 5).
    expect(wagerPositions).toEqual(["0:4:3", "1:0:2", "1:4:2"]);
  });
});

describe("media references", () => {
  it("resolves every item media ref, and every asset is referenced by at least one item", () => {
    const referencedMediaIds = new Set<string>();
    for (const item of pack.body.items) {
      for (const reference of [item.prompt.media, item.answer.media]) {
        if (!reference) continue;
        expect(mediaById.has(reference.mediaId)).toBe(true);
        referencedMediaIds.add(reference.mediaId);
      }
    }
    expect(referencedMediaIds.size).toBe(pack.body.media.length);
  });

  it("gives every picture item both a prompt image and a labeled-reveal answer image", () => {
    const pictureItems = pack.body.items.filter((item) => item.tags.includes("picture"));
    expect(pictureItems).toHaveLength(8); // 5 board cells + 3 bench swaps
    for (const item of pictureItems) {
      expect(item.prompt.media).toBeDefined();
      expect(item.answer.media).toEqual(item.prompt.media);
    }
  });

  it("stores all assets as remote Commons originals with a verification record in ext", () => {
    const verification = pack.ext?.["com.jeopardy-machine.event.media-verification"] as
      | Record<string, { filePage?: unknown; license?: unknown }>
      | undefined;
    expect(verification).toBeDefined();
    for (const asset of pack.body.media) {
      expect(asset.kind).toBe("image");
      if (asset.storage.state !== "remote") throw new Error(`asset ${asset.id} is not remote`);
      expect(asset.storage.url.startsWith("https://upload.wikimedia.org/wikipedia/commons/")).toBe(
        true,
      );
      const record = verification?.[asset.id];
      expect(record).toBeDefined();
      expect(String(record?.filePage).startsWith("https://commons.wikimedia.org/wiki/File:")).toBe(
        true,
      );
      expect(typeof record?.license).toBe("string");
    }
  });
});

describe("pack attachment and rules", () => {
  it("links the external pack by its ext library id and the sha256 of the exact file bytes", () => {
    if (game.body.content.kind !== "external") throw new Error("expected an external pack link");
    expect(game.body.content.packId).toBe(pack.ext?.["com.jeopardy-machine.library-id"]);
    const packFileSha256 = createHash("sha256").update(packBytes).digest("hex");
    expect(game.body.content.sha256).toBe(packFileSha256);
  });

  it("resolves the inline house rules: teams, floored deductions, everyone in the final", () => {
    expect(game.body.rules.kind).toBe("inline");
    const settings = resolveGameRules(game.body.rules);
    expect(settings.teams.playerMode).toBe("teams");
    expect(settings.teams.teamBuzzer).toBe("any-member");
    expect(settings.scoring.wrongAnswerPenalty).toBe("floor-at-zero");
    expect(settings.final.eligibility).toBe("everyone");
    // Casual-party base retained where the event made no call.
    expect(settings.end.tieForFirst).toBe("co-champions");
    expect(settings.scoring.questionFormatRequired).toBe("off");
    expect(settings.wagers.label).toBe("Double Down");
  });

  it("uses the Terra Verde preset theme", () => {
    expect(game.body.theme).toEqual({ kind: "preset", preset: "terra-verde" });
  });
});
