// Invariant gate for the curated emblem set: the set's design rules (single-color via
// currentColor, one grid, curated size range) are what make it an answer to the owner's
// emoji skepticism - so they are enforced, not hoped for.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import EmblemMark from "#lib/emblems/emblem-mark.svelte";
import { emblems } from "#lib/emblems/emblem-set.ts";

describe("curated emblem set invariants", () => {
  it("stays a curated size: 12-20 marks, unique kebab-case ids", () => {
    expect(emblems.length).toBeGreaterThanOrEqual(12);
    expect(emblems.length).toBeLessThanOrEqual(20);
    const ids = emblems.map((emblem) => emblem.id);
    expect(new Set(ids).size).toBe(emblems.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("covers all three motif families", () => {
    const categories = new Set(emblems.map((emblem) => emblem.category));
    expect(categories).toEqual(new Set(["nature", "gaming", "geometric"]));
  });

  it("marks are single-color: no fill/stroke/style attributes, tint comes from currentColor", () => {
    for (const emblem of emblems) {
      // fill-rule= is allowed (path winding); fill= (a hard-coded color) is not.
      expect(emblem.markup, emblem.id).not.toContain('fill="');
      expect(emblem.markup, emblem.id).not.toContain("stroke=");
      expect(emblem.markup, emblem.id).not.toContain("style=");
      expect(emblem.markup, emblem.id).not.toContain("<svg");
    }
  });

  it("renders as an accessible svg with the label", () => {
    const first = emblems[0];
    expect(first).toBeDefined();
    if (!first) return;
    const { body } = render(EmblemMark, { props: { emblem: first } });
    expect(body).toContain('fill="currentColor"');
    expect(body).toContain(`aria-label="${first.label}"`);
  });
});
