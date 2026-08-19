// Joining a game definition to its content pack - the step between "two files on disk" and
// "a room anyone can host".
//
// game-definition.ts states the rule this module implements: content may be EMBEDDED (a
// self-contained file) or EXTERNAL (game and pack stored separately, joined by the repository
// that holds both), and "importing an external game without its pack is a hard, friendly
// error". Until now nothing performed that join, so an authored game could be validated and
// never played: apps/realtime/src/room/content.ts resolves clue text from an EMBEDDED pack
// only, on purpose (an external pack lives in the creating device's library and was
// deliberately never uploaded - guiding principle 5), which makes embedding the thing "Host
// this game" has to do before the POST.
//
// Two checks, and they answer different questions:
//
// 1. IS THIS THE RIGHT PACK? Only the sha256 can say. Documents carry no id of their own
//    (envelope/document.ts is title/author/license/timestamps), so `content.packId` is an id
//    into the authoring device's library and means nothing to a file that arrived over the
//    internet. What the definition can carry is `content.sha256`, the hash of the pack file's
//    EXACT BYTES (tools/event-media-bake/README.md documents the ordering that keeps it true:
//    write, format, then hash what the formatter produced). Hash the bytes you read, not a
//    re-serialization of the parsed document - JSON.stringify of a parsed pack is a different
//    byte string and would fail every time.
// 2. DOES THIS PACK ACTUALLY COVER THE BOARD? A pack whose hash matches can still be missing
//    an item if the game was authored against a later revision, and the failure mode without
//    this check is silent: apps/realtime/src/room/content.ts answers `null` for an item it
//    cannot find, which the wire treats as "this role gets nothing" and a client renders as a
//    blank cell mid-game. So every referenced id is resolved HERE, before the room exists, and
//    the ones that are missing are named.
//
// The whole pack is embedded, not just the referenced items. Pruning would make the embedded
// pack a different document from the one whose hash and licence the definition cites, and the
// bench and alternate clues an authoring pack carries are exactly what a host reaches for when
// a clue turns out to be a dud. A 109-item pack is ~76 KB of JSON; the room POSTs it once.
import { contentPackSchema } from "../../content/content-pack.ts";
import { gameDefinitionSchema } from "./game-definition.ts";
import type { ContentPack } from "../../content/content-pack.ts";
import type { MediaAsset } from "../../content/media-ref.ts";
import type { GameDefinition, GameDefinitionBody } from "./game-definition.ts";

/**
 * Every content item this board needs, in board order and deduped - the board's cells followed
 * by the final clue's item.
 *
 * Deduped because a legitimate board may use one item twice (the same picture opening two
 * cells in different rounds), and a duplicate must not be reported as two missing items.
 */
export function referencedItemIds(body: GameDefinitionBody): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const take = (itemId: string): void => {
    if (seen.has(itemId)) return;
    seen.add(itemId);
    ordered.push(itemId);
  };
  for (const round of body.rounds) {
    for (const category of round.categories) {
      for (const cell of category.cells) take(cell.itemId);
    }
  }
  if (body.final !== null) take(body.final.itemId);
  return ordered;
}

export type EmbedRefusal =
  /** The pack is not the one this game cites: its bytes hash to something else. */
  | { reason: "pack-mismatch"; expectedSha256: string; actualSha256: string; message: string }
  /** The pack parses and may even hash right, but the board points at items it does not hold. */
  | { reason: "missing-items"; missingItemIds: string[]; message: string };

export type EmbedResult =
  | { ok: true; definition: GameDefinition; embedded: boolean }
  | ({ ok: false } & EmbedRefusal);

/**
 * Join a game definition to a content pack, returning a self-contained definition a room can
 * be created from.
 *
 * `packSha256` is the hash of the pack FILE's bytes, when the caller has them (a file picked
 * from disk, a static asset fetched by the app). Omit it and the byte check is skipped rather
 * than faked - the coverage check below still runs, and it is the one that catches the failure
 * that would otherwise reach a player as a blank cell.
 *
 * A definition that already embeds its content is returned unchanged with `embedded: false`,
 * because re-embedding would swap the pack a self-contained file deliberately shipped.
 */
export function embedContentPack(
  definition: GameDefinition,
  pack: ContentPack,
  packSha256?: string,
): EmbedResult {
  if (definition.body.content.kind === "embedded") {
    return { ok: true, definition, embedded: false };
  }

  const expected = definition.body.content.sha256;
  if (expected !== undefined && packSha256 !== undefined && expected !== packSha256) {
    return {
      ok: false,
      reason: "pack-mismatch",
      expectedSha256: expected,
      actualSha256: packSha256,
      // Named for the person holding two files, not for the machine: the likely cause is the
      // wrong pack or an edited one, and both are fixed by finding the other file.
      message:
        "That question pack is not the one this game was built from. Either it is a different pack, or it has been edited since - open the game with the pack it shipped beside.",
    };
  }

  const held = new Set(pack.body.items.map((item) => item.id));
  const missingItemIds = referencedItemIds(definition.body).filter((id) => !held.has(id));
  if (missingItemIds.length > 0) {
    const count = missingItemIds.length;
    return {
      ok: false,
      reason: "missing-items",
      missingItemIds,
      message: `This game uses ${String(count)} question${count === 1 ? "" : "s"} that pack does not contain, so ${count === 1 ? "that cell" : "those cells"} would open blank. It is probably an older copy of the pack.`,
    };
  }

  // Re-parsed rather than spread into place: `content` is a discriminated union and the swap
  // changes which branch is live, so the cheap assertion is worth the round trip. It also
  // fails loudly here rather than at the server's own refusal if the pack is somehow invalid
  // in a position the standalone schema allows.
  const definitionValue: unknown = {
    ...definition,
    body: {
      ...definition.body,
      content: { kind: "embedded", pack: contentPackSchema.parse(pack) },
    },
  };
  return { ok: true, definition: gameDefinitionSchema.parse(definitionValue), embedded: true };
}

/**
 * Rewrite a pack's `bundled` media to `remote` URLs against the location the document was
 * loaded from - the step that has to happen before a game with pictures is HOSTED.
 *
 * `bundled` means "bytes at a media/-relative path beside this document" (content/media-ref.ts).
 * That is a statement about the authoring device's disk, and it stops being true the moment the
 * game travels: a phone in the room holds no document, so it has nothing to resolve the path
 * against. Only the client that loaded the document knows where it came from, so it is the one
 * that must turn those paths into URLs everybody can fetch - which is the same rewrite the
 * documented flow already describes for an upload, with "served by this origin" standing in for
 * "uploaded to R2".
 *
 * `baseUrl` is the document's own URL. Paths resolve against it exactly as a browser resolves a
 * relative link, so a game at `/games/night.game.json` finds `media/img-01.webp` at
 * `/games/media/img-01.webp`.
 *
 * Everything else is left alone: a `remote` asset already has a URL, and `pending-local` has no
 * bytes to point at - the room will send it with no `url` and surfaces fall back to alt text
 * rather than showing a broken image.
 */
export function resolveBundledMedia(pack: ContentPack, baseUrl: string): ContentPack {
  const media = pack.body.media.map((asset) => {
    if (asset.storage.state !== "bundled") return asset;
    return {
      ...asset,
      storage: { state: "remote" as const, url: new URL(asset.storage.path, baseUrl).href },
    };
  });
  return { ...pack, body: { ...pack.body, media } };
}

/**
 * The media a clue cell points at, looked up in the pack that travels with the game.
 *
 * Returns null for an id the pack does not hold, which is the same honest answer the item
 * lookup gives: the surface shows the clue's words and no picture, rather than a broken frame.
 */
export function mediaAssetById(pack: ContentPack, mediaId: string): MediaAsset | null {
  return pack.body.media.find((asset) => asset.id === mediaId) ?? null;
}
