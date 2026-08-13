# Proposal: M1 protocol schemas (`packages/protocol`)

> 2026-08-13 · Status: **proposed, with owner review resolutions applied (see final section)** · Review per-section (each section is a yes/no).
> Implements the four-document design law (docs/design/expansion-and-boundaries.md) as zod v4 schemas.
> Builds on the M0 scaffold already in `packages/protocol/src`: `envelope.ts` (wire envelope, integer
> `protocolVersion`), `ext.ts` (reverse-domain extension bag), `limits.ts` (hard caps). Nothing here
> contradicts those files; everything here imports them.

All code below is illustrative, not exhaustive - field lists are complete where a reviewer needs to
judge the shape, elided (`/* ... */`) where they are mechanical repetition. Naming follows the repo
rules: kebab-case files, fully-spelled-out identifiers, no abbreviations on the wire or in documents.

Proposed file layout (new files only):

```
packages/protocol/src/
  document.ts                    # document envelope + migration registry (§1)
  media.ts                       # media-ref + media-asset (§6)
  content/content-item.ts        # §2
  content/content-pack.ts        # §2
  modes/jeopardy/game-definition.ts   # §3
  modes/jeopardy/settings.ts     # §4
  theme/theme.ts                 # §5
  migrations/<format>/<from>-to-<to>.ts + .test.ts   # §1
```

---

## 1. Document envelope

Two different versioning regimes exist on purpose and must not be conflated:

| Surface                         | Version type   | Why                                                                                                                                                                    |
| ------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WS wire (`envelope.ts`, exists) | single integer | both ends are deployed by us; skew is refused + reload prompted (PWA policy). No migration ever runs on the wire.                                                      |
| Documents (this section)        | semver string  | files live for years in strangers' Downloads folders. Humans and third-party tooling need to know _whether a bump broke anything_, and old files must migrate forward. |

Every one of the four documents (content pack, game definition, settings, theme) is wrapped in the
same envelope. The body is **nested under `body`**, not flattened into the envelope - this keeps the
envelope fields collision-proof forever, lets one generic helper build all four document schemas, and
lets migrations be written against `body` alone while the envelope stays stable.

```ts
// document.ts
import { z } from "zod";
import { extensionBagSchema } from "./ext.ts";

export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const documentMetaSchema = z.strictObject({
  title: z.string().min(1).max(200),
  author: z.string().max(120).optional(),
  license: z.string().max(120).optional(), // SPDX id preferred, free text allowed
  created: z.iso.datetime(),
  modified: z.iso.datetime(),
});

export function documentSchema<Format extends string, Body extends z.ZodType>(
  format: Format,
  bodySchema: Body,
) {
  return z.strictObject({
    format: z.literal(format), // machine identity - NOT the filename (§8)
    schemaVersion: semverSchema, // version of this format's schema
    meta: documentMetaSchema,
    ext: extensionBagSchema.optional(), // preserved untouched on round-trip (boundary 2.6)
    body: bodySchema,
  });
}
```

`strictObject` everywhere: unknown keys are rejected loudly, because the only sanctioned place for
foreign data is `ext` (boundary 2.6). No `looseObject` in documents - the wire envelope is loose
because payloads extend it; documents have nothing extending them.

### Semver rules

| Bump  | Meaning                                             | Reader obligation                                                              |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| patch | spec-text clarification only; shape identical       | none - patch never appears in migration logic                                  |
| minor | additive: new **optional-with-default** fields only | none - old files parse because defaults absorb the gap; **no upgrader needed** |
| major | shape change                                        | a registered upgrader is **mandatory**                                         |

Reader policy: a document whose `major.minor` is **newer than the app knows → refuse** with
"this file was made by a newer version - update the app" (the service worker makes updating a
reload; forward-compat machinery buys almost nothing here and silently-dropped fields on re-export
would be data loss). Older major → migrate up. Unknown `format` → refuse.

### Migration convention

```ts
export type Migration = {
  format: string;
  from: string; // exact "major.minor" it consumes
  to: string; // exact "major.minor" it produces
  migrate: (body: unknown) => unknown; // pure, synchronous, total
};

// parseDocument(raw): identify format -> chain registered migrations from the file's
// version to current -> schema.parse the result. One entry point, used by editor import,
// library load, AND the Worker re-validating saves (one schema, two enforcement points).
```

Enforced by CI, not convention: `migrations/` carries a **fixture test per migration** (a
committed before-JSON and after-JSON pair, plus "chain from every historical version reaches
current and validates"). A version-constant bump without a matching migration + fixture fails a
gate test, same pattern as the existing `limits.gate.test.ts`.

---

## 2. Content layer

### 2.1 `content-item`

The mode-agnostic atom (guiding principle 6). It knows nothing about boards, values, rounds, or
wager cells - those are the mode layer's business.

```ts
// content/content-item.ts
export const contentItemTypeSchema = z.enum(["basic"]); // grows; see table

export const tagSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(40); // kebab-case

export const contentItemSchema = z.strictObject({
  id: z.ulid(),
  type: contentItemTypeSchema,
  prompt: z.strictObject({
    text: z.string().min(1).max(2000),
    media: mediaRefSchema.optional(), // §6
  }),
  answer: z.strictObject({
    canonical: z.string().min(1).max(500), // what the host card / reveal shows
    accepted: z.array(z.string().min(1).max(500)).max(20).default([]),
    // extra equivalents for typed auto-judge (setting #21). Matching/normalization rules
    // (case, articles, fuzz) are the M2 engine's problem, not the format's.
  }),
  tags: z.array(tagSchema).max(20).default([]),
  difficulty: z.int().min(1).max(5).optional(), // authoring aid, not a game rule
  source: z.string().max(500).optional(), // free-text citation / origin note
  provenance: z.enum(["human", "ai-draft"]).default("human"), // expansion 1.3: costless now, trust filter later
  ext: extensionBagSchema.optional(),
});
```

**Why ULID for ids.** Ids are minted client-side, offline, in an IndexedDB-first local library (PWA
decision) - so they must be generated without coordination, which rules out sequences. Among
coordination-free options: ULIDs are lexicographically ordered by creation time (library listings
and dedupe scans sort meaningfully with no extra column), 26 chars of Crockford base32 (no dashes,
double-click-selectable, URL- and filename-safe), and collision odds are UUID-class. UUIDv4 loses
sortability; UUIDv7 matches ULID's properties but is longer and dash-ridden; nanoid loses the
timestamp. zod v4 validates it natively (`z.ulid()`). See open question 4.

**Content-item type enum** - designed for extension; each future type declares which modes can
render it (expansion 1.1):

| type           | Shape addition over `basic`       | Rendered by                 | Status   |
| -------------- | --------------------------------- | --------------------------- | -------- |
| `basic`        | none - prompt/answer as above     | jeopardy, all future modes  | **M1**   |
| `ordered-list` | ordered `entries[]`, credit rules | pub-quiz, everyone-answers  | reserved |
| `estimate`     | numeric target + tolerance        | everyone-answers            | reserved |
| `survey`       | weighted answer buckets           | family-feud-ish future mode | reserved |

Adding a type is a **minor** bump for the content-pack format only if old readers can still parse
packs containing it. They cannot (strict enum), so in practice a new type is a **major** bump with a
trivial migration - accepted cost; see open question 5 for the "skip unknown types" alternative.

### 2.2 `content-pack`

```ts
// content/content-pack.ts
export const contentPackBodySchema = z.strictObject({
  items: z.array(contentItemSchema).min(1).max(2000),
  media: z.array(mediaAssetSchema).max(500).default([]), // §6 - byte-location table
  description: z.string().max(1000).optional(),
  tags: z.array(tagSchema).max(20).default([]),
});

export const contentPackSchema = documentSchema("content-pack", contentPackBodySchema);
export const contentPackSchemaVersion = "1.0.0";
```

Author/license/title live in the envelope `meta` - present from day one because the community pack
library (expansion 1.3) is only possible if packs are attributable from the first file ever exported.
Media _descriptions_ live in the pack; media _bytes_ never do (except inside a zip bundle, §6/§8).

---

## 3. Jeopardy mode layer: `game-definition`

A game definition is a _presentation of content items, not their owner_. Cells hold refs; the
prompt/answer text is never duplicated into the board.

```ts
// modes/jeopardy/game-definition.ts
export const cellSchema = z.strictObject({
  itemId: z.ulid(), // -> content-item in the pack (§3 "content" field)
  value: z.int().positive().optional(), // omitted = row value from the value scheme
  wager: z.boolean().default(false), // manual wager-cell ("Double Down") placement
});

export const categorySchema = z.strictObject({
  title: z.string().min(1).max(80),
  cells: z.array(cellSchema).min(3).max(6), // rows - limits mirror rules-matrix #2
});

export const roundSchema = z.strictObject({
  name: z.string().min(1).max(60),
  valueMultiplier: z.number().positive().default(1), // R2 = 2 under TV rules (matrix #5)
  categories: z.array(categorySchema).min(3).max(6), // columns
  wagerPlacement: z.enum(["auto", "manual"]).default("auto"),
  // "auto": engine places wager cells at game start per settings (count + weighting).
  // "manual": exactly the cells with wager:true. Lint flags manual rounds with zero wager cells.
});

export const gameDefinitionBodySchema = z.strictObject({
  mode: z.literal("jeopardy"), // future modes = new literals = new body schemas under modes/
  rounds: z.array(roundSchema).min(1).max(4),
  final: z
    .strictObject({
      category: z.string().min(1).max(80),
      itemId: z.ulid(),
    })
    .nullable(), // null = no Final round authored (matrix #29 can also disable)
  valueScheme: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("preset"), preset: z.enum(["tv", "classic", "points"]) }),
    z.strictObject({
      kind: z.literal("custom"),
      rowValues: z.array(z.int().positive()).min(3).max(6),
    }),
  ]),
  content: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("embedded"), pack: contentPackSchema }),
    z.strictObject({
      kind: z.literal("external"),
      packId: z.ulid(),
      sha256: z.string().optional(),
    }),
  ]),
  settings: z.strictObject({
    preset: z.enum(["tv", "casual-party", "custom"]).default("casual-party"),
    overrides: settingsOverridesSchema.default({}), // deep-partial of §4, applied over preset
  }),
  theme: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("preset"),
        preset: z.enum(["retro-tv", "modern-flat", "event-poster", "terra-verde"]),
      }),
      z.strictObject({ kind: z.literal("inline"), theme: themeSchema }), // §5 - full doc embedded
    ])
    .default({ kind: "preset", preset: "modern-flat" }),
});

export const gameDefinitionSchema = documentSchema("game-definition", gameDefinitionBodySchema);
```

Three deliberate calls to review:

1. **Settings and theme are embedded, never referenced by library id.** A `.game.json` handed to a
   stranger must play identically on their machine; ids into _my_ local library dangle in _your_
   library. Presets are the only cross-file "references" allowed because they ship in the app binary.
   The library still stores themes/settings as separate documents - embedding happens at
   compose/export time.
2. **Content may be embedded or external.** Export default is `embedded` (self-contained file, the
   "own your data" story). `external` exists for the in-app library (game and pack stored separately,
   repository joins them) and for future pack-library scenarios; optional `sha256` of the pack's
   canonical JSON detects drift. Import of an `external` game without its pack is a hard, friendly error.
3. **Wager cells are authored data with an auto escape hatch.** Rules-matrix #23/#24 (count,
   placement weighting) stay in the settings object as inputs to `wagerPlacement: "auto"`; a hand-placed
   board (`"manual"` + `wager: true` cells) always wins over settings. Same principle for structure:
   where the definition is concrete (grid shape, row values), the definition is truth and the
   corresponding settings act as authoring-time generators. Lint, not schema, enforces consistency.

---

## 4. Settings object: the 43-setting rules matrix, typed

One document (`format: "settings"`), eleven sub-objects. Every field has a default; the whole
matrix collapses so `settingsSchema.parse({})` (via zod v4 `.prefault({})` on each group) yields the
complete default game. Presets (`tv`, `casual-party`) are checked-in `Partial` deltas over these
defaults, applied before per-game `overrides`.

Group map (numbers = rules-matrix rows in docs/research/01-game-anatomy.md):

| Group          | Matrix settings      | Notes                                                                                                                                                                                        |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structure`    | 1-6                  | rounds played, board size, value scheme, currency label, R2 multiplier, round time limit. Board size / value scheme double as authoring generators (§3 call 3)                               |
| `boardControl` | 7-10                 | next-selector rule, first selector R1/R2, selection shot clock                                                                                                                               |
| `buzzing`      | 11-16                | **full schema below**                                                                                                                                                                        |
| `scoring`      | 17-19                | deduct-on-wrong, deduct-on-timeout, question-format requirement. #20 (host override + undo) is **not a setting** - it is always on (guiding principle 4), so it is not representable as data |
| `answerMode`   | 21-22                | verbal vs typed capture; everyone-answers mode                                                                                                                                               |
| `wagers`       | 23-28                | **full schema below**                                                                                                                                                                        |
| `final`        | 29-33                | enabled, eligibility, wager range, writing timer, reveal style                                                                                                                               |
| `teams`        | 34-36                | player mode, team buzzer scheme, team-wide early penalty                                                                                                                                     |
| `end`          | 37-38                | tie handling, all-non-positive finish                                                                                                                                                        |
| `presentation` | 39-42                | per-cue sound toggles, buzz-winner announcement, category reveal animation, dead-clue answer reveal                                                                                          |
| `join`         | 43 + named additions | late-join allowed, late-join score policy (#43, user-flows), clue-text-on-phones (expansion 1.4), profanity filter (user-flows A2)                                                           |

The two groups in full - the rest follow the identical idiom:

```ts
// modes/jeopardy/settings.ts
export const buzzingSettingsSchema = z.strictObject({
  armMode: z.enum(["manual", "auto-after-tts", "auto-after-delay"]).default("manual"), // #11
  autoArmDelayMs: z.int().min(500).max(30_000).default(4000), // only read when auto-after-delay
  earlyBuzzLockoutMs: z.int().min(0).max(1000).default(250), // #12 - 0 means penalty off
  buzzWindowMs: z.int().min(3000).max(15_000).nullable().default(5000), // #13 - null = host closes
  answerWindowMs: z.int().min(3000).max(15_000).default(5000), // #14
  rebound: z.boolean().default(true), // #15
  wrongAnswererLockedOut: z.boolean().default(true), // #16
});

export const wagerSettingsSchema = z.strictObject({
  label: z.string().min(1).max(30).default("Double Down"), // #28 - genericized, never the TV name
  countRoundOne: z.int().min(0).max(4).default(1), // #23
  countRoundTwo: z.int().min(0).max(4).default(2), // #23
  autoPlacement: z.enum(["weighted-realistic", "uniform"]).default("weighted-realistic"), // #24
  minimumWager: z.int().min(0).default(5), // #25
  maximumWagerRule: z.enum(["tv", "score-only", "unlimited"]).default("tv"), // #26
  wagerTimerMs: z.int().min(10_000).max(120_000).nullable().default(30_000), // #27 - null = host-paced
});

export const settingsBodySchema = z.strictObject({
  structure: structureSettingsSchema.prefault({}),
  boardControl: boardControlSettingsSchema.prefault({}),
  buzzing: buzzingSettingsSchema.prefault({}),
  scoring: scoringSettingsSchema.prefault({}),
  answerMode: answerModeSettingsSchema.prefault({}),
  wagers: wagerSettingsSchema.prefault({}),
  final: finalSettingsSchema.prefault({}),
  teams: teamSettingsSchema.prefault({}),
  end: endSettingsSchema.prefault({}),
  presentation: presentationSettingsSchema.prefault({}),
  join: joinSettingsSchema.prefault({}),
});
```

Conventions worth a yes/no: durations are always integer milliseconds with an `Ms` suffix;
"off/unlimited/host-paced" is `null` on a nullable number, never a magic `0` **except**
`earlyBuzzLockoutMs` where 0-is-off is the natural physical reading; enums are kebab-case strings.
Adding setting #44 later is a minor bump (optional-with-default) - exactly what the escape valve in
boundary 2.3 requires. The M2 engine consumes the _parsed output_ type `Settings = z.infer<...>`,
so the engine never sees an absent field.

---

## 5. Theme document

Direct transcription of the theming decision (docs/decisions/2026-08-13-theming-as-feature.md).
Themes change look, never structure (boundary 2.4), and never reach past the player a11y floor
(boundary 2.9) - nothing in this schema can, which is the point.

```ts
// theme/theme.ts
export const fontFaceSchema = z.enum([
  // curated, self-hosted, OFL only (boundary 2.5)
  "anton",
  "oswald",
  "bitter",
  "six-caps",
  "alfa-slab-one",
]); // grows toward ~10-12 faces; each addition = minor bump

export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
export const fillSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("solid"), color: colorSchema }),
  z.strictObject({
    kind: z.literal("gradient"),
    from: colorSchema,
    to: colorSchema,
    angleDeg: z.int().min(0).max(359).default(180),
  }),
]);

export const themeBodySchema = z.strictObject({
  tokens: z.strictObject({
    boardBackground: fillSchema,
    cellBackground: fillSchema,
    categoryBackground: fillSchema,
    valueColor: colorSchema,
    clueTextColor: colorSchema,
    accentColor: colorSchema,
    usedCellTreatment: z.enum(["blank-dark", "dimmed", "outline"]).default("blank-dark"),
  }),
  fontSlots: z.strictObject({
    display: fontFaceSchema.default("anton"),
    values: fontFaceSchema.default("oswald"),
    clue: fontFaceSchema.default("bitter"),
    chrome: fontFaceSchema.default("oswald"),
  }),
  background: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("solid"), color: colorSchema }),
    z.strictObject({
      kind: z.literal("gradient"),
      from: colorSchema,
      to: colorSchema,
      angleDeg: z.int().min(0).max(359).default(180),
    }),
    z.strictObject({
      kind: z.literal("pattern"),
      patternId: z.enum(["dots", "grid", "diagonal"]),
      foreground: colorSchema,
      background: colorSchema,
    }),
    z.strictObject({
      kind: z.literal("image"),
      media: mediaRefSchema,
      dim: z.number().min(0).max(1).default(0.4),
    }), // auto-dim overlay slider
  ]),
  effectsLevel: z.enum(["flat", "dimensional"]).default("flat"),
  soundSet: z.enum(["classic-original", "minimal-beeps"]).optional(), // boundary 2.10 bend - slot
  // reserved now (optional = minor-bump-free), populated when M7 ships curated sets
  media: z.array(mediaAssetSchema).max(4).default([]), // background image bytes ride like pack media
});

export const themeSchema = documentSchema("theme", themeBodySchema);
```

WCAG contrast checks are the customizer's job (warn, never block) and live in app code, not schema -
a theme that fails contrast is still a _valid document_, so shared themes never break on import.

---

## 6. Media references: the indirection

The rule: **content references media identity; a separate per-document table says where the bytes
are right now.** Items and themes hold a `mediaRef` (id only); the owning document's `media` array
maps ids to bytes. Moving bytes (upload, bundle, re-import) rewrites only `storage` entries - no
content item ever changes.

```ts
// media.ts
export const mediaRefSchema = z.strictObject({ mediaId: z.ulid() });

export const mediaAssetSchema = z.strictObject({
  id: z.ulid(),
  kind: z.enum(["image", "audio"]), // video deliberately absent until a mode needs it
  mime: z.string().max(100),
  bytes: z.int().positive(), // validated against limits.media caps in lint + upload
  sha256: z.string().regex(/^[0-9a-f]{64}$/), // integrity, dedupe, and re-link key
  alt: z.string().max(300).optional(), // a11y, and the fallback when media is missing
  storage: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("remote"), url: z.url() }), // Worker-served R2 route
    z.strictObject({ state: z.literal("bundled"), path: z.string().max(200) }), // media/<id>.<ext> inside a zip
    z.strictObject({ state: z.literal("pending-local") }), // bytes only in this device's IndexedDB
  ]),
});
```

How the states map to real flows (resolves user-flows open question 5):

| State           | Where bytes live                                                                                                 | Valid in                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pending-local` | this device's IndexedDB (PWA decision: media pends locally, uploads on first "Host this game" with connectivity) | local library autosaves only - **lint blocks it in any export**                                                |
| `remote`        | R2, addressed by a Worker-served URL                                                                             | library docs, JSON-only exports (portable within your instance; cross-instance import warns that URLs may die) |
| `bundled`       | `media/` folder in the export zip, path derived from `id`                                                        | zip bundles only; import rewrites to `pending-local`, then upload rewrites to `remote`                         |

The `sha256` is what makes the indirection safe: re-importing a bundle into a library that already
has the bytes dedupes by hash; a `remote` fetch can be verified; and a JSON-only export whose URLs
later die can be _re-linked_ by dropping the same files onto the importer. This is the whole
mechanism behind "a board exports as json-only or zip-with-media" - same document, different
`storage` rows.

---

## 7. WS protocol preview (M3 owns the catalog; this proves the envelope)

Not M1 scope to implement - included to show the M0 envelope + these documents compose into M3
without rework. Message schemas will extend `envelopeSchema` (loose base, strict payloads) in a
`z.discriminatedUnion("type", [...])` per direction.

```ts
// client -> server
{ version: 1, type: "hello", role: "player",           // role claim in the hello, one round-trip
  roomCode: "BQKX7", sessionToken: "...",              // token absent on first join
  nickname: "Lorax" }
// roles: "host" | "display" | "player" | "spectator" (user-flows; spectator ships later but is
// in the enum from day one). host/display must present the room secret minted at room creation;
// players present nothing but the code (boundary 2.2).

// server -> client (success): full snapshot, then seq-numbered patches
{ version: 1, type: "welcome", seq: 17, self: { playerId, role }, state: { /* RoomSnapshot */ } }
{ version: 1, type: "patch", seq: 18, changes: { /* partial RoomSnapshot, merge-patch */ } }
{ version: 1, type: "resync" }                          // client saw a seq gap -> server re-welcomes

// server -> client (refusal): the version-skew policy's teeth (PWA decision)
{ version: 1, type: "error", code: "unsupported-version", detail: "server speaks 1, you sent 2" }
// client behavior on this code is mandated: prompt reload (SW updates on navigation, never mid-game)

// the one hot-path message
{ version: 1, type: "buzz", clueId: "01J...", armSeq: 18, elapsedMs: 412 }
// armSeq ties the buzz to the exact arm broadcast - a buzz against a stale arm (re-arm happened)
// is dropped, which kills a whole class of rebound race bugs. elapsedMs is ignored in M3
// (server-arrival ordering) and becomes the M6 fairness input with RTT clamps - carried from
// day one so M6 needs no wire change.
```

The envelope decisions already made in M0 (integer version, spelled-out names, single
`parseEnvelope` refusal point, 4 KiB client message cap) all hold; nothing in the document layer
leaks onto the wire except ids (ULIDs) and the parsed `Settings` object the DO loads at game start.

---

## 8. Naming and file identity

**Recommendation: compound `.json` suffixes + one zip bundle extension; the `format` field is the
only machine identity.**

| Artifact          | Filename pattern       | Contains                                                  |
| ----------------- | ---------------------- | --------------------------------------------------------- |
| Content pack      | `<name>.pack.json`     | one `content-pack` document                               |
| Game definition   | `<name>.game.json`     | one `game-definition` document (pack embedded by default) |
| Theme             | `<name>.theme.json`    | one `theme` document                                      |
| Settings preset   | `<name>.settings.json` | one `settings` document (rarely exported alone)           |
| Bundle with media | `<name>.game.zip`      | `game.json` + `media/*` (storage rows say `bundled`)      |

Rationale, in order of weight:

1. **Plain `.json` opens everywhere** - editors, `jq`, a curious user double-clicking. A custom
   opaque extension (`.jmb`) reads as walled-garden and buys nothing; guiding principle 5 says the
   file is _theirs_.
2. **The importer never trusts filenames.** Drag any file in; `parseDocument` dispatches on
   `format`. Renamed files, mailed files, files called `final-FINAL(2).json` all import. The
   compound suffix is for _humans_ scanning a folder.
3. **Format ids are product-name-free** (`content-pack`, not `buzzboard.content-pack`): the product
   name is unresolved (roadmap decision 5) and may change; files in the wild must not fossilize a
   brand we later drop. No vendor MIME type registration; everything serves as `application/json`
   / `application/zip`.
4. **One bundle extension, not per-document zips.** The only thing that needs media-adjacency is a
   game export; packs with media export as `.game.zip`-style bundles too if ever needed
   (`<name>.pack.zip`, same layout) - but we do not build that until someone asks.

---

## 9. Open questions

1. **Refuse-newer-minor is strict.** A friend on yesterday's deploy cannot open a file from today's
   if a minor bump landed between - even though the change was additive. Alternative: parse newer
   minors loosely and preserve unknown fields through round-trip. Costs strictness (boundary 2.6's
   "no fields outside ext" becomes unenforceable at read time). Current call: refuse; the SW makes
   "update the app" a reload. Contest if the sharing story feels more important.
2. **New content-item types force a major bump** (strict enum). Alternative: readers keep unknown-type
   items as opaque-but-preserved and modes just cannot render them. More graceful, but "valid
   document containing items nothing can display" is a new failure mode for the editor UI. Current
   call: major bump + trivial migration.
3. **`external` content refs are id + optional hash, with no resolution protocol.** Good enough for
   the local library; a future pack-library needs a real locator story (URL? registry id?). Deferred
   on purpose - is the `sha256` field enough of a seam?
4. **ULID vs UUIDv7.** UUIDv7 is the IETF-standardized equivalent and D1/tooling ecosystems
   increasingly assume UUID columns. ULID wins on compactness and zod-native validation today.
   Cheap to swap before M1 code lands; expensive after.
5. **Does `settings` deserve standalone-document status?** It has an envelope format here for
   symmetry with the design law's four documents, but in practice it may only ever travel embedded
   in game definitions. Cutting the standalone form removes a format id to maintain.
6. **`clueTextOnPhones` default** (join group, default off) awaits the first playtest per
   user-flows open question 4 - flagged so the default is revisited, not fossilized.

---

## Owner review resolutions (2026-08-13)

Four resolutions from owner review. Where they conflict with sections above, **these win**; sections are updated during M1 implementation, not re-proposed.

### R1. File layout: directory-per-document-family, not single files

The flat layout in the header is superseded. Rules: one document family per directory, one schema cluster per file, files stay under ~150-200 lines (split by concept when approaching it), tests adjacent to the module they test, `index.ts` is an explicit named-export barrel (no `export *`) so the public API is one readable file.

```
packages/protocol/src/
  index.ts                  # explicit public API
  ids.ts                    # uuidv7 (R3)
  ext.ts  limits.ts         # exist from M0
  envelope/                 # wire envelope (M0) + document envelope + migration registry
  content/                  # content-item.ts, content-pack.ts, media-ref.ts
  modes/jeopardy/           # game-definition.ts, board.ts, cells.ts, value-schemes.ts
  settings/                 # registry.ts, groups/<group>.ts, presets.ts, derive.ts (R2)
  theme/                    # theme.ts, tokens.ts, fonts.ts, background.ts
  migrations/<format>/      # <from>-to-<to>.ts + .test.ts
```

### R2. Settings: registry-derived, not a hand-written matrix object

The 43-row matrix is the *inventory* (a research artifact); the implementation is a **settings registry**: each setting defined exactly once as an entry - key, group, zod schema, default, label, description, constraints - from which we **derive** (a) the composed zod settings schema, (b) TS types, (c) the settings UI (progressive-disclosure panel renders from the registry), and (d) the documentation table (generated, so docs cannot drift from code). Cross-field rules are group-level zod refinements. Presets are **sparse overrides on a named base** (`preset: "tv"` + diffs only) - small exports, and the UI can show "changed from TV rules" for free.

### R3. IDs: UUIDv7 (resolves open question)

RFC 9562 UUIDv7 replaces ULID everywhere ids appear: time-sortable like ULID, standard, native tooling/DB support. `ids.ts` wraps generation + zod validation in one place.

### R4. Settings become the fifth portable document: the rule-set

Rules get the same first-class treatment as themes: a **rule-set document** (`.rules.json`, format `rule-set`, same envelope) so house rules are shareable and reusable across games. Game definitions reference-or-embed a rule set with the identical embed-on-export semantics as themes (§3). The design law's table gains a row (update docs/design/expansion-and-boundaries.md in the same M1 PR):

| Document | Customizes |
|---|---|
| Content pack | The material |
| **Rule set** | **The rules** |
| Theme | The look |
| Game definition | The composition (references or embeds the other three) |
