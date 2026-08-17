// Searching the public list, as logic rather than as markup (owner request 2026-08-17: "public
// rooms must be searchable").
//
// Deliberately LOCAL and instant: it filters the rooms already fetched by GET /api/rooms, in
// the browser, with no request and no debounce. The listing is capped at
// limits.lobby.listingMax rows, so the whole list is already in hand - asking a server to
// re-sort forty rows a keystroke at a time would be slower, would show a stale answer while it
// flew, and would turn a browse surface into a query endpoint someone can scrape.
//
// One haystack for both facts: a room is found by what the game is called OR by who is running
// it, because a person searching "board game club" is looking for the club's room and does not
// know or care which of the two strings carries the words. The card still draws them as the
// two different facts they are (room-card.svelte) - that split is about reading, this is about
// finding.
import type { RoomSummary } from "@jeopardy/protocol/room/registry";

/** Search terms, lowercased and split on whitespace. Empty array = no filter at all. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
}

/**
 * Does this room answer the query? Every term must appear somewhere in the room's title or
 * host label - AND rather than OR, so adding a word always narrows, which is the only
 * behaviour that makes typing feel like it is doing something.
 */
export function roomMatchesTerms(room: RoomSummary, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${room.title} ${room.hostLabel}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** The rooms a query leaves standing, in the order the server sent them (newest first). */
export function filterRooms(rooms: readonly RoomSummary[], query: string): RoomSummary[] {
  const terms = searchTerms(query);
  return rooms.filter((room) => roomMatchesTerms(room, terms));
}
