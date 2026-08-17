// What the avatars stand in, and where its colors come from.
//
// ENVIRONMENT SLOT - landed. docs/research/00-user-directives.md ("3D environments") asked for
// a curated `environment` field on the THEME document, exactly like `soundSet`: forest /
// pirate / dungeon / none, presentation-layer only, zero game-logic coupling. The vocabulary
// lived here as a local enum while the diorama was built; the 2026-08-16 reconcile put it in
// `themeBodySchema` (packages/protocol/src/theme/theme.ts) and this file now resolves the
// document's value rather than owning it.
//
// The RESOLUTION is the part worth keeping local, because a theme document is data and this
// build is a build: a theme may name an environment whose kit has not shipped, and the display
// still has to render something. So `resolveDioramaEnvironment` maps every scenery choice this
// build cannot draw onto the one it can, and only "none" is honoured exactly - it means "the
// clean 2D lobby", which is why avatar-diorama.svelte treats it as "do not mount" rather than
// as an empty scene.
//
// The kits themselves (Kenney Nature Kit for the forest, Pirate Kit, Dungeon Kit - all CC0,
// same visual universe as the avatars) are a later pass: they need their own download +
// license verification + budget in tools/avatar-bake, and "studio" exists so the diorama is
// shippable and reviewable before any of that.
import type { ThemeEnvironment } from "@jeopardy/protocol";

/** What this build can actually draw. The theme document's vocabulary is wider - see below. */
export type DioramaEnvironment = "none" | "studio";

/**
 * A theme document's `environment` as this build renders it. Unknown and unbuilt scenery falls
 * back to the studio rather than to nothing: losing the avatars is a worse answer than showing
 * them on a plain stage, and a theme written for a later release must not blank the display.
 * Only "none" turns the diorama off, because only "none" MEANS off.
 */
export function resolveDioramaEnvironment(
  value: ThemeEnvironment | string | null | undefined,
): DioramaEnvironment {
  return value === "none" ? "none" : "studio";
}

/** Colors the scene paints itself with, all derived from the active theme's tokens. */
export type DioramaPalette = {
  /** The floor the avatars walk on. */
  ground: string;
  /** The backdrop wall and the fog color - the page behind the diorama. */
  backdrop: string;
  /** Rim/accent light, so the theme's accent shows up in the lighting, not just the chips. */
  accent: string;
  /**
   * The staged lobby's holding-area surface - the water. Only themes that draw one use it
   * (src/lib/staging/staging-theme.ts, `holdingSurface`); a clearing leaves the ground bare.
   */
  holding: string;
  /** Neutral station structure: masts, stools, rope. Never the team's colour. */
  structure: string;
  /** Nameplate text, and the family stack it is drawn in - both follow the room's theme. */
  nameplateColor: string;
  nameplateFont: string;
};

/**
 * Resolve a themed color from a CSS custom property.
 *
 * getComputedStyle returns custom properties RAW - `--surface-raised` really is the string
 * "color-mix(in srgb, #0a0b33 90%, #ffffff)", which three.js cannot parse. Assigning the
 * token to a real color property and reading THAT back makes the browser do the resolving,
 * and hands back a plain rgb() every time. The probe is a detached element, so it never
 * reflows the display.
 */
export function resolveThemeColor(source: Element, token: string, fallback: string): string {
  const ownerDocument = source.ownerDocument;
  const probe = ownerDocument.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${token}, ${fallback})`;
  source.append(probe);
  const resolved = ownerDocument.defaultView?.getComputedStyle(probe).color ?? fallback;
  probe.remove();
  // A browser that could not resolve the token leaves the property empty rather than throwing.
  return resolved.length > 0 ? resolved : fallback;
}

/**
 * The diorama's palette for whatever theme `source` sits inside. Deliberately built from the
 * SAME semantic tokens the 2D surfaces use (docs/design/theming.md: components consume only
 * semantic tokens, never raw colors), so a new theme themes the 3D scene for free.
 */
export function readDioramaPalette(source: Element): DioramaPalette {
  return {
    // The board's cell color is the theme's most saturated "surface you look at" - it reads
    // as a stage floor far better than the near-black page background does.
    ground: resolveThemeColor(source, "--board-cell-bg", "#060ce9"),
    backdrop: resolveThemeColor(source, "--surface-page", "#0a0b33"),
    accent: resolveThemeColor(source, "--accent", "#ffcc00"),
    // Every token below is one of the PLAIN-COLOR tokens (docs/design/theming.md's table).
    // The derived --surface-* tokens are deliberately not used here: they are color-mix()
    // expressions with an alpha term, and three's color parser drops alpha silently, which
    // would give a half-transparent water plane a solid colour nobody chose.
    //
    // Water is the theme's category fill over its cell fill: one step deeper than the ground
    // in every preset, which is exactly what water wants to be, with no water colour invented.
    holding: resolveThemeColor(source, "--board-category-bg", "#0509c0"),
    // The theme's deepest colour - masts and stools read as dark timber against any preset.
    structure: resolveThemeColor(source, "--board-bg", "#06071a"),
    nameplateColor: resolveThemeColor(source, "--clue-text-color", "#ffffff"),
    // The chrome font slot is a FAMILY STACK, which is precisely what a canvas 2D context
    // wants - so a nameplate is set in the same face as the roster it names.
    nameplateFont: readCustomProperty(source, "--font-chrome", "sans-serif"),
  };
}

/** Raw custom-property read - correct for non-colors, where resolveThemeColor's trick fails. */
function readCustomProperty(source: Element, token: string, fallback: string): string {
  const value = source.ownerDocument.defaultView
    ?.getComputedStyle(source)
    .getPropertyValue(token)
    .trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

/**
 * Is live 3D available here at all? A projector laptop with a blocked or missing GL context,
 * a locked-down browser, or a headless test runner all answer no - and the display falls back
 * to the 2D lobby it has always had. The diorama is decoration, never a dependency of play
 * (guardrail 3 of docs/decisions/2026-08-14-avatars-in-motion.md).
 */
export function supportsWebGl(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return context !== null;
  } catch {
    // Some privacy modes throw rather than return null.
    return false;
  }
}
