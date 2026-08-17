// The theme document's two PRESENTATION slots, as the web app consumes them: `environment`
// (the 3D scenery) and `staging` (the pre-game seating chart). Both were local vocabularies
// while the diorama and the staged lobby were built and became `themeBodySchema` fields at the
// 2026-08-16 reconcile (packages/protocol/src/theme/theme.ts).
//
// Two properties are worth holding. A theme is DATA, so every value the schema permits must
// render something - including scenery whose kit has not shipped and ids from a future build.
// And the query strings that previewed these before the slots existed must keep working as dev
// overrides, or reviewing a preset against a stage costs a document edit.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { themeEnvironmentSchema, themeStagingSchema } from "@jeopardy/protocol";
import { resolveDioramaEnvironment } from "#lib/diorama/diorama-environment.ts";
import { stagingThemeById } from "#lib/staging/staging-theme-registry.ts";
import { terraVerdePreset, themePresets } from "#lib/theme/theme-presets.ts";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(sourceRoot + relativePath, "utf8");
}

describe("resolving the environment slot", () => {
  it("renders SOMETHING for every value the schema permits", () => {
    for (const value of themeEnvironmentSchema.options) {
      expect(["none", "studio"], value).toContain(resolveDioramaEnvironment(value));
    }
  });

  it("honours 'none' exactly - it is the only value that means 'no diorama'", () => {
    expect(resolveDioramaEnvironment("none")).toBe("none");
    // Scenery this build cannot draw yet (the Kenney kits are a later pass) falls back to the
    // studio stage rather than to nothing: losing the avatars is the worse answer, and a theme
    // written for a later release must never blank a projector.
    expect(resolveDioramaEnvironment("forest")).toBe("studio");
    expect(resolveDioramaEnvironment("dungeon")).toBe("studio");
    expect(resolveDioramaEnvironment("a-theme-from-2027")).toBe("studio");
    expect(resolveDioramaEnvironment(null)).toBe("studio");
  });
});

describe("the presets speak the document's vocabulary", () => {
  it("names both slots on the event preset, and neither anywhere it does not care", () => {
    // Terra Verde is the first theme that actually WANTS a stage: campfires in a clearing
    // (docs/decisions/2026-08-15-staged-lobby.md), chosen by the document rather than a URL.
    expect(themeStagingSchema.parse(terraVerdePreset.staging)).toBe("campfires");
    expect(themeEnvironmentSchema.parse(terraVerdePreset.environment)).toBe("forest");
    expect(stagingThemeById(terraVerdePreset.staging).id).toBe("campfires");
    // ...and it renders today on the stage this build has, with no screen edit the day the
    // forest models land.
    expect(resolveDioramaEnvironment(terraVerdePreset.environment)).toBe("studio");

    const silent = themePresets.filter((preset) => preset.id !== "terra-verde");
    for (const preset of silent) {
      expect(preset.staging, preset.id).toBeUndefined();
      // Absent leaves the surface on its own default (boats, studio) - a preset that says
      // nothing about scenery must not be read as saying "none".
      expect(stagingThemeById(preset.staging).id).toBe("boats");
      expect(resolveDioramaEnvironment(preset.environment)).toBe("studio");
    }
  });
});

// Source-level, the same shape as display-responsive.gate.test.ts: what a route reads out of
// the URL cannot be observed in an SSR render, and adding a browser to `pnpm test` for it would
// break the PR gate.
describe("the routes read the document, with the query strings still overriding", () => {
  const displayRoute = source("routes/room/[code]/display/+page.svelte");
  const playerRoute = source("routes/room/[code]/+page.svelte");

  it("takes the staging theme from the document on both surfaces", () => {
    for (const [name, route] of [
      ["display", displayRoute],
      ["player", playerRoute],
    ] as const) {
      expect(route, name).toContain('page.url.searchParams.get("staging") ?? theme.staging');
    }
  });

  it("takes the environment from the document on the display, resolved before it is passed", () => {
    expect(displayRoute).toContain("resolveDioramaEnvironment(");
    expect(displayRoute).toContain('page.url.searchParams.get("environment") ?? theme.environment');
  });

  it("keeps the override order: a dev query string wins over the document, never the reverse", () => {
    // `?? theme.x` after the query read is the whole contract; reversing it would make the
    // preview affordances silently dead on any theme that names a slot.
    for (const route of [displayRoute, playerRoute]) {
      expect(route).not.toMatch(/theme\.(staging|environment) \?\? page\.url/);
    }
  });
});
