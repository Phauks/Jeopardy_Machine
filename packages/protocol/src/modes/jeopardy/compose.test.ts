// The game <-> pack join, against the REAL event documents rather than a fixture, because the
// thing being proved is that the event night can actually be hosted: the club night's game is
// an external-pack game, and until this module existed there was no way to turn it
// into something a room could be created from.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { embedContentPack, referencedItemIds } from "./compose.ts";
import { parsePortableDocument } from "../../migrations/registry.ts";
import type { ContentPack } from "../../content/content-pack.ts";
import type { GameDefinition } from "./game-definition.ts";

const eventDirectory = new URL(
  "../../../../../apps/web/static/games/board-game-club-x-els/",
  import.meta.url,
);

function readEvent(name: string): { text: string; sha256: string } {
  const bytes = readFileSync(new URL(name, eventDirectory));
  return { text: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function eventGame(): GameDefinition {
  const parsed = parsePortableDocument(JSON.parse(readEvent("event-game.game.json").text));
  if (!parsed.ok) throw new Error("the event game no longer parses");
  return parsed.document as GameDefinition;
}

function eventPack(): { pack: ContentPack; sha256: string } {
  const file = readEvent("event-pack.pack.json");
  const parsed = parsePortableDocument(JSON.parse(file.text));
  if (!parsed.ok) throw new Error("the event pack no longer parses");
  return { pack: parsed.document as ContentPack, sha256: file.sha256 };
}

describe("referencedItemIds", () => {
  it("collects every cell and the final clue, in board order", () => {
    const game = eventGame();
    const ids = referencedItemIds(game.body);
    // Two rounds of six categories of five cells, plus the final.
    expect(ids).toHaveLength(61);
    expect(ids[0]).toBe(game.body.rounds[0]?.categories[0]?.cells[0]?.itemId);
    expect(ids.at(-1)).toBe(game.body.final?.itemId);
  });

  it("counts an item used twice once, so a reused picture is not reported as missing twice", () => {
    const game = eventGame();
    const repeated = structuredClone(game.body);
    const firstCell = repeated.rounds[0]?.categories[0]?.cells[0];
    const secondCell = repeated.rounds[0]?.categories[0]?.cells[1];
    if (firstCell === undefined || secondCell === undefined) throw new Error("board shape moved");
    secondCell.itemId = firstCell.itemId;
    expect(referencedItemIds(repeated)).toHaveLength(60);
  });
});

describe("embedContentPack", () => {
  it("joins the event game to its pack, and the result covers every cell", () => {
    const game = eventGame();
    const { pack, sha256 } = eventPack();
    expect(game.body.content.kind).toBe("external");

    const result = embedContentPack(game, pack, sha256);
    if (!result.ok) throw new Error(`refused: ${result.message}`);
    expect(result.embedded).toBe(true);

    const content = result.definition.body.content;
    if (content.kind !== "embedded") throw new Error("content did not become embedded");
    expect(content.pack.body.items).toHaveLength(pack.body.items.length);
    // The whole point: the room's resolver can now find every referenced item without the
    // creating device (apps/realtime/src/room/content.ts, itemById).
    const held = new Set(content.pack.body.items.map((item) => item.id));
    for (const id of referencedItemIds(result.definition.body)) expect(held.has(id)).toBe(true);
  });

  it("keeps the bench and alternate clues, rather than pruning to the board", () => {
    const { pack, sha256 } = eventPack();
    const result = embedContentPack(eventGame(), pack, sha256);
    if (!result.ok) throw new Error(result.message);
    const content = result.definition.body.content;
    if (content.kind !== "embedded") throw new Error("content did not become embedded");
    // 109 authored items behind a 61-cell board: the unreferenced ones are what a host swaps
    // in when a clue turns out to be a dud, and pruning would also change the document whose
    // hash and licence the definition cites.
    expect(content.pack.body.items.length).toBeGreaterThan(
      referencedItemIds(eventGame().body).length,
    );
  });

  it("preserves the meta and the ext bag of both documents", () => {
    const { pack, sha256 } = eventPack();
    const result = embedContentPack(eventGame(), pack, sha256);
    if (!result.ok) throw new Error(result.message);
    expect(result.definition.meta.title).toBe(eventGame().meta.title);
    // The event game's ext carries the pack path it was authored beside (boundary 2.6: ext
    // survives a round trip untouched).
    expect(result.definition.ext).toEqual(eventGame().ext);
    const content = result.definition.body.content;
    if (content.kind !== "embedded") throw new Error("content did not become embedded");
    expect(content.pack.meta.license).toBe(eventPack().pack.meta.license);
  });

  it("refuses a pack whose bytes are not the ones the game cites", () => {
    const { pack } = eventPack();
    const result = embedContentPack(eventGame(), pack, "0".repeat(64));
    if (result.ok) throw new Error("a mismatched pack was accepted");
    expect(result.reason).toBe("pack-mismatch");
    expect(result.message).toContain("not the one this game was built from");
  });

  it("skips the byte check when the caller has no bytes, rather than faking one", () => {
    // The library path joins two already-parsed documents and has no file to hash; the
    // coverage check below is what still protects it.
    const result = embedContentPack(eventGame(), eventPack().pack);
    expect(result.ok).toBe(true);
  });

  it("names the items a stale pack is missing instead of shipping blank cells", () => {
    const { pack, sha256 } = eventPack();
    const wanted = referencedItemIds(eventGame().body).slice(0, 2);
    const thinned: ContentPack = {
      ...pack,
      body: { ...pack.body, items: pack.body.items.filter((item) => !wanted.includes(item.id)) },
    };
    // Hash still matches - a pack can be the right FILE and still not cover the board, which
    // is why coverage is checked separately rather than trusted to the hash.
    const result = embedContentPack(eventGame(), thinned, sha256);
    if (result.ok) throw new Error("a pack missing two cells was accepted");
    if (result.reason !== "missing-items") throw new Error(`refused as ${result.reason}`);
    expect(result.missingItemIds).toEqual(wanted);
    expect(result.message).toContain("2 questions");
  });

  it("leaves an already-embedded game alone, and says it did nothing", () => {
    const { pack, sha256 } = eventPack();
    const embedded = embedContentPack(eventGame(), pack, sha256);
    if (!embedded.ok) throw new Error(embedded.message);
    // Re-embedding would swap the pack a self-contained file deliberately shipped with.
    const again = embedContentPack(embedded.definition, eventPack().pack, sha256);
    if (!again.ok) throw new Error(again.message);
    expect(again.embedded).toBe(false);
    expect(again.definition).toEqual(embedded.definition);
  });
});
