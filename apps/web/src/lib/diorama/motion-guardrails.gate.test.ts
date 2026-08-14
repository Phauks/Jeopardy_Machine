// The guardrails from docs/decisions/2026-08-14-avatars-in-motion.md, enforced instead of
// remembered. Each rule below is one the owner approved and one that is cheap to violate by
// accident months from now: an import added to the wrong screen, a static three.js import
// that quietly puts a renderer in every phone's bundle, a reduced-motion freeze deleted as
// "dead CSS". Source-level gates are the right shape for these - the violation is visible in
// the source, and catching it needs no browser, no GPU, and no CI browser download.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const libDirectory = fileURLToPath(new URL("../", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(libDirectory + relativePath, "utf8");
}

describe("guardrail 1: motion never reaches the buzzer's critical path", () => {
  // "Never on the buzzer's critical path. The phone's buzz screen stays 2D and instant;
  //  animation lives on the join/lobby screens only."
  const allowed = ["room/join-screen.svelte", "room/lobby-screen.svelte"];
  const surfaces = [
    "room/buzzer-screen.svelte",
    "room/scores-strip.svelte",
    "room/team-card.svelte",
    "room/identity-sheet.svelte",
    "room/host-console.svelte",
    "room/display-screen.svelte",
    "avatars/avatar-picker.svelte",
  ];

  it("is used by the join and lobby screens", () => {
    for (const surface of allowed) {
      expect(source(surface), surface).toContain("avatars/avatar-animated.svelte");
    }
  });

  it("is used by NOTHING else - above all not the buzz screen", () => {
    for (const surface of surfaces) {
      expect(source(surface), surface).not.toContain("avatar-animated");
    }
  });

  it("freezes on frame 0 under prefers-reduced-motion", () => {
    const component = source("avatars/avatar-animated.svelte");
    expect(component).toContain("prefersReducedMotion");
    // The freeze is an explicit state, not a reliance on the global animation-duration clamp
    // in theme/tokens.css - that clamp shortens an animation, it does not choose a frame.
    expect(component).toMatch(/\.avatar-animated\.still \.film \{[^}]*animation: none/);
    expect(component).toMatch(/\.avatar-animated\.still \.film \{[^}]*translateX\(0\)/);
  });
});

describe("guardrail: three.js stays off every non-display surface", () => {
  it("lives in exactly one module, reached only by dynamic import", () => {
    // A static `import ... from "three"` anywhere else - or in the mount component itself -
    // would put a renderer in the shared chunk that every route, including a phone joining a
    // room, downloads. The dynamic import in avatar-diorama.svelte is what makes it a chunk
    // the display route alone fetches.
    const scene = source("diorama/diorama-scene.ts");
    expect(scene).toContain('import * as THREE from "three"');

    const mount = source("diorama/avatar-diorama.svelte");
    expect(mount).not.toMatch(/^\s*import .*from "three/m);
    expect(mount).toContain('import("#lib/diorama/diorama-scene.ts")');
    // Type-only imports of the scene are fine (they erase); a value import would not be.
    expect(mount).toMatch(/import type \{[^}]*DioramaScene[^}]*\} from/);
  });

  it("keeps the display-only MODEL data out of every phone's bundle too", () => {
    // avatar-models.json is ~7.5 KB of GLB filenames, clip names, and recolor targets that
    // only the diorama reads. It used to live in avatar-manifest.json - a static import on
    // the join screen, the lobby, and the score strip - and cost every phone in the room
    // those bytes. Splitting it only helps while the ONLY importer is behind the dynamic
    // import, so that is what this checks.
    const importers = readdirSync(libDirectory, { recursive: true, encoding: "utf8" })
      .filter((name) => /\.(ts|svelte)$/.test(name) && !name.endsWith(".test.ts"))
      .filter((name) => source(name).includes("avatars/avatar-models.ts"));
    for (const importer of importers) {
      expect(importer.replaceAll("\\", "/"), importer).toMatch(/^diorama\//);
    }
    expect(importers.length).toBeGreaterThan(0);
    expect(source("avatars/avatar-manifest.ts")).not.toContain("avatar-models.json");
  });

  it("keeps the movement rules and the environment slot free of three.js", () => {
    // Both are imported by node tests, so a three.js import here would drag a renderer into
    // the plain unit suite - and, worse, mean the wander rules could no longer be reasoned
    // about without one.
    for (const module of ["diorama/wander.ts", "diorama/diorama-environment.ts"]) {
      expect(source(module), module).not.toMatch(/^import .*"three/m);
    }
  });
});

describe("guardrail 3+4: the diorama is decoration, and never behind a live clue", () => {
  const display = source("room/display-screen.svelte");

  it("mounts only on lobby, interstitial, and winner phases", () => {
    // The clue-bearing phases (reading/armed/answering/wagering) must not appear in the
    // diorama's phase list, or a projector would render a crowd behind the clue text.
    const phaseList = /const dioramaPhases = \[([^\]]*)\]/.exec(display)?.[1] ?? "";
    expect(phaseList.length).toBeGreaterThan(0);
    for (const cluePhase of ["reading", "armed", "answering", "wagering", "awaiting-selection"]) {
      expect(phaseList, cluePhase).not.toContain(`"${cluePhase}"`);
    }
    for (const allowed of ["round-break", "game-over"]) {
      expect(phaseList, allowed).toContain(`"${allowed}"`);
    }
  });

  it("gates the mount in the template, so 'not shown' also means 'not rendering'", () => {
    expect(display).toMatch(/\{#if showDiorama\}/);
  });

  it("degrades to the 2D lobby when WebGL is unavailable", () => {
    const mount = source("diorama/avatar-diorama.svelte");
    expect(mount).toContain("supportsWebGl()");
    // No context, no scene, no canvas fade-in: the surrounding 2D screen is left untouched.
    expect(mount).toMatch(/if \(!supportsWebGl\(\)\) return;/);
  });

  it("host mirror mode does not spin up a second renderer", () => {
    expect(source("room/host-console.svelte")).toContain('environment="none"');
  });
});
