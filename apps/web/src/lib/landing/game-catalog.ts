// WHICH GAME A ROOM OPENS WITH, and how each candidate becomes a hostable definition.
//
// Until now the front door always sent the built-in sample, which meant the one game this
// software exists to run - the club night - could be authored, validated, hashed and never
// played. The three sources here are the whole answer, and they are deliberately the same three
// shapes a suite has: something to try, something we shipped, something you brought.
//
// EVERY PATH ENDS IN A SELF-CONTAINED DEFINITION. A room resolves clue text and media from an
// EMBEDDED pack only (apps/realtime/src/room/content.ts), because an external pack lives in the
// authoring device's library and was deliberately never uploaded. So a game that links its pack
// must be joined to it before the POST (`embedContentPack`), and any media it carries as
// `bundled` - a path relative to the document - must become URLs the room can hand to thirty
// phones (`resolveBundledMedia`). Both steps happen HERE, on the client that knows where the
// files came from, because nobody downstream does.
//
// Nothing is fetched until a host picks it. The catalog is a list of names and loaders; the
// bytes arrive on the tap.
import { embedContentPack, parsePortableDocument, resolveBundledMedia } from "@jeopardy/protocol";
import type { ContentPack, GameDefinition } from "@jeopardy/protocol";

export type GameChoiceId = "sample" | "event" | "file";

export type GameCatalogEntry = {
  id: GameChoiceId;
  title: string;
  /** One line under the name - what a host gets, not what it is made of. */
  note: string;
};

/**
 * The games the front door offers by name. `file` is listed as a choice rather than hidden
 * behind an import affordance, because "the game I brought" is a first-class answer to "which
 * game" and not an advanced feature (owner's standing priority: import/export as first-class).
 */
export const gameCatalog: readonly GameCatalogEntry[] = [
  {
    id: "sample",
    title: "Sample game",
    note: "Built in - two rounds and a final, ready to play",
  },
  {
    id: "event",
    title: "Board Game Club x Environmental Law Society",
    note: "The club night: environment and gaming, with a picture round",
  },
  {
    id: "file",
    title: "A game file",
    note: "Open a .game.json you made or were sent",
  },
];

/** Where the event's shippable documents are served from, and what the media sits beside. */
export const eventGameBasePath = "/games/board-game-club-x-els/";

export type GameLoadResult =
  | { ok: true; definition: GameDefinition }
  | { ok: false; message: string };

/** Parse a document, naming the format we wanted when it turns out to be something else. */
function parseAs<Document>(
  text: string,
  expectedFormat: string,
  label: string,
): { ok: true; document: Document } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: `${label} is not readable as JSON.` };
  }
  const parsed = parsePortableDocument(raw);
  if (!parsed.ok) {
    return { ok: false, message: `${label} is not a valid document: ${parsed.detail}` };
  }
  if (parsed.document.format !== expectedFormat) {
    // Named by what it IS, because the usual mistake is picking the two files the wrong way
    // round and the fix is obvious once you are told.
    return {
      ok: false,
      message: `${label} is a ${parsed.document.format}, not a ${expectedFormat}.`,
    };
  }
  return { ok: true, document: parsed.document as Document };
}

/** sha256 of exactly these bytes - what a definition's `content.sha256` is measured against. */
async function sha256Of(text: string): Promise<string | undefined> {
  // Absent rather than faked where WebCrypto is not available (SSR, an insecure context): the
  // join then skips the byte check and still runs the coverage check, which is the one that
  // catches a stale pack (@jeopardy/protocol, embedContentPack).
  if (globalThis.crypto?.subtle === undefined) return undefined;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Turn a game definition and (when it needs one) its pack into something a room can be created
 * from: content embedded, media pointing at fetchable URLs.
 *
 * `packBaseUrl` is where the PACK was loaded from - media paths are relative to it, not to the
 * game. They usually sit in the same folder, which is why one base serves both.
 */
export function hostableDefinition(
  definition: GameDefinition,
  pack: ContentPack | null,
  options: { packSha256?: string; packBaseUrl?: string } = {},
): GameLoadResult {
  if (definition.body.content.kind === "embedded") {
    const embedded = definition.body.content.pack;
    const resolved =
      options.packBaseUrl === undefined
        ? embedded
        : resolveBundledMedia(embedded, options.packBaseUrl);
    return {
      ok: true,
      definition: {
        ...definition,
        body: { ...definition.body, content: { kind: "embedded", pack: resolved } },
      },
    };
  }
  if (pack === null) {
    // The "hard, friendly error" game-definition.ts has always promised for this case.
    return {
      ok: false,
      message:
        "That game keeps its questions in a separate pack file. Choose the .pack.json that came with it too.",
    };
  }
  const prepared =
    options.packBaseUrl === undefined ? pack : resolveBundledMedia(pack, options.packBaseUrl);
  const joined = embedContentPack(definition, prepared, options.packSha256);
  if (!joined.ok) return { ok: false, message: joined.message };
  return { ok: true, definition: joined.definition };
}

/**
 * Load the bundled event game: two documents served by this app, joined here.
 *
 * `origin` is passed in rather than read from `location` so this is testable and so a server
 * render cannot silently produce a definition whose media points at nothing.
 */
export async function loadEventGame(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GameLoadResult> {
  const base = new URL(eventGameBasePath, origin).href;
  try {
    const [gameResponse, packResponse] = await Promise.all([
      fetchImpl(new URL("event-game.game.json", base).href),
      fetchImpl(new URL("event-pack.pack.json", base).href),
    ]);
    if (!gameResponse.ok || !packResponse.ok) {
      return { ok: false, message: "The club night's game could not be loaded from this site." };
    }
    const gameText = await gameResponse.text();
    const packText = await packResponse.text();
    const game = parseAs<GameDefinition>(gameText, "game-definition", "The club night's game");
    if (!game.ok) return game;
    const pack = parseAs<ContentPack>(packText, "content-pack", "The club night's question pack");
    if (!pack.ok) return pack;
    return hostableDefinition(game.document, pack.document, {
      packSha256: await sha256Of(packText),
      packBaseUrl: base,
    });
  } catch (error) {
    return {
      ok: false,
      message: `The club night's game could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Load a game the host picked off their own disk, with its pack when they picked one.
 *
 * Media that is `bundled` stays unresolved on this path and reaches the room without a URL, so
 * a surface shows its alt text. That is the honest outcome: files chosen from a file input have
 * no address anybody else can fetch, and inventing one would put broken images on a projector.
 * Uploading them is R2's job (M5), and this path is what works before that lands.
 */
export async function loadGameFromFiles(files: readonly File[]): Promise<GameLoadResult> {
  if (files.length === 0) return { ok: false, message: "No file chosen." };
  const texts = await Promise.all(
    files.map(async (file) => ({ name: file.name, text: await file.text() })),
  );
  let definition: GameDefinition | null = null;
  let pack: ContentPack | null = null;
  let packText: string | null = null;
  for (const { name, text } of texts) {
    // The FORMAT decides which is which, never the filename - the importer has ignored names
    // since the envelope was designed (envelope/document.ts).
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, message: `${name} is not readable as JSON.` };
    }
    const parsed = parsePortableDocument(raw);
    if (!parsed.ok) {
      return { ok: false, message: `${name} is not a valid document: ${parsed.detail}` };
    }
    if (parsed.document.format === "game-definition") {
      definition = parsed.document as GameDefinition;
    } else if (parsed.document.format === "content-pack") {
      pack = parsed.document as ContentPack;
      // Hashed after the loop, not in it: the bytes are already in hand and the digest is the
      // one genuinely async step here.
      packText = text;
    } else {
      return {
        ok: false,
        message: `${name} is a ${parsed.document.format}. Choose a game file, and its question pack if it has one.`,
      };
    }
  }
  if (definition === null) {
    return { ok: false, message: "None of those files is a game - choose a .game.json." };
  }
  return hostableDefinition(definition, pack, {
    packSha256: packText === null ? undefined : await sha256Of(packText),
  });
}
