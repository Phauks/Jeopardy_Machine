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
  // join-screen.svelte was split in two on 2026-08-15 (character + team), and on 2026-08-16 the
  // whole chain collapsed into one surface (docs/decisions/2026-08-16-persistent-layout-and-
  // pregame-rework.md). The rule survived both moves unchanged, because it was never about how
  // many screens there are: the animated sheet belongs to the ONE place a player looks at their
  // own avatar, which is now character-panel.svelte. Everything that lists more than one avatar
  // stays on still chips.
  const allowed = ["room/character-panel.svelte"];
  const surfaces = [
    "room/buzzer-screen.svelte",
    "room/scores-strip.svelte",
    "room/team-card.svelte",
    "room/teams-panel.svelte",
    "room/roster-panel.svelte",
    "room/host-console.svelte",
    "room/display-screen.svelte",
    "staging/staged-lobby-2d.svelte",
    "avatars/avatar-picker.svelte",
  ];

  it("is used by the character panel - the one place you look at your own avatar", () => {
    for (const surface of allowed) {
      expect(source(surface), surface).toContain("avatars/avatar-animated.svelte");
    }
  });

  it("is used by NOTHING else - above all not the buzz screen", () => {
    // Matched on the IMPORT, not on the name appearing anywhere in the file: a surface is
    // allowed to explain in a comment why it deliberately uses still chips instead
    // (avatar-picker.svelte does), and a gate that forbade saying so would push exactly the
    // reasoning that keeps this rule alive out of the code.
    for (const surface of surfaces) {
      expect(source(surface), surface).not.toMatch(/^\s*import .*avatar-animated/m);
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

  it("keeps the WHOLE staging layer free of three.js", () => {
    // The staging themes are DATA - primitives, positions, and colour roles - precisely so a
    // theme can be unit-tested and so the 2D degradation can read the same objects. A theme
    // that reached for three would import a renderer into the phone's bundle through the team
    // screen, and would stop being reviewable without a GPU.
    const stagingFiles = readdirSync(libDirectory + "staging", {
      recursive: true,
      encoding: "utf8",
    }).filter((name) => /\.(ts|svelte)$/.test(name) && !name.endsWith(".test.ts"));
    expect(stagingFiles.length).toBeGreaterThan(0);
    for (const name of stagingFiles) {
      const text = source(`staging/${name}`);
      expect(text, name).not.toMatch(/from "three/);
      expect(text, name).not.toMatch(/import\("three/);
    }
    // ...and the one module that IS allowed three is the one that turns the primitives into
    // geometry, so the vocabulary has exactly one implementation.
    expect(source("diorama/diorama-scene.ts")).toContain("function geometryFor");
  });
});

describe("the staged lobby degrades differently from the diorama, on purpose", () => {
  it("renders its 2D layout whenever the scene is not live", () => {
    // The diorama may degrade to NOTHING - it is decoration. The staging may not: which
    // station you are on is the answer to the question the pre-game screens are asking, so
    // the wrapper renders the CSS staged view until the renderer reports itself up.
    const wrapper = source("staging/staged-lobby.svelte");
    expect(wrapper).toContain("{#if !sceneReady}");
    expect(wrapper).toContain("StagedLobby2d");
    // And it must start not-ready, so SSR and a WebGL-less browser both get the layout.
    expect(wrapper).toMatch(/let sceneReady = \$state\(false\)/);
  });

  it("carries the theme's own nouns into the 2D view rather than hard-coding boats", () => {
    const fallback = source("staging/staged-lobby-2d.svelte");
    expect(fallback).toContain("theme.stationNoun");
    expect(fallback).toContain("theme.holdingAreaNoun");
    expect(fallback).not.toMatch(/>\s*boat\b/);
  });

  it("stands everyone still on their spot under reduced motion", () => {
    // Same rule the wander freeze follows: the layout survives, the journey does not.
    const motion = source("staging/staging-motion.ts");
    expect(motion).toContain("if (options.frozen)");
    expect(motion).toMatch(/frozen[\s\S]{0,400}mode: "idle"/);
    expect(source("staging/staging-motion.ts")).toMatch(/if \(frozen\) return 0;/);
  });

  // Owner report, 2026-08-16: "I don't understand still in the water", and "names beneath the
  // boats". Both fixes have to exist on BOTH paths or the answer depends on whether the
  // projector laptop happened to have WebGL - which is the one thing the staged lobby's whole
  // two-path design exists to prevent. The 3D half cannot be rendered in a headless test, so
  // it is gated at the source, next to the 2D half that IS rendered (staged-lobby.states.test).
  it("says the holding-area words on the 3D stage as well as in the CSS one", () => {
    const scene = source("diorama/diorama-scene.ts");
    const fallback = source("staging/staged-lobby-2d.svelte");
    for (const surface of [scene, fallback]) {
      expect(surface).toContain("staging/staging-copy.ts");
      expect(surface).toContain("holdingAreaCopy");
    }
    // The words are DRAWN, not merely computed: a sprite the scene positions over the water.
    expect(scene).toContain("#writeHoldingLabel");
    expect(scene).toContain("#positionHoldingLabel");
  });

  it("draws the crew's names beneath each station on both paths", () => {
    expect(source("diorama/diorama-scene.ts")).toContain("#writeCrewPlate");
    expect(source("staging/staged-lobby-2d.svelte")).toContain("crew-plate");
    // ...and the overflow rule is shared, so the two views list the same people.
    expect(source("staging/staged-lobby-2d.svelte")).toContain("crewPlateNameLimit");
    expect(source("diorama/diorama-scene.ts")).toContain("crewPlate(");
  });

  it("gives the water a boundary rather than running it under the whole stage", () => {
    // The 60x40 plane is what made "in the water" indistinguishable from "on the floor".
    const boats = source("staging/staging-themes/boats.ts");
    expect(boats).not.toContain("width: 60");
    expect(boats).toContain("edge:");
    expect(source("diorama/diorama-scene.ts")).toContain("holding-edge-");
    expect(source("staging/staged-lobby-2d.svelte")).toContain("holding-noun");
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
    // The branch reports the unavailability out (staged-lobby.svelte needs to know) and then
    // returns without constructing anything - what matters is that nothing is built.
    expect(mount).toMatch(/if \(!supportsWebGl\(\)\) \{[^}]*return;\s*\}/);
    expect(mount).not.toMatch(/new SceneClass[\s\S]{0,200}supportsWebGl/);
  });

  it("host mirror mode does not spin up a second renderer", () => {
    expect(source("room/host-console.svelte")).toContain('environment="none"');
  });
});
