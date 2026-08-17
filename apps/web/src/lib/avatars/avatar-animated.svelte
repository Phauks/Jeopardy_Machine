<script lang="ts">
  // Your avatar, walking - the identity moment on your own phone (tier 2 of
  // docs/decisions/2026-08-14-avatars-in-motion.md). A baked filmstrip stepped by CSS alone:
  // no three.js, no requestAnimationFrame, nothing for the device that exists to buzz. The
  // whole animation is one transform moving in steps() across one webp.
  //
  // WHERE THIS MAY BE USED: the pre-game screen's character panel and its "you're in" card.
  // NOWHERE ELSE - above all never on the buzz screen, which stays 2D and instant (the decision
  // doc's first guardrail, held by diorama/motion-guardrails.gate.test.ts). avatar-chip.svelte
  // remains the representation for roster rows, score strips, and every list where more than
  // one avatar is on screen.
  //
  // THE ACCENT NOW LANDS ON THE CHARACTER. Until 2026-08-16 this component carried the accent
  // on its round BACKING and left the character in pack colors, because there is one walk sheet
  // per avatar rather than one per accent. Its own header called that an accepted trade. It was
  // not: this is the biggest thing on the character screen, so tapping a colour visibly
  // repainted the backdrop and not the avatar - the bug in docs/decisions/
  // 2026-08-16-persistent-layout-and-pregame-rework.md. Two layers fix it without baking a
  // single new byte:
  //   1. the STILL, `{id}--{accent}.webp`, which has always been baked per accent and is
  //      therefore correct in the very first paint, before any script runs; and
  //   2. the FILM, the walk sheet recoloured in the browser through the bake's own
  //      palette-recolor (sheet-recolor.ts), which replaces the still as soon as it resolves.
  // The backing keeps a quiet accent ring for continuity with avatar-chip.svelte, but it is no
  // longer where the colour lives.
  import { prefersReducedMotion } from "svelte/motion";
  import {
    avatarManifest,
    avatarSheetUrl,
    avatarSpriteUrl,
  } from "#lib/avatars/avatar-manifest.ts";
  import { recoloredImageUrl } from "#lib/avatars/sheet-recolor.ts";
  import type { AvatarAccent, AvatarEntry, AvatarSkinTone } from "#lib/avatars/avatar-manifest.ts";

  type Props = {
    avatar: AvatarEntry;
    accent: AvatarAccent;
    /** The human models' curated tone, or null for the pack's own colors. Ignored for pets. */
    skinTone?: AvatarSkinTone | null;
    /** CSS length for the round backing's diameter. */
    size?: string;
    /** One walk cycle in ms. ~900ms reads as an unhurried stroll across 10 frames. */
    cycleMs?: number;
  };
  let { avatar, accent, skinTone = null, size = "112px", cycleMs = 900 }: Props = $props();

  const frames = avatarManifest.sheet.frames;
  // Reduced motion freezes on frame 0 rather than hiding the avatar: the point of this
  // surface is "that one is me", which a still frame makes just as well (guardrail 2).
  const still = $derived(prefersReducedMotion.current);

  // The tone only ever applies to a human; a pet has no skin cells and asking for one would
  // just cost a canvas pass that changes nothing.
  const toneHex = $derived(avatar.kind === "human" ? (skinTone?.hex ?? null) : null);
  const stillUrl = $derived(avatarSpriteUrl(avatar, accent.id));
  const sheetUrl = $derived(avatarSheetUrl(avatar));

  // Null until (and unless) the browser produces a recoloured filmstrip. Kept as explicit
  // state rather than an awaited derivation so the still stays on screen the whole time the
  // recolor is in flight - the character must never blink out while changing colour.
  let filmUrl = $state<string | null>(null);
  $effect(() => {
    const request = { avatar, sourceUrl: sheetUrl, accentHex: accent.hex, toneHex };
    let current = true;
    filmUrl = null;
    void recoloredImageUrl(request).then((url) => {
      // The accent may have changed again while this one was decoding; last request wins.
      if (current) filmUrl = url;
    });
    return () => {
      current = false;
    };
  });

  // The film takes over only once it is recoloured. Falling back to the RAW sheet on failure
  // would put pack colors back on screen - the exact wrong answer for this component - so a
  // failed recolor stays on the accent-correct still instead. Motion is the thing worth losing
  // here; the colour is not.
  const showFilm = $derived(filmUrl !== null && !still);
</script>

<span
  class="avatar-animated"
  class:still
  style="--avatar-animated-size: {size}; --avatar-animated-accent: {accent.hex}; --avatar-animated-frames: {frames}; --avatar-animated-cycle: {cycleMs}ms"
  data-avatar-id={avatar.id}
  data-accent-id={accent.id}
  data-skin-tone-id={toneHex === null ? "" : (skinTone?.id ?? "")}
  data-frames={frames}
>
  <!-- The viewport is one frame wide; the strip inside it is `frames` frames wide and slides
       left by exactly one frame per step. Percentage transforms resolve against the STRIP's
       own width, so translateX(-100% / frames * k) is precisely k frames - no pixel math, and
       it stays exact at any rendered size. -->
  <span class="viewport">
    {#if showFilm}
      <img
        class="film"
        src={filmUrl}
        alt={avatar.displayName}
        draggable="false"
        decoding="async"
      />
    {:else}
      <!-- Server render, first paint, reduced motion, and any failed recolor all land here.
           It is the per-accent baked sprite, so the accent is right in every one of those
           cases even though nothing has walked yet. -->
      <img
        class="frame"
        src={stillUrl}
        alt={avatar.displayName}
        draggable="false"
        decoding="async"
      />
    {/if}
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
    /* The backing is a NEUTRAL surface now, not the accent carrier: the character itself wears
       the accent (see the header), and repeating it at full strength behind an accent-coloured
       body flattened the two together. The ring below keeps a thread of the accent so this
       still reads as the same object as the chip in the roster. */
    background: var(--surface-raised, #14141c);
    box-shadow: inset 0 0 0 max(1px, calc(var(--avatar-animated-size) / 24))
      color-mix(in oklab, var(--avatar-animated-accent) 60%, transparent);
  }

  .viewport {
    width: 88%;
    height: 88%;
    overflow: hidden;
    display: block;
  }

  .frame {
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
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
     the animation entirely is what guarantees frame 0. The still branch above means the film
     is not usually even mounted under reduced motion - this stays as the belt to that braces,
     because the rule is about the CSS being incapable of moving, not about who renders it. */
  .avatar-animated.still .film {
    animation: none;
    transform: translateX(0);
  }
</style>
