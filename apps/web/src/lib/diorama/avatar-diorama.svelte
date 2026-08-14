<script lang="ts">
  // The diorama's mount point: a canvas, a WebGL check, and a DYNAMIC import of the scene.
  //
  // The import is the whole point of this file existing separately. Everything three.js lives
  // behind `await import("./diorama-scene.ts")`, so Vite emits it as its own chunk and no
  // other route - above all no phone - ever downloads a renderer. Static-importing the scene
  // here would silently undo that, which is why the check is stated in
  // docs/design/surfaces.md as a size expectation and not just a convention.
  //
  // Everything about this component is failure-tolerant by design: no WebGL, a canvas that
  // never gets a size, a model that 404s - each of those leaves the surrounding 2D screen
  // exactly as it was. The diorama is decoration, never a dependency of play (guardrail 3 of
  // docs/decisions/2026-08-14-avatars-in-motion.md).
  import { prefersReducedMotion } from "svelte/motion";
  import { supportsWebGl, readDioramaPalette } from "#lib/diorama/diorama-environment.ts";
  import type { DioramaEnvironment } from "#lib/diorama/diorama-environment.ts";
  import type { DioramaOccupant, DioramaScene } from "#lib/diorama/diorama-scene.ts";

  type Props = {
    /** Who is in the room right now. Reconciled on every change; existing avatars stay put. */
    occupants: readonly DioramaOccupant[];
    /** "none" renders nothing at all - the clean 2D lobby, per the environments direction. */
    environment?: DioramaEnvironment;
    /** Entities celebrating outright (the winner screen). */
    celebratingEntityIds?: readonly string[];
    /**
     * Bumped by the caller to fire a visible beat: `{ entityId, at }`. A counter rather than a
     * callback registration so the display can drive it from the room event stream without
     * this component reaching into the store.
     */
    beat?: { entityId: string; at: number } | null;
    /**
     * Changes whenever the surrounding theme does. The stage's colors are read from CSS
     * custom properties, which nothing notifies us about - so the caller, who does know when
     * it swapped presets, names the current one and the scene restyles.
     */
    themeKey?: string;
    /** Fixed layout seed - a reopened display arranges the same room the same way. */
    seed?: number;
  };
  let {
    occupants,
    environment = "studio",
    celebratingEntityIds = [],
    beat = null,
    themeKey = "default",
    seed = 1,
  }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let scene = $state<DioramaScene | null>(null);
  // Resolved once on mount: SSR has no WebGL and must not claim otherwise, and a browser that
  // cannot make a context should render nothing rather than an empty black box.
  let available = $state(false);

  $effect(() => {
    if (environment === "none") return;
    const hostElement = host;
    const canvasElement = canvas;
    if (hostElement === null || canvasElement === null) return;
    if (!supportsWebGl()) return;

    let created: DioramaScene | null = null;
    let cancelled = false;
    const palette = readDioramaPalette(hostElement);
    void import("#lib/diorama/diorama-scene.ts").then(({ DioramaScene: SceneClass }) => {
      if (cancelled) return;
      created = new SceneClass({
        canvas: canvasElement,
        palette,
        reducedMotion: prefersReducedMotion.current,
        seed,
      });
      created.resize(hostElement.clientWidth, hostElement.clientHeight);
      created.start();
      scene = created;
      available = true;
    });

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) created?.resize(box.width, box.height);
    });
    observer.observe(hostElement);

    return () => {
      cancelled = true;
      observer.disconnect();
      created?.dispose();
      created = null;
      scene = null;
      available = false;
    };
  });

  // Roster, celebration, and reduced motion are pushed into the scene as they change; each is
  // its own effect so a roster update does not restart a celebration and vice versa.
  $effect(() => {
    scene?.setOccupants(occupants);
  });
  $effect(() => {
    scene?.setCelebrating(celebratingEntityIds);
  });
  $effect(() => {
    scene?.setReducedMotion(prefersReducedMotion.current);
  });
  $effect(() => {
    // themeKey is read for its dependency, not its value: the colors themselves come from the
    // host element's resolved custom properties, which have already changed by now.
    void themeKey;
    const hostElement = host;
    if (scene !== null && hostElement !== null) scene.setPalette(readDioramaPalette(hostElement));
  });
  $effect(() => {
    if (beat !== null) scene?.pulse(beat.entityId);
  });
</script>

{#if environment !== "none"}
  <!-- aria-hidden: this is scenery. Every name, score, and connection state it could convey is
       already on the roster and score strip in accessible text, and a canvas of wandering
       avatars announced to a screen reader would be noise on a projector nobody navigates. -->
  <div class="diorama" bind:this={host} class:ready={available} aria-hidden="true">
    <canvas bind:this={canvas}></canvas>
  </div>
{/if}

<style>
  .diorama {
    position: relative;
    width: 100%;
    height: 100%;
    /* Until the scene reports itself ready the canvas is invisible, so a display that cannot
       run WebGL (or is still fetching the chunk) shows the 2D screen unchanged rather than a
       black rectangle that fades in late. */
    opacity: 0;
    transition: opacity 400ms ease;
  }

  .diorama.ready {
    opacity: 1;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
