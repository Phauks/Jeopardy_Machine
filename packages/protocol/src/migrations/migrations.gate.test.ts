// Invariant gate (same pattern as limits.gate.test.ts): the migration convention is enforced
// by CI, not by discipline. For every registry we ship: version-chain integrity is already
// thrown at registry construction (envelope/migration.ts), so this gate covers what only the
// filesystem can prove - each registered migration has its committed fixture pair, the pair
// actually agrees with the migrate function, and both halves normalize to the identical
// current-version document through parseDocument.
import { describe, expect, it } from "vitest";
import { parseDocument } from "../envelope/migration.ts";
import type { DocumentFormatDefinition, DocumentRegistry } from "../envelope/migration.ts";
import { exampleRegistry } from "./example/example-format.ts";
import { documentRegistry } from "./registry.ts";
import { missingFixtureProblems, orphanFixtureProblems, readFixturePair } from "./fixture-gate.ts";

// The example registry keeps the gate honest from the first migration ever written (the real
// formats have no migrations yet - their chains are genesis-only until a version bumps).
const registriesUnderGate: DocumentRegistry[] = [documentRegistry, exampleRegistry];

const allDefinitions: DocumentFormatDefinition[] = registriesUnderGate.flatMap((registry) => [
  ...registry.values(),
]);

describe("migrations gate", () => {
  it("every registered migration has a committed before/after fixture pair", () => {
    expect(allDefinitions.flatMap(missingFixtureProblems)).toEqual([]);
  });

  it("no fixture file outlives its migration", () => {
    expect(orphanFixtureProblems(allDefinitions)).toEqual([]);
  });

  it("each migration step transforms its before-fixture body into its after-fixture body", () => {
    for (const definition of allDefinitions) {
      for (const migration of definition.migrations) {
        const { before, after } = readFixturePair(migration);
        const beforeBody = (before as { body: unknown }).body;
        const afterBody = (after as { body: unknown }).body;
        expect(migration.migrate(beforeBody)).toEqual(afterBody);
      }
    }
  });

  it("every historical fixture chains to the same current-version document as its after half", () => {
    for (const registry of registriesUnderGate) {
      for (const definition of registry.values()) {
        for (const migration of definition.migrations) {
          const { before, after } = readFixturePair(migration);
          const fromBefore = parseDocument(registry, before);
          const fromAfter = parseDocument(registry, after);
          expect(fromBefore.ok).toBe(true);
          expect(fromAfter.ok).toBe(true);
          if (fromBefore.ok && fromAfter.ok) {
            expect(fromBefore.document).toEqual(fromAfter.document);
          }
        }
      }
    }
  });
});
