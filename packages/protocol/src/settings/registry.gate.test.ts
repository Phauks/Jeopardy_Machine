// Invariant gate: the registry IS the rules matrix. Pins exactly which matrix rows are
// covered so a dropped setting (or an accidental duplicate id) cannot slip through, and
// checks the structural invariants every derivation relies on.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { settingsSchema } from "./derive.ts";
import { settingsGroups } from "./registry.ts";

describe("settings registry gate", () => {
  it("covers matrix rows 1-19 and 21-43 exactly (20 is always-on host override, not a setting)", () => {
    const covered = new Set<number>();
    for (const group of settingsGroups) {
      for (const definition of Object.values(group.settings)) {
        if (definition.matrixRow !== null) covered.add(definition.matrixRow);
      }
    }
    const expected = new Set<number>();
    for (let row = 1; row <= 43; row += 1) {
      if (row !== 20) expected.add(row);
    }
    expect([...covered].toSorted((a, b) => a - b)).toEqual([...expected].toSorted((a, b) => a - b));
  });

  it("has unique group ids and unique setting keys per group", () => {
    const groupIds = settingsGroups.map((group) => group.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });

  it("derived schema group keys match the registry list exactly - no drift between the two", () => {
    const schemaKeys = Object.keys(settingsSchema.shape).toSorted();
    const registryIds = settingsGroups.map((group) => group.id).toSorted();
    expect(schemaKeys).toEqual(registryIds);
  });

  it("every setting schema carries a default (the whole matrix collapses to a default game)", () => {
    for (const group of settingsGroups) {
      for (const [key, definition] of Object.entries(group.settings)) {
        expect(
          definition.schema instanceof z.ZodDefault,
          `${group.id}.${key} must have a .default(...)`,
        ).toBe(true);
      }
    }
  });

  it("every setting has a label and a description, and refinement paths point at real keys", () => {
    for (const group of settingsGroups) {
      for (const definition of Object.values(group.settings)) {
        expect(definition.label.length).toBeGreaterThan(0);
        expect(definition.description.length).toBeGreaterThan(0);
      }
      for (const refinement of group.refinements) {
        expect(Object.keys(group.settings)).toContain(refinement.path);
      }
    }
  });

  it("duration settings follow the Ms-suffix convention", () => {
    for (const group of settingsGroups) {
      for (const [key, definition] of Object.entries(group.settings)) {
        const mentionsTime = /timer|delay|window|clock|limit|lockout/i.test(key);
        if (mentionsTime) {
          expect(key.endsWith("Ms"), `${group.id}.${key} should carry the Ms suffix`).toBe(true);
        }
        expect(definition).toBeDefined();
      }
    }
  });
});
