# Schema friction found while building the dummy dataset

> 2026-08-14 · Source: the fixtures agent's validation work (fixtures/ + packages/protocol/src/fixtures-dataset.test.ts). These are protocol follow-ups for M1-phase-2 (editor/import) - none block current work; fixtures carry documented workarounds.

## 1. Content packs have no intrinsic id (real gap)

`gameContentSchema`'s external variant requires `packId`, but a pack document carries no id field - so a portable pack file cannot state the id an external game must reference; the pairing doesn't survive inside the file itself. Fixtures work around it via a `libraryId` in the pack's `ext` bag.
**Proposed fix:** add an `id` to the pack envelope body (or formally document library-assigned ids as the contract and give the importer a re-link flow). Decide when building the importer.

## 2. "sha256 of the pack's canonical JSON" is unspecified (must pin before import ships)

No canonicalization is defined, so two byte-different serializations of the same pack hash differently. Fixtures define it as **exact file bytes** and the test enforces that.
**Proposed fix:** pin the definition (exact-bytes is the simplest honest contract: the hash certifies the file you shipped, not an abstract document) and write it into the game-definition schema comment + importer behavior (hash mismatch -> drift warning + re-link option).

## 3. Minor, lint-tier (schema deliberately permissive)

- `documentMetaSchema` doesn't constrain `modified >= created` - editor lint, not schema.
- `mediaAssetSchema.bytes` unchecked against `limits.media` at parse time (per existing comments, enforcement lives at upload/export) - keep, but the editor lint panel should surface it.

## Context notes

- A complete 6x5 two-round + final game needs 61 distinct items; the dummy pack is sized accordingly (cells are references; duplicate ids would be worse test data).
- Fixture maintenance rule (fixtures/README.md): fixtures are updated via migration when formats bump, never silently regenerated - they double as migration regression tests.
