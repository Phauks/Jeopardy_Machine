// Mock-mode material: the fixtures/ dummy dataset (repo root) adapted to the room-store
// view shapes. This module is the ONLY place the play surfaces touch fixture data, so the
// reconcile that replaces mock rooms with M3 rooms deletes exactly one import site per
// store. Fixtures are versioned test data, deliberately imported raw here (fixtures/README.md
// sanctions dev tooling use); the local-sim store is dev tooling that happens to render
// through product routes until the ws store exists.
import { mediaAssetById } from "@jeopardy/protocol";
import type { ResolvedMedia } from "@jeopardy/protocol/room/server-messages";
import { parsePortableDocument } from "@jeopardy/protocol";
import { setupFromGameDefinition } from "@jeopardy/engine/setup";
import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
import gameJson from "../../../../../fixtures/dummy-game.game.json";
import packJson from "../../../../../fixtures/dummy-pack.pack.json";
import rosterJson from "../../../../../fixtures/dummy-roster.json";
import type { ContentItem, ContentPack, GameDefinition } from "@jeopardy/protocol";
import type { GameSetup } from "@jeopardy/engine/setup";
import type {
  ClueContentView,
  RoomContentView,
  RoomPlayerView,
  RoomRosterView,
  RoomTeamView,
} from "#lib/room/room-view.ts";

// The fixture files are real portable documents; opening them through parsePortableDocument
// (not a cast) keeps this module honest with the migrate-never-regenerate rule - a format
// bump that forgets the fixtures breaks the mock surfaces too, loudly.
function parseFixtureDocument(raw: unknown, expectedFormat: string): GameDefinition | ContentPack {
  const result = parsePortableDocument(raw);
  if (!result.ok) {
    throw new Error(`fixture ${expectedFormat} failed to parse: ${result.detail}`);
  }
  if (result.document.format !== expectedFormat) {
    throw new Error(`fixture parsed as ${result.document.format}, expected ${expectedFormat}`);
  }
  return result.document as GameDefinition | ContentPack;
}

export const fixtureGameDefinition = parseFixtureDocument(
  gameJson,
  "game-definition",
) as GameDefinition;
const fixturePack = parseFixtureDocument(packJson, "content-pack") as ContentPack;

const itemsById = new Map<string, ContentItem>(
  fixturePack.body.items.map((item) => [item.id, item]),
);

/** The engine setup the local-sim store folds actions over (same path production takes). */
export function fixtureGameSetup(seed: string): GameSetup {
  return setupFromGameDefinition(fixtureGameDefinition.body, seed);
}

/**
 * The content join for the fixture game: (round, category, row) -> prompt/response text.
 * `includeResponses` is the role gate - display and player stores pass false so answers
 * never exist in their memory (the mirror-mode rule starts here, not at the template).
 */
export function fixtureContentView(includeResponses: boolean): RoomContentView {
  const rounds = fixtureGameDefinition.body.rounds;
  const categoryTitles = rounds.map((round) => round.categories.map((category) => category.title));
  // Resolved through the same engine path the game plays with, so a per-cell value override
  // in the fixture (the 750 "glitched" cell) shows the same number the scoring uses.
  const cellValues = fixtureGameSetup("values-only").rounds.map((round) =>
    round.cells.map((column) => column.map((cell) => cell.value)),
  );
  // The mock's half of the room's media resolution (apps/realtime/src/room/content.ts): the
  // fixture pack's own media table, looked up the same way, so the sim and a real room agree on
  // what a surface receives rather than the sim being the one place pictures never appear.
  const fixtureMedia = (mediaId: string | undefined): ResolvedMedia | null => {
    if (mediaId === undefined) return null;
    // The SIBLING pack, the same one the items come from: the dummy game links its pack
    // externally (content.kind === "external"), which is exactly the shape a library holds and
    // exactly the shape that has to be joined before hosting (@jeopardy/protocol,
    // embedContentPack). Looking only inside an embedded pack found nothing and every fixture
    // picture rendered as "a file for this clue".
    const asset = mediaAssetById(fixturePack, mediaId);
    if (asset === null) return { mediaId, kind: "file", mime: "application/octet-stream" };
    return {
      mediaId: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      ...(asset.alt !== undefined && { alt: asset.alt }),
      ...(asset.storage.state === "remote" && { url: asset.storage.url }),
    };
  };

  const clueAt = (roundIndex: number, category: number, row: number): ClueContentView | null => {
    const categoryDefinition = rounds[roundIndex]?.categories[category];
    const itemId = categoryDefinition?.cells[row]?.itemId;
    const item = itemId === undefined ? undefined : itemsById.get(itemId);
    if (categoryDefinition === undefined || item === undefined) return null;
    return {
      categoryTitle: categoryDefinition.title,
      prompt: item.prompt.text,
      media: fixtureMedia(item.prompt.media?.mediaId),
      response: includeResponses ? item.answer.canonical : null,
      responseMedia: includeResponses ? fixtureMedia(item.answer.media?.mediaId) : null,
    };
  };
  const finalSlot = fixtureGameDefinition.body.final;
  const finalItem = finalSlot === null ? undefined : itemsById.get(finalSlot.itemId);
  const final: ClueContentView | null =
    finalSlot === null || finalItem === undefined
      ? null
      : {
          categoryTitle: finalSlot.category,
          prompt: finalItem.prompt.text,
          media: fixtureMedia(finalItem.prompt.media?.mediaId),
          response: includeResponses ? finalItem.answer.canonical : null,
          responseMedia: includeResponses ? fixtureMedia(finalItem.answer.media?.mediaId) : null,
        };
  return { categoryTitles, cellValues, clueAt, final };
}

// --- Roster adaptation -------------------------------------------------------------------
// dummy-roster.json predates both the baked avatar manifest and the M3 roster schema, so its
// slugs need deterministic mapping into today's curated sets: provisional avatar slugs
// ("cube-pets/fox") resolve to manifest avatars, raw hexes resolve to the 8-accent palette.
// Deterministic (hash, not random) so every dev reload shows the same room.

type FixtureRosterPlayer = {
  id: string;
  nickname: string;
  teamId: string | null;
  avatarId: string;
  accentColor: string;
  personalBuzzSoundId: string;
  connection: string;
  lateJoiner: boolean;
};

type FixtureRosterTeam = {
  id: string;
  name: string;
  color: string;
  buzzSoundId: string;
  leaderId: string;
  locked: boolean;
};

const fixtureRoster = rosterJson as unknown as {
  roomCode: string;
  buzzSoundCatalog: string[];
  teams: FixtureRosterTeam[];
  players: FixtureRosterPlayer[];
};

function stableHash(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function resolveAvatarId(provisionalSlug: string): string {
  const bareName = provisionalSlug.split("/").at(-1) ?? provisionalSlug;
  const exact = avatarManifest.avatars.find((entry) => entry.id === bareName);
  if (exact !== undefined) return exact.id;
  const fallback =
    avatarManifest.avatars[stableHash(provisionalSlug) % avatarManifest.avatars.length];
  return fallback?.id ?? "bunny";
}

function resolveAccentId(hex: string): string {
  const exact = avatarManifest.accents.find((entry) => entry.hex === hex.toLowerCase());
  if (exact !== undefined) return exact.id;
  const fallback = avatarManifest.accents[stableHash(hex) % avatarManifest.accents.length];
  return fallback?.id ?? "gold";
}

/** The dummy room's roster in view shape: 6 teams, 30 players, 2 unteamed late joiners. */
export function fixtureRosterView(): RoomRosterView {
  const teams: RoomTeamView[] = fixtureRoster.teams.map((team) => ({
    teamId: team.id,
    name: team.name,
    colorId: resolveAccentId(team.color),
    buzzSoundId: team.buzzSoundId,
    leaderPlayerId: team.leaderId,
    locked: team.locked,
  }));
  const players: RoomPlayerView[] = fixtureRoster.players.map((player, index) => ({
    playerId: player.id,
    nickname: player.nickname,
    avatarId: resolveAvatarId(player.avatarId),
    accentId: resolveAccentId(player.accentColor),
    buzzSoundId: player.personalBuzzSoundId,
    // The fixture roster deliberately leaves every tone unchosen. It is dummy data and a tone
    // is a statement about a person, so inventing a spread of them for imaginary players would
    // be exactly the inference the feature forbids (packages/protocol/src/room/identity.ts).
    skinToneId: null,
    teamId: player.teamId,
    connected: player.connection === "connected",
    // Fixture order is join order; late joiners land after everyone else.
    joinedAt: (player.lateJoiner ? 100_000 : 0) + index,
  }));
  // No audience: the fixture describes a roster, and spectators are live connections nobody
  // can invent (room-view.ts - null is "not reported", which is the truth about dummy data).
  return { players, teams, spectatorCount: null };
}

export const fixtureRoomCode = fixtureRoster.roomCode;
