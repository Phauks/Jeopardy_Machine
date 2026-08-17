// Recolors a baked avatar image in the BROWSER, so the animated preview wears the player's
// accent (and, for the human models, their chosen skin tone) instead of pack colors.
//
// THE BUG THIS EXISTS TO FIX
// (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md - "the Look control
// recolours the character's backdrop, not the character"):
// still sprites are baked per accent, all 216 of them, so every chip and every picker cell has
// always been correct. The walk sheet is not - there is ONE per avatar, in the pack's own
// colors, because per-accent sheets measured at 4.6 MB committed (tools/avatar-bake/src/
// bake.mjs) and were rightly refused. avatar-animated.svelte therefore had nowhere to put the
// accent and put it on the round backing behind the character, and documented that as an
// accepted trade. It is the LARGEST thing on the character screen, so what a player saw when
// they tapped a colour was the backdrop changing and the character not. The owner overruled
// the trade; this module is the third option neither side of that trade considered - recolor
// the sheet at load time, on the device, from the same bytes the bake used.
//
// It is the same mechanism, not a lookalike: palette-recolor.ts's recolorPixels, the same
// function the bake ran offline over the stills and the diorama runs at runtime over its
// colormaps, against the same per-avatar targets (carried on the sprite manifest since v3).
// A recoloured sheet frame and the corresponding baked still therefore agree by construction.
//
// COST, AND WHY IT IS PAID ONCE. One decode + one 1280x128 canvas pass per distinct
// (avatar, accent, tone), cached at module scope and shared by every component instance. A
// player flipping through eight accents pays eight; a hundred-player roster pays once per
// distinct combination on screen, not once per player. Nothing here runs during SSR or on a
// device without canvas - callers get null and keep the baked image, which for the still
// sprites is already accent-correct.
import { recolorPixels } from "#lib/avatars/palette-recolor.ts";
import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
import type { AvatarEntry } from "#lib/avatars/avatar-manifest.ts";

/** What to paint onto one avatar image. `toneHex` is null unless a human chose a tone. */
export type RecolorRequest = {
  avatar: AvatarEntry;
  /** The source image URL - a walk sheet or a still sprite, both work. */
  sourceUrl: string;
  accentHex: string;
  toneHex: string | null;
};

/**
 * Cache key. The source URL is in it because the still and the sheet are different images of
 * the same avatar and must not share an entry.
 */
function cacheKeyFor(request: RecolorRequest): string {
  return `${request.sourceUrl}|${request.accentHex}|${request.toneHex ?? "-"}`;
}

const cache = new Map<string, Promise<string | null>>();

/** True when this environment can actually do the work (browser with a 2D canvas). */
export function canRecolorHere(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof HTMLCanvasElement !== "undefined"
  );
}

async function recolorToDataUrl(request: RecolorRequest): Promise<string | null> {
  try {
    const response = await fetch(request.sourceUrl);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: false });
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);

    // ACCENT FIRST, THEN TONE, and the order is load-bearing. recolorPixels rewrites matched
    // pixels to the new colour, so a cell that both passes could claim would be read twice -
    // the second pass would be measuring the first pass's output. They cannot collide today
    // (the manifest gate holds skin cells and accent targets apart by more than either
    // tolerance), and running accent first means that if a future pack update ever broke that,
    // the visible result is a garment keeping its accent rather than a face turning gold.
    recolorPixels(
      image.data,
      request.avatar.recolorTargets,
      request.accentHex,
      request.avatar.tolerance ?? undefined,
    );
    if (request.toneHex !== null) {
      recolorPixels(
        image.data,
        avatarManifest.skinRecolor.targets,
        request.toneHex,
        avatarManifest.skinRecolor.tolerance,
      );
    }

    context.putImageData(image, 0, 0);
    // A data URL rather than an object URL: these are cached for the life of the page and
    // shared between components, so there is no owner who could safely revokeObjectURL, and a
    // leaked object URL is worse than the bytes.
    return canvas.toDataURL("image/webp");
  } catch {
    // Any failure - offline, a decode the browser refuses, a tainted canvas - falls back to
    // the baked image. A preview in pack colors is a worse preview, never a broken screen.
    return null;
  }
}

/**
 * The recoloured image as a data URL, or null when this environment cannot produce one.
 * Repeated calls for the same combination share one in-flight promise and one result.
 */
export function recoloredImageUrl(request: RecolorRequest): Promise<string | null> {
  if (!canRecolorHere()) return Promise.resolve(null);
  const key = cacheKeyFor(request);
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const pending = recolorToDataUrl(request);
  cache.set(key, pending);
  return pending;
}

/** Test seam: drops every cached recolor. Never called by shipped surfaces. */
export function clearRecolorCache(): void {
  cache.clear();
}
