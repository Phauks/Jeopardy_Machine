// Which game a room opens with, and the join every path has to end in.
//
// The claim being proved is the one that blocks the club night: a game that keeps its questions
// in a separate pack, with pictures stored as paths beside it, has to come out of this module
// as something a room can be created from - content embedded, media pointing at URLs thirty
// phones can fetch. The real event documents are the fixture, because they are the case.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  eventGameBasePath,
  gameCatalog,
  hostableDefinition,
  loadEventGame,
  loadGameFromFiles,
} from "#lib/landing/game-catalog.ts";
import { parsePortableDocument } from "@jeopardy/protocol";
import type { ContentPack, GameDefinition } from "@jeopardy/protocol";

const eventDirectory = new URL("../../../static/games/board-game-club-x-els/", import.meta.url);
const origin = "https://quiz.test";

function readEvent(name: string): string {
  return readFileSync(new URL(name, eventDirectory)).toString("utf8");
}

function documentOf<Document>(name: string): Document {
  const parsed = parsePortableDocument(JSON.parse(readEvent(name)));
  if (!parsed.ok) throw new Error(`${name} no longer parses`);
  return parsed.document as Document;
}

/** A fetch that serves the committed event files, as the deployed app serves them. */
const serveEvent: typeof fetch = ((input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const name = url.pathname.slice(eventGameBasePath.length);
  try {
    return Promise.resolve(new Response(readEvent(name), { status: 200 }));
  } catch {
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
}) as typeof fetch;

describe("the catalog", () => {
  it("offers the built-in game, the club night, and a file the host brought", () => {
    expect(gameCatalog.map((entry) => entry.id)).toEqual(["sample", "event", "file"]);
  });
});

describe("loading the club night's game", () => {
  it("joins the two served documents into something a room can be created from", async () => {
    const result = await loadEventGame(origin, serveEvent);
    if (!result.ok) throw new Error(result.message);
    // Embedded, because the room resolves clue text from an embedded pack only
    // (apps/realtime/src/room/content.ts) - an external link would play a board of blanks.
    expect(result.definition.body.content.kind).toBe("embedded");
  });

  it("turns the picture round's bundled paths into URLs the room can hand out", async () => {
    const result = await loadEventGame(origin, serveEvent);
    if (!result.ok) throw new Error(result.message);
    const content = result.definition.body.content;
    if (content.kind !== "embedded") throw new Error("content did not become embedded");
    const media = content.pack.body.media;
    expect(media.length).toBeGreaterThan(0);
    for (const asset of media) {
      // A path relative to a document is a statement about the authoring device's disk, and a
      // phone holds no document. Every one of them must be an address by the time it travels.
      expect(asset.storage.state, asset.id).toBe("remote");
      if (asset.storage.state !== "remote") continue;
      expect(asset.storage.url.startsWith(`${origin}${eventGameBasePath}media/`), asset.id).toBe(
        true,
      );
    }
  });

  it("says so plainly when the site cannot serve them", async () => {
    const missing: typeof fetch = (() =>
      Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;
    const result = await loadEventGame(origin, missing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("could not be loaded");
  });
});

describe("a game the host brought", () => {
  function fileOf(name: string): File {
    return new File([readEvent(name)], name, { type: "application/json" });
  }

  it("takes a game and its pack together, deciding which is which by FORMAT", async () => {
    // Deliberately in the wrong order: the importer has ignored filenames since the envelope
    // was designed, and a host who picks them the other way round must not be punished.
    const result = await loadGameFromFiles([
      fileOf("event-pack.pack.json"),
      fileOf("event-game.game.json"),
    ]);
    if (!result.ok) throw new Error(result.message);
    expect(result.definition.body.content.kind).toBe("embedded");
  });

  it("gives the hard, friendly error when the pack was left behind", async () => {
    const result = await loadGameFromFiles([fileOf("event-game.game.json")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("separate pack file");
  });

  it("names what a wrong file actually is rather than refusing generically", async () => {
    const notADocument = new File(["{}"], "notes.json", { type: "application/json" });
    const result = await loadGameFromFiles([notADocument]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("notes.json");
  });

  it("leaves a brought game's bundled media without a url, rather than inventing one", async () => {
    // Files chosen from a file input have no address anybody else can fetch. The room then
    // sends the descriptor with no url and the surface shows alt text - which is honest, and
    // much better than a projector full of broken images.
    const definition = documentOf<GameDefinition>("event-game.game.json");
    const pack = documentOf<ContentPack>("event-pack.pack.json");
    const result = hostableDefinition(definition, pack);
    if (!result.ok) throw new Error(result.message);
    const content = result.definition.body.content;
    if (content.kind !== "embedded") throw new Error("content did not become embedded");
    expect(content.pack.body.media.every((asset) => asset.storage.state === "bundled")).toBe(true);
  });
});
