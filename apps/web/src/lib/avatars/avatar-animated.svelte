<script lang="ts">
  // Your avatar, walking - the identity moment on your own phone (tier 2 of
  // docs/decisions/2026-08-14-avatars-in-motion.md). A baked filmstrip stepped by CSS alone:
  // no three.js, no canvas, no requestAnimationFrame, nothing for the device that exists to
  // buzz. The whole animation is one transform moving in steps() across one webp.
  //
  // WHERE THIS MAY BE USED: the join preview and the lobby "you're in" card. NOWHERE ELSE -
  // above all never on the buzz screen, which stays 2D and instant (the decision doc's first
  // guardrail). avatar-chip.svelte remains the representation for roster rows, score strips,
  // and every list where more than one avatar is on screen.
  //
  // The sheet is baked in the avatar's own pack colors, NOT per accent - the numbers behind
  // that are in tools/avatar-bake/src/bake.mjs (per-accent is 4.6 MB committed, or 2.4 MB and
  // visibly soft). The accent is carried by the backing, exactly as at 24px chip size. The
  // known consequence: on the join screen this preview sits above an accent-tinted picker
  // grid, so the same avatar shows in two colors at once. That is the trade, not a bug.
  import { prefersReducedMotion } from "svelte/motion";
  import { avatarManifest, avatarSheetUrl } from "#lib/avatars/avatar-manifest.ts";
  import type { AvatarAccent, AvatarEntry } from "#lib/avatars/avatar-manifest.ts";

  type Props = {
    avatar: AvatarEntry;
    accent: AvatarAccent;
    /** CSS length for the round backing's diameter. */
    size?: string;
    /** One walk cycle in ms. ~900ms reads as an unhurried stroll across 10 frames. */
    cycleMs?: number;
  };
  let { avatar, accent, size = "112px", cycleMs = 900 }: Props = $props();

  const frames = avatarManifest.sheet.frames;
  // Reduced motion freezes on frame 0 rather than hiding the avatar: the point of this
  // surface is "that one is me", which a still frame makes just as well (guardrail 2).
  const still = $derived(prefersReducedMotion.current);
</script>

<span
  class="avatar-animated"
  class:still
  style="--avatar-animated-size: {size}; --avatar-animated-accent: {accent.hex}; --avatar-animated-frames: {frames}; --avatar-animated-cycle: {cycleMs}ms"
  data-avatar-id={avatar.id}
  data-frames={frames}
>
  <!-- The viewport is one frame wide; the strip inside it is `frames` frames wide and slides
       left by exactly one frame per step. Percentage transforms resolve against the STRIP's
       own width, so translateX(-100% / frames * k) is precisely k frames - no pixel math, and
       it stays exact at any rendered size. -->
  <span class="viewport">
    <img
      class="film"
      src={avatarSheetUrl(avatar)}
      alt={avatar.displayName}
      draggable="false"
      decoding="async"
    />
  </span>
</span>

<style>
  .avatar-animated {
    width: var(--avatar-animated-size);
    height: var(--avatar-animated-size);
    flex: none;
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    /* Same backing recipe as avatar-chip.svelte: the accent darkened toward near-black so an
       accent-recolored body still separates from its own backing. */
    background: color-mix(in oklab, var(--avatar-animated-accent) 55%, #14141c);
    box-shadow: inset 0 0 0 max(1px, calc(var(--avatar-animated-size) / 24))
      color-mix(in oklab, var(--avatar-animated-accent) 60%, white);
  }

  .viewport {
    width: 88%;
    height: 88%;
    overflow: hidden;
    display: block;
  }

  .film {
    display: block;
    height: 100%;
    /* One frame per viewport width. */
    width: calc(var(--avatar-animated-frames) * 100%);
    max-width: none;
    user-select: none;
    /* steps(N) with the default jump-end samples k/N of the range for k = 0..N-1, so a -100%
       endpoint lands on frames 0..N-1 and never on the wrap frame. Frame N would be frame 0
       again (the bake samples t = i/N of the clip), so the loop is seamless with no
       duplicated frame in the strip. */
    animation: avatar-walk-cycle var(--avatar-animated-cycle)
      steps(var(--avatar-animated-frames)) infinite;
  }

  @keyframes avatar-walk-cycle {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-100%);
    }
  }

  /* Reduced motion: freeze on frame 0. tokens.css already clamps animation-duration globally
     under the media query, but a 0.01ms animation still lands on an arbitrary frame; dropping
     the animation entirely is what guarantees frame 0. */
  .avatar-animated.still .film {
    animation: none;
    transform: translateX(0);
  }
</style>
