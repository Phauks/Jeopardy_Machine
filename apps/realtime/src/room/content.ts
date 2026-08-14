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
import type { ContentItem, GameDefinitionBody } from "@jeopardy/protocol";
import type { ClueContent, ClueContentTarget } from "@jeopardy/protocol/room/server-messages";
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
 * Cut resolved content down to what one role may see. The single implementation of the
 * redaction table - if a client ever shows an answer it should not have, the bug is here.
 */
export function clueContentFor(
  role: RoomRole,
  resolved: { category: string; item: ContentItem; target: ClueContentTarget },
  options: { clueTextOnPhones: boolean },
): ClueContent {
  const promptAllowed =
    role === "host" || role === "display" || role === "spectator" ? true : options.clueTextOnPhones;
  return {
    target: resolved.target,
    category: resolved.category,
    prompt: promptAllowed
      ? {
          text: resolved.item.prompt.text,
          ...(resolved.item.prompt.media !== undefined && { media: resolved.item.prompt.media }),
        }
      : null,
    answer:
      role === "host"
        ? {
            canonical: resolved.item.answer.canonical,
            accepted: resolved.item.answer.accepted,
            ...(resolved.item.answer.media !== undefined && { media: resolved.item.answer.media }),
          }
        : null,
  };
}
