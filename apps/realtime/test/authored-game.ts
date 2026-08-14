// A tiny AUTHORED game (definition + embedded content pack) for the suite's content tests.
// The compact spec every other test uses carries board material only - no prompts, no
// answers - so nothing else here can exercise the clue-content channel.
//
// Built locally rather than borrowed from apps/web's hotseat fixture: apps are packages, and
// reaching into another one's source past its exports map is exactly the coupling CLAUDE.md
// forbids. It is parsed through the real schema, so it is a genuine document, not a mock.
import {
  gameDefinitionSchema,
  gameDefinitionSchemaVersion,
  contentPackSchemaVersion,
  generateId,
} from "@jeopardy/protocol";
import type { ContentItem, GameDefinition } from "@jeopardy/protocol";
import type { RoomGameSpec } from "@jeopardy/protocol/room/create";

function item(prompt: string, answer: string): ContentItem {
  return {
    id: generateId(),
    type: "basic",
    prompt: { text: prompt },
    answer: { canonical: answer, accepted: [`${answer} (also accepted)`] },
    tags: [],
    provenance: "human",
  };
}

// 3x3 board: the smallest legal round, one item per cell, plus an authored final.
const items = Array.from({ length: 9 }, (_unused, index) =>
  item(`Prompt for cell ${String(index)}`, `Answer for cell ${String(index)}`),
);
const finalItem = item("The final prompt", "The final answer");
const created = new Date().toISOString();

export const authoredGameDefinition: GameDefinition = gameDefinitionSchema.parse({
  format: "game-definition",
  schemaVersion: gameDefinitionSchemaVersion,
  meta: { title: "Realtime content suite", created, modified: created },
  body: {
    mode: "jeopardy",
    rounds: [
      {
        name: "Round one",
        valueMultiplier: 1,
        categories: [0, 1, 2].map((categoryIndex) => ({
          title: `Category ${String(categoryIndex)}`,
          cells: [0, 1, 2].map((row) => ({
            itemId: items[categoryIndex * 3 + row]?.id ?? finalItem.id,
          })),
        })),
        // manual placement with nothing authored = no wager cells, so the tests drive plain
        // clues without tripping the wager path.
        wagerPlacement: "manual",
      },
    ],
    final: { category: "The final category", itemId: finalItem.id },
    valueScheme: { kind: "preset", preset: "tv" },
    content: {
      kind: "embedded",
      pack: {
        format: "content-pack",
        schemaVersion: contentPackSchemaVersion,
        meta: { title: "Realtime content suite pack", created, modified: created },
        body: { items: [...items, finalItem] },
      },
    },
    rules: { kind: "preset", preset: "casual-party", overrides: {} },
    theme: { kind: "preset", preset: "modern-flat" },
  },
});

// Typed as the PARSED spec (not the create-request input) because the DO's content resolver
// consumes it directly in the unit-level assertions; it is still a valid create payload.
export const authoredGame: RoomGameSpec = {
  kind: "definition",
  body: authoredGameDefinition.body,
};

/** The first cell's authored strings, so tests can assert on exact text (and its absence). */
export const firstCellText = {
  category: "Category 0",
  prompt: items[0]?.prompt.text ?? "",
  answer: items[0]?.answer.canonical ?? "",
};
