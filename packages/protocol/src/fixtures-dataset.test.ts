// Validation for the canonical dummy dataset in fixtures/ (repo root): every portable
// document there must open through parsePortableDocument - the same entry point real imports
// use - at the current version, survive parse -> serialize -> parse unchanged, and carry its
// ext bags through untouched (the boundary 2.6 round-trip promise). The roster fixture is
// deliberately NOT a portable document (rosters live in room state, not files), so it is
// schema-checked here with a local zod shape instead of a protocol schema. See
// fixtures/README.md for the migrate-never-regenerate rule these tests give teeth to.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parsePortableDocument, resolveGameRules, resolveRuleSet } from "./index.ts";
import type { ContentPack, GameDefinition, PortableDocument, RuleSet, Theme } from "./index.ts";

const fixturesDirectory = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

function readFixture(name: string): string {
  return readFileSync(join(fixturesDirectory, name), "utf8");
}

function parseFixture(name: string): PortableDocument {
  const result = parsePortableDocument(readFixture(name));
  if (!result.ok) throw new Error(`fixture ${name} failed to parse: ${result.detail}`);
  return result.document;
}

function loadPack(): ContentPack {
  const document = parseFixture("dummy-pack.pack.json");
  if (document.format !== "content-pack") throw new Error("expected a content pack");
  return document;
}

function loadGame(name: string): GameDefinition {
  const document = parseFixture(name);
  if (document.format !== "game-definition") throw new Error("expected a game definition");
  return document;
}

const portableFixtures: readonly { file: string; format: string }[] = [
  { file: "dummy-pack.pack.json", format: "content-pack" },
  { file: "dummy-game.game.json", format: "game-definition" },
  { file: "dummy-mini.game.json", format: "game-definition" },
  { file: "dummy-rules.rules.json", format: "rule-set" },
  { file: "dummy-theme.theme.json", format: "theme" },
];

describe("fixtures dataset: every portable document", () => {
  it.each(portableFixtures)("$file parses as a current-version $format", ({ file, format }) => {
    const result = parsePortableDocument(readFixture(file));
    expect(result).toMatchObject({ ok: true, migratedFrom: null });
    if (result.ok) expect(result.document.format).toBe(format);
  });

  it.each(portableFixtures)("$file survives parse -> serialize -> parse", ({ file }) => {
    const first = parseFixture(file);
    const second = parsePortableDocument(JSON.stringify(first));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.document).toEqual(first);
  });

  it.each(portableFixtures)("$file preserves its envelope ext bag verbatim", ({ file }) => {
    const raw = JSON.parse(readFixture(file)) as { ext?: unknown };
    const parsed = parseFixture(file);
    expect(raw.ext).toBeDefined(); // every fixture carries one on purpose - round-trip proof
    expect(parsed.ext).toEqual(raw.ext);
  });
});

describe("dummy-pack.pack.json", () => {
  const pack = loadPack();

  it("holds the full two-board-plus-final item set", () => {
    expect(pack.body.items).toHaveLength(61);
    expect(pack.body.media).toHaveLength(13);
  });

  it("covers difficulties 1-5 and both provenance values", () => {
    const difficulties = new Set(pack.body.items.map((item) => item.difficulty));
    expect([...difficulties].toSorted()).toEqual([1, 2, 3, 4, 5]);
    const drafts = pack.body.items.filter((item) => item.provenance === "ai-draft");
    expect(drafts).toHaveLength(9);
    expect(drafts.length).toBeLessThan(pack.body.items.length); // humans present too
  });

  it("attaches media to both prompt and answer sides in both storage states", () => {
    const promptMedia = pack.body.items.filter((item) => item.prompt.media !== undefined);
    const answerMedia = pack.body.items.filter((item) => item.answer.media !== undefined);
    expect(promptMedia).toHaveLength(10);
    expect(answerMedia).toHaveLength(3);
    const states = new Set(pack.body.media.map((asset) => asset.storage.state));
    expect(states).toEqual(new Set(["remote", "pending-local"]));
  });

  it("resolves every media ref against the pack's own media table, with no orphans", () => {
    const assetIds = new Set(pack.body.media.map((asset) => asset.id));
    const referenced = new Set<string>();
    for (const item of pack.body.items) {
      for (const ref of [item.prompt.media, item.answer.media]) {
        if (ref === undefined) continue;
        expect(assetIds).toContain(ref.mediaId);
        referenced.add(ref.mediaId);
      }
    }
    expect(referenced.size).toBe(assetIds.size); // every asset is reachable from an item
  });

  it("preserves item-level ext bags through the parse", () => {
    const withExtension = pack.body.items.filter((item) => item.ext !== undefined);
    expect(withExtension.length).toBeGreaterThanOrEqual(2);
    const wagerItem = pack.body.items.find(
      (item) => item.id === "0198f00d-0001-7000-8000-000000000134",
    );
    expect(wagerItem?.ext).toEqual({
      "com.example.playtest": { note: "round-one wager cell in dummy-game", starred: true },
    });
  });
});

describe("dummy-game.game.json", () => {
  const game = loadGame("dummy-game.game.json");
  const pack = loadPack();

  it("is a complete two-round 6x5 board with an authored final", () => {
    expect(game.body.rounds).toHaveLength(2);
    for (const round of game.body.rounds) {
      expect(round.categories).toHaveLength(6);
      for (const category of round.categories) expect(category.cells).toHaveLength(5);
    }
    expect(game.body.final).not.toBeNull();
  });

  it("references only items that exist in dummy-pack", () => {
    const itemIds = new Set(pack.body.items.map((item) => item.id));
    for (const round of game.body.rounds) {
      for (const category of round.categories) {
        for (const cell of category.cells) expect(itemIds).toContain(cell.itemId);
      }
    }
    if (game.body.final !== null) expect(itemIds).toContain(game.body.final.itemId);
  });

  it("places wager cells manually: one in round one, two in round two, split across categories", () => {
    const [roundOne, roundTwo] = game.body.rounds;
    if (roundOne === undefined || roundTwo === undefined) throw new Error("expected two rounds");
    expect(roundOne.wagerPlacement).toBe("manual");
    expect(roundTwo.wagerPlacement).toBe("manual");
    const roundOneWagers = roundOne.categories.filter((category) =>
      category.cells.some((cell) => cell.wager),
    );
    const roundTwoWagers = roundTwo.categories.filter((category) =>
      category.cells.some((cell) => cell.wager),
    );
    expect(
      roundOneWagers.flatMap((category) => category.cells.filter((cell) => cell.wager)),
    ).toHaveLength(1);
    expect(
      roundTwoWagers.flatMap((category) => category.cells.filter((cell) => cell.wager)),
    ).toHaveLength(2);
    expect(roundTwoWagers).toHaveLength(2); // never two wager cells in one category
  });

  it("pins its external pack by library id and content hash", () => {
    expect(game.body.content.kind).toBe("external");
    if (game.body.content.kind !== "external") return;
    const extension = pack.ext?.["com.example.fixtures"] as { libraryId?: string } | undefined;
    expect(game.body.content.packId).toBe(extension?.libraryId);
    const packHash = createHash("sha256")
      .update(readFileSync(join(fixturesDirectory, "dummy-pack.pack.json")))
      .digest("hex");
    expect(game.body.content.sha256).toBe(packHash);
  });

  it("resolves its inline rule set to complete settings with the non-default late-join score", () => {
    const settings = resolveGameRules(game.body.rules);
    expect(settings.join.lateJoinScore).toBe("match-lowest"); // rules-matrix #43 non-default
    expect(settings.teams.playerMode).toBe("teams");
    expect(settings.scoring.wrongAnswerPenalty).toBe("floor-at-zero");
    expect(settings.end.tieForFirst).toBe("co-champions"); // inherited from the casual base
  });

  it("embeds an inline custom theme whose background image resolves in its media table", () => {
    expect(game.body.theme.kind).toBe("inline");
    if (game.body.theme.kind !== "inline") return;
    const body = game.body.theme.theme.body;
    expect(body.background.kind).toBe("image");
    if (body.background.kind !== "image") return;
    const mediaIds = new Set(body.media.map((asset) => asset.id));
    expect(mediaIds).toContain(body.background.media.mediaId);
    expect(body.effectsLevel).toBe("dimensional");
  });
});

describe("dummy-mini.game.json", () => {
  const mini = loadGame("dummy-mini.game.json");

  it("is a single-round 3x3 with no final, its content embedded", () => {
    expect(mini.body.rounds).toHaveLength(1);
    const round = mini.body.rounds[0];
    if (round === undefined) throw new Error("expected a round");
    expect(round.categories).toHaveLength(3);
    for (const category of round.categories) expect(category.cells).toHaveLength(3);
    expect(mini.body.final).toBeNull();
    expect(mini.body.content.kind).toBe("embedded");
    expect(mini.body.valueScheme).toEqual({ kind: "custom", rowValues: [100, 200, 300] });
  });

  it("resolves every cell inside its own embedded pack", () => {
    if (mini.body.content.kind !== "embedded") throw new Error("expected embedded content");
    const itemIds = new Set(mini.body.content.pack.body.items.map((item) => item.id));
    expect(itemIds.size).toBe(9);
    for (const round of mini.body.rounds) {
      for (const category of round.categories) {
        for (const cell of category.cells) expect(itemIds).toContain(cell.itemId);
      }
    }
  });

  it("materializes the defaults its file omits", () => {
    // The file authors none of these: parsing must fill them, and re-serialization keeps them.
    expect(mini.body.rules).toEqual({ kind: "preset", preset: "casual-party", overrides: {} });
    expect(mini.body.theme).toEqual({ kind: "preset", preset: "modern-flat" });
    const round = mini.body.rounds[0];
    expect(round?.valueMultiplier).toBe(1);
    expect(round?.wagerPlacement).toBe("auto");
  });
});

describe("dummy-rules.rules.json and dummy-theme.theme.json (reference-path documents)", () => {
  it("resolves the standalone rule set: tv strictness plus sparse house overrides", () => {
    const document = parseFixture("dummy-rules.rules.json") as RuleSet;
    expect(document.body.base).toBe("tv");
    const settings = resolveRuleSet(document.body);
    expect(settings.structure.currencyLabel).toBe("pts");
    expect(settings.buzzing.buzzWindowMs).toBeNull(); // explicit null on a nullable setting
    expect(settings.final.revealStyle).toBe("leaderboard");
    expect(settings.end.tieForFirst).toBe("sudden-death"); // inherited from the tv base
  });

  it("parses the standalone theme and fills the slots its file omits", () => {
    const document = parseFixture("dummy-theme.theme.json") as Theme;
    expect(document.body.background.kind).toBe("pattern");
    expect(document.body.fontSlots.display).toBe("anton"); // prefaulted, absent in the file
    expect(document.body.effectsLevel).toBe("flat");
    expect(document.body.media).toEqual([]);
  });
});

// The 14 approved buzz sounds (docs/content/media-and-sounds.md section 9) as kebab-case
// slugs - the roster fixture's sound vocabulary until a real curated-pack manifest exists.
const approvedBuzzSounds = [
  "correct-bell",
  "ding",
  "clown-horn",
  "squeaky-toy",
  "laser-zap",
  "klaxon",
  "kookaburra",
  "loon",
  "owl-hoot",
  "airhorn",
  "gong",
  "game-powerup",
  "elephant-trumpet",
  "swanee-whistle",
] as const;

// Local shape for the INFORMAL roster fixture - deliberately not a protocol schema (rosters
// are room state, never portable documents). Strict so drive-by fields cannot creep in and
// masquerade as protocol vocabulary.
const buzzSoundSchema = z.enum(approvedBuzzSounds);
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);

const rosterSchema = z.strictObject({
  note: z.string().min(1),
  roomCode: z.string().regex(/^[A-Z0-9]{5}$/),
  capturedAt: z.iso.datetime(),
  buzzSoundCatalog: z.array(buzzSoundSchema).length(14),
  teams: z
    .array(
      z.strictObject({
        id: z.string().regex(/^team-[a-z0-9-]+$/),
        name: z.string().min(1).max(24),
        color: hexColorSchema,
        buzzSoundId: buzzSoundSchema,
        leaderId: z.string(),
        locked: z.boolean(),
      }),
    )
    .length(6),
  players: z
    .array(
      z.strictObject({
        id: z.string().regex(/^p\d{2}$/),
        nickname: z.string().min(1).max(24),
        teamId: z.string().nullable(),
        avatarId: z.string().regex(/^(cube-pets|mini)\/[a-z0-9-]+$/),
        accentColor: hexColorSchema,
        personalBuzzSoundId: buzzSoundSchema,
        connection: z.enum(["connected", "away"]),
        lateJoiner: z.boolean(),
      }),
    )
    .length(30),
});

describe("dummy-roster.json (informal fixture, local schema)", () => {
  const roster = rosterSchema.parse(JSON.parse(readFixture("dummy-roster.json")));

  it("labels itself as informal and lists the full approved buzz-sound catalog", () => {
    expect(roster.note).toContain("not a portable document");
    expect(new Set(roster.buzzSoundCatalog)).toEqual(new Set(approvedBuzzSounds));
  });

  it("keeps team references coherent: leaders on their own team, members on real teams", () => {
    const teamIds = new Set(roster.teams.map((team) => team.id));
    for (const team of roster.teams) {
      const leader = roster.players.find((player) => player.id === team.leaderId);
      expect(leader?.teamId).toBe(team.id);
    }
    for (const player of roster.players) {
      if (player.teamId !== null) expect(teamIds).toContain(player.teamId);
    }
  });

  it("seats 28 players across 6 teams plus exactly two unteamed late joiners", () => {
    const unteamed = roster.players.filter((player) => player.teamId === null);
    expect(unteamed).toHaveLength(2);
    for (const player of unteamed) expect(player.lateJoiner).toBe(true);
    for (const team of roster.teams) {
      const members = roster.players.filter((player) => player.teamId === team.id);
      expect(members.length).toBeGreaterThanOrEqual(4);
      expect(members.length).toBeLessThanOrEqual(5);
    }
  });

  it("mixes connection states and both avatar sets", () => {
    expect(roster.players.some((player) => player.connection === "away")).toBe(true);
    expect(roster.players.some((player) => player.connection === "connected")).toBe(true);
    const sets = new Set(roster.players.map((player) => player.avatarId.split("/")[0]));
    expect(sets).toEqual(new Set(["cube-pets", "mini"]));
  });
});
