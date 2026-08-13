// The hotseat page's game material: a REAL game definition built from the gallery's sample
// board and validated through the protocol schema, then collapsed to the engine's GameSetup
// via the same setupFromGameDefinition path production will use - the dev page proving the
// document -> engine pipe, not a shortcut around it. Ids are generated at module load
// (nondeterministic per reload, harmless: the engine seed, not item ids, drives placement).
import { setupFromGameDefinition } from "@jeopardy/engine/setup";
import { gameDefinitionSchema, gameDefinitionSchemaVersion, generateId } from "@jeopardy/protocol";
import { sampleBoard } from "#lib/board/sample-board.ts";
import type { GameSetup } from "@jeopardy/engine/setup";
import type { ContentItem, GameDefinition } from "@jeopardy/protocol";

export type ClueText = {
  categoryTitle: string;
  clue: string;
  response: string;
};

const finalClue: ClueText = {
  categoryTitle: "Renewable Energy",
  clue: "Both a burrowing rodent of the American plains and a machine that converts wind to watts answer to this name",
  response: "What is a gopher (Gopher wind turbine)?",
};

function contentItem(clue: string, response: string): ContentItem {
  return {
    id: generateId(),
    type: "basic",
    prompt: { text: clue },
    answer: { canonical: response, accepted: [] },
    tags: [],
    provenance: "human",
  };
}

const boardItems = sampleBoard.categories.map((category) =>
  category.clues.map((entry) => contentItem(entry.clue, entry.response)),
);
const finalItem = contentItem(finalClue.clue, finalClue.response);

// Two rounds from one sample board: the second reuses the same content items with doubled
// values (a dev page needs round flow, not sixty fresh questions).
function roundDefinition(name: string, valueMultiplier: number) {
  return {
    name,
    valueMultiplier,
    categories: sampleBoard.categories.map((category, categoryIndex) => ({
      title: category.title,
      cells: category.clues.map((_clue, rowIndex) => ({
        itemId: boardItems[categoryIndex]?.[rowIndex]?.id ?? finalItem.id,
      })),
    })),
    wagerPlacement: "auto" as const,
  };
}

const created = new Date().toISOString();

export const sampleGameDefinition: GameDefinition = gameDefinitionSchema.parse({
  format: "game-definition",
  schemaVersion: gameDefinitionSchemaVersion,
  meta: { title: "Hotseat sample game", created, modified: created },
  body: {
    mode: "jeopardy",
    rounds: [roundDefinition("Round one", 1), roundDefinition("Round two", 2)],
    final: { category: finalClue.categoryTitle, itemId: finalItem.id },
    valueScheme: { kind: "preset", preset: "tv" },
    content: {
      kind: "embedded",
      pack: {
        format: "content-pack",
        schemaVersion: "1.0.0",
        meta: { title: "Hotseat sample pack", created, modified: created },
        body: { items: [...boardItems.flat(), finalItem], media: [], tags: [] },
      },
    },
    rules: { kind: "preset", preset: "casual-party", overrides: {} },
    theme: { kind: "preset", preset: "retro-tv" },
  },
});

export function sampleGameSetup(seed: string): GameSetup {
  return setupFromGameDefinition(sampleGameDefinition.body, seed);
}

/** Board-position lookup for the host/debug surfaces (any round: items repeat). */
export function clueTextAt(category: number, row: number): ClueText {
  const categoryData = sampleBoard.categories[category];
  const clueData = categoryData?.clues[row];
  return {
    categoryTitle: categoryData?.title ?? "?",
    clue: clueData?.clue ?? "?",
    response: clueData?.response ?? "?",
  };
}

export const sampleFinalClue: ClueText = finalClue;
