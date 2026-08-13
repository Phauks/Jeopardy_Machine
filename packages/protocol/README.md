# @jeopardy/protocol

Shared contracts - the modularity keystone. The web client, the SvelteKit server, and `GameRoomDO` all import identical types and validators from here; nothing else may define wire or document shapes.

Import via the exports map, never deep paths. The package root `.` is the whole M1 document API as an explicit named-export surface (`src/index.ts`); the three M0 subpaths remain for wire-only consumers:

| Module                        | What                                                                                                                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@jeopardy/protocol`          | Document layer (M1): UUIDv7 ids, document envelope + semver migration machinery (`parsePortableDocument` is the one entry point for opening any file), content packs (items + media indirection), the registry-derived settings object, rule-set / theme / game-definition documents, presets |
| `@jeopardy/protocol/envelope` | Versioned wire envelope + `parseEnvelope` (the single refusal point for malformed input and version skew)                                                                                                                                                                                     |
| `@jeopardy/protocol/ext`      | The reverse-domain `ext` extension bag - the only home for fields we do not define                                                                                                                                                                                                            |
| `@jeopardy/protocol/limits`   | Every operational hard cap, documented, with an invariant gate test                                                                                                                                                                                                                           |

Layout (one document family per directory, tests adjacent): `envelope/` (wire + document + migration machinery), `content/`, `settings/` (registry + derivations + rule-set; regenerate the docs table with `pnpm -F @jeopardy/protocol generate:settings-docs`), `theme/`, `modes/jeopardy/`, `migrations/` (real registry + per-migration fixture pairs, gate-tested). Design spec: docs/proposals/m1-protocol.md (owner resolutions section governs). Generated settings reference: docs/reference/settings.md.

Ships raw TypeScript (no build step); consumers bundle it.
