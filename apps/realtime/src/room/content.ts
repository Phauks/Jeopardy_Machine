// Clue content resolution and redaction - the room's answer to "what does this cell actually
// say?". Pure (no partyserver, no storage, no clocks); the DO calls it whenever a clue opens
// and when it hands out a snapshot with one already open.
//
// Why this exists at all: the engine deals in board coordinates and never sees a word of
// authored text (guiding principle 6 - a board is a presentation of content, not its owner),
// so the state machine cannot carry the clue to the display. The room can: it stored the
// creation-time game spec, so it resolves cell -> content item -> prompt/answer itself.
//
// REDACTION is the whole safety story (contract table in @jeopardy/protocol/room/
// server-messages, clueContentSchema):
// - the ANSWER goes to the host and to nobody else, ever - not the display, not a phone,
//   not a spectator, not in devtools;
// - the PROMPT goes to host/display/spectator always, and to players only when the room's
//   clueTextOnPhones setting is on (off by default: in a room, listening beats reading).
//
// A compact-spec room (the bots/tests/sim path) has no authored content at all; every lookup
// there answers null, which the wire treats as "this role gets nothing" and clients render as
// a board-only game. That is the honest answer, not a failure.
import { mediaAssetById } from "@jeopardy/protocol";
import type { ContentItem, ContentPack, GameDefinitionBody, MediaRef } from "@jeopardy/protocol";
import type { GameSetup } from "@jeopardy/engine/setup";
import type {
  BoardMaterial,
  ClueContent,
  ClueContentTarget,
  ResolvedMedia,
} from "@jeopardy/protocol/room/server-messages";
import type { RoomRole } from "@jeopardy/protocol/room/identity";
import type { RoomGameSpec } from "@jeopardy/protocol/room/create";

/** The board coordinates a clue lives at, as the engine's ClueState reports them. */
export type CellCoordinates = { roundIndex: number; category: number; row: number };

function definitionOf(spec: RoomGameSpec): GameDefinitionBody | null {
  return spec.kind === "definition" ? spec.body : null;
}

// Only EMBEDDED packs can be resolved server-side: an external pack lives in the creating
// device's library and was deliberately never uploaded (guiding principle 5, own your data).
// Hosting such a game sends board material only - which is why "Host this game" embeds.
function itemById(definition: GameDefinitionBody, itemId: string): ContentItem | null {
  if (definition.content.kind !== "embedded") return null;
  return definition.content.pack.body.items.find((item) => item.id === itemId) ?? null;
}

/** Full content for a board cell, before redaction. Null when the room has no authored text. */
export function resolveCellContent(
  spec: RoomGameSpec,
  cell: CellCoordinates,
): { category: string; item: ContentItem; target: ClueContentTarget } | null {
  const definition = definitionOf(spec);
  if (definition === null) return null;
  const category = definition.rounds[cell.roundIndex]?.categories[cell.category];
  const boardCell = category?.cells[cell.row];
  if (category === undefined || boardCell === undefined) return null;
  const item = itemById(definition, boardCell.itemId);
  if (item === null) return null;
  return {
    category: category.title,
    item,
    target: { kind: "cell", roundIndex: cell.roundIndex, category: cell.category, row: cell.row },
  };
}

/** Same, for the authored final clue (its category is named on the definition, not a board). */
export function resolveFinalContent(
  spec: RoomGameSpec,
): { category: string; item: ContentItem; target: ClueContentTarget } | null {
  const definition = definitionOf(spec);
  if (definition === null || definition.final === null) return null;
  const item = itemById(definition, definition.final.itemId);
  if (item === null) return null;
  return { category: definition.final.category, item, target: { kind: "final" } };
}

/**
 * The board a client paints before anything is open: category titles from the game definition,
 * face values from the ENGINE SETUP (so an authored per-cell override shows the number the
 * scoring actually uses, exactly as the mock's fixture view resolves it).
 *
 * Public by nature and therefore not redacted - these are the words and numbers already on the
 * wall. A compact-spec room (bots, tests, the sim path) has no authored titles, so its
 * categories come back as empty strings and the values alone carry the board; that is the
 * honest answer for a game that shipped no content, not a failure.
 */
export function boardMaterial(spec: RoomGameSpec, setup: GameSetup): BoardMaterial {
  const definition = definitionOf(spec);
  return {
    rounds: setup.rounds.map((round, roundIndex) => ({
      categoryTitles: round.cells.map(
        (_unusedColumn, categoryIndex) =>
          definition?.rounds[roundIndex]?.categories[categoryIndex]?.title ?? "",
      ),
      cellValues: round.cells.map((column) => column.map((cell) => cell.value)),
    })),
  };
}

/**
 * Cut resolved content down to what one role may see. The single implementation of the
 * redaction table - if a client ever shows an answer it should not have, the bug is here.
 */
export function clueContentFor(
  role: RoomRole,
  resolved: { category: string; item: ContentItem; target: ClueContentTarget },
  options: { clueTextOnPhones: boolean; pack?: ContentPack | null },
): ClueContent {
  const promptAllowed =
    role === "host" || role === "display" || role === "spectator" ? true : options.clueTextOnPhones;
  const media = (ref: MediaRef | undefined): ResolvedMedia | undefined =>
    ref === undefined ? undefined : resolveMedia(options.pack ?? null, ref);
  const promptMedia = media(resolved.item.prompt.media);
  const answerMedia = media(resolved.item.answer.media);
  return {
    target: resolved.target,
    category: resolved.category,
    prompt: promptAllowed
      ? {
          text: resolved.item.prompt.text,
          ...(promptMedia !== undefined && { media: promptMedia }),
        }
      : null,
    answer:
      role === "host"
        ? {
            canonical: resolved.item.answer.canonical,
            accepted: resolved.item.answer.accepted,
            ...(answerMedia !== undefined && { media: answerMedia }),
          }
        : null,
  };
}

/**
 * A content item's media REFERENCE (an id) becomes what a surface can paint: kind, type, alt
 * text, and a URL when the bytes are somewhere a client can fetch them.
 *
 * The room is the only participant that can do this. A document maps ids to bytes through its
 * own `media` table, and a phone holds no document - so sending the bare id, which is what the
 * wire did until 2026-08-19, told every client there WAS a picture and gave it nothing to do
 * about it. The lookup happens once here, per clue, on the pack the room was created with.
 *
 * An id the pack does not hold, or an asset whose bytes never left the authoring device
 * (`pending-local`), still produces a descriptor - without a `url`. That is deliberate: the
 * surface knows a picture was intended and shows its alt text, which is better than silence and
 * much better than a broken frame. `bundled` is the same case by the time it reaches a room:
 * the path was relative to a document nobody here has, and the client that DID have it was
 * supposed to resolve it before hosting (@jeopardy/protocol, resolveBundledMedia).
 */
function resolveMedia(pack: ContentPack | null, ref: MediaRef): ResolvedMedia {
  const asset = pack === null ? null : mediaAssetById(pack, ref.mediaId);
  if (asset === null) {
    // Nothing known but the id. `file` is the honest kind for "something was here": it is the
    // one kind no surface tries to play, so it degrades to a label rather than an empty player.
    return { mediaId: ref.mediaId, kind: "file", mime: "application/octet-stream" };
  }
  return {
    mediaId: asset.id,
    kind: asset.kind,
    mime: asset.mime,
    ...(asset.alt !== undefined && { alt: asset.alt }),
    ...(asset.storage.state === "remote" && { url: asset.storage.url }),
  };
}

/** The pack a room's game travels with, or null for a compact-spec room that shipped none. */
export function packOf(spec: RoomGameSpec): ContentPack | null {
  const definition = definitionOf(spec);
  if (definition === null || definition.content.kind !== "embedded") return null;
  return definition.content.pack;
}
