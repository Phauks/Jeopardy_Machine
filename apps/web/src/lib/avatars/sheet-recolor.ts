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
// WHY MATCHING A FLAT PALETTE CELL AGAINST A RENDERED IMAGE WORKS AT ALL. It is not obvious
// that it should. The bake recolors the flat colormap and THEN renders it under an ambient
// plus three directional lights, so a lit pixel of a cell is not the cell's own hex, and the
// targets in the manifest are colormap hexes. It works because Kenney's models are flat-shaded
// blocks lit ambient-heavy: a face is one even shade, and enough of those shades land inside
// the bake's own tolerance. Measured over all 27 committed sheets, the share of opaque pixels
// the avatar's own targets claim is:
//
//   pets    14-71% (mean ~50%) - a pet IS its body, so this is most of the silhouette
//   humans  0.6-22%            - a signature garment is a small part of a person; Preston's
//                                tie at 0.56% and Otis's shorts at 1.5% are the honest floor
//   skin    0.1-27% of a human - face and hands, and near zero for Vera, who is in a lab coat
//
// The control that makes those numbers mean something: the same targets claim only 0-2.6% of
// an already-recoloured still, because the bake moved those cells. Re-measure with sharp over
// static/avatars/ if a pack update ever lands.
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
    let changed = recolorPixels(
      image.data,
      request.avatar.recolorTargets,
      request.accentHex,
      request.avatar.tolerance ?? undefined,
    );
    if (request.toneHex !== null) {
      changed += recolorPixels(
        image.data,
        avatarManifest.skinRecolor.targets,
        request.toneHex,
        avatarManifest.skinRecolor.tolerance,
      );
    }

    // The same assertion the bake makes ("recolor targets matched no colormap pixels"), in its
    // runtime half and demoted from a throw to a fallback. Zero changed pixels means the
    // targets no longer describe this image - a pack update that moved the colormap, or a
    // roster edit committed without a re-bake - and the honest response is to keep painting
    // the per-accent still, which is baked and therefore still correct, rather than to show a
    // walking avatar in pack colors. That is the bug this module exists to fix, so it must not
    // be the failure mode. Deliberately "> 0" and not a percentage: Preston's tie is 0.56% of
    // him, and a threshold generous enough to feel safe would silently drop the avatars whose
    // accent is a small, deliberate detail.
    if (changed === 0) return null;

    context.putImageData(image, 0, 0);
    // PNG, AND LOSSLESS IS THE WHOLE POINT (owner report 2026-08-19, "strange color artifacting
    // when selecting a player avatar and color"). This encoded `image/webp`, which the canvas
    // spec leaves at a LOSSY default quality - and a walk sheet is the worst possible input for
    // one: ten frames of hard-edged sprite laid side by side, so the encoder's blocks straddle
    // the boundary between one frame and the next and chroma is subsampled straight across the
    // transparent gutter between them. The viewport shows exactly one frame, so what bled in
    // from its neighbours appeared as coloured fringes crawling along the edges as the cycle
    // stepped - and got worse the more saturated the accent, because a stronger accent is more
    // chroma to smear. PNG has no lossy mode to fall into. It is bigger, but this never touches
    // the network: it is a data URL held in memory for the life of the page.
    //
    // A data URL rather than an object URL: these are cached for the life of the page and
    // shared between components, so there is no owner who could safely revokeObjectURL, and a
    // leaked object URL is worse than the bytes.
    return canvas.toDataURL("image/png");
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
