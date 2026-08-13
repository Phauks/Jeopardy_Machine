# @jeopardy/protocol

Shared contracts - the modularity keystone. The web client, the SvelteKit server, and `GameRoomDO` all import identical types and validators from here; nothing else may define wire or document shapes.

M0 surface (import via the exports map, never deep paths):

| Module                        | What                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@jeopardy/protocol/envelope` | Versioned wire envelope + `parseEnvelope` (the single refusal point for malformed input and version skew) |
| `@jeopardy/protocol/ext`      | The reverse-domain `ext` extension bag - the only home for fields we do not define                        |
| `@jeopardy/protocol/limits`   | Every operational hard cap, documented, with an invariant gate test                                       |

M1 adds the four document schemas (content pack, game definition, settings, theme) plus migrations - proposal: docs/proposals/m1-protocol.md. Ships raw TypeScript (no build step); consumers bundle it.
