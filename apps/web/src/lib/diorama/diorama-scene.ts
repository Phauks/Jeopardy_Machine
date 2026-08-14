// The live 3D room: one Kenney model per joined player, wandering a themed stage.
//
// THIS FILE IS THE ONLY THING IN apps/web THAT IMPORTS three.js, and it is only ever reached
// through the dynamic import in avatar-diorama.svelte. That is what keeps three out of every
// other route's bundle - a phone that joins a room must never download a renderer
// (docs/decisions/2026-08-14-avatars-in-motion.md, and the bundle check in
// docs/design/surfaces.md).
//
// The division of labour: wander.ts decides where everyone is and what they are doing, in
// plain numbers; this file copies that onto Object3Ds, crossfades clips, and draws. Nothing
// here makes a movement decision, so the interesting logic stays testable without a GPU.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";
import { avatarModelById, avatarModelUrl } from "#lib/avatars/avatar-models.ts";
import { recolorPixels } from "#lib/avatars/palette-recolor.ts";
import type { AvatarModel } from "#lib/avatars/avatar-models.ts";
import type { DioramaPalette } from "#lib/diorama/diorama-environment.ts";
import {
  boundsForAspect,
  clampToBounds,
  maxDioramaAvatars,
  seededRandom,
  spawnAgent,
  startBeat,
  stepAgent,
} from "#lib/diorama/wander.ts";
import type { RandomSource, WanderAgent, WanderMode } from "#lib/diorama/wander.ts";

/** One occupant of the diorama, as the display describes it. */
export type DioramaOccupant = {
  /** Scoring entity id - what buzz and winner events name. */
  entityId: string;
  /** Manifest avatar id; an unknown or null id falls back to the first avatar in the roster. */
  avatarId: string | null;
  /** Accent palette id; drives the runtime recolor. */
  accentId: string | null;
};

export type DioramaOptions = {
  canvas: HTMLCanvasElement;
  palette: DioramaPalette;
  /** Reduced motion: nobody wanders, everybody stands (guardrail 2). */
  reducedMotion: boolean;
  /** Fixed seed so the same room lays out the same way on a reopened display. */
  seed: number;
};

/**
 * Every avatar is scaled to this height in world units, whichever pack it came from - packs
 * disagree wildly (a Cube Pet is authored 1.4 units, a Mini Character 0.79). Camera framing
 * and the wander pen in wander.ts are both tuned against it: a full 24-avatar room has to fit
 * across the frame without becoming a huddle, and one avatar still has to read from the back
 * of a room. Changing this means re-checking both.
 */
const standingHeight = 0.8;
/** How long a buzz beat lasts before the avatar goes back to strolling. */
const beatSeconds = 2.2;
/** Crossfade between clips - short enough to read as a reaction, long enough not to pop. */
const clipFadeSeconds = 0.25;

type Instance = {
  agent: WanderAgent;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<WanderMode, THREE.AnimationAction | null>;
  current: WanderMode | null;
};

/** A loaded model, kept once per avatar id and cloned per instance. */
type LoadedModel = {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  model: AvatarModel;
};

/**
 * Clone a loaded model and dress the clone in a recolored colormap.
 *
 * SkeletonUtils.clone, NOT Object3D.clone. Object3D.clone copies a SkinnedMesh but leaves it
 * bound to the ORIGINAL skeleton, so every human clone deforms with - and renders at - the
 * shared source model's bones: a lobby of twelve people becomes one T-posed figure at the
 * world origin with a dozen wheelchairs drifting around it. (Observed exactly that, 2026-08-14,
 * on the display route; the pets were fine because Cube Pets animate plain nodes, not skins.)
 *
 * The texture swap is the exact move the bake's render page makes
 * (tools/avatar-bake/src/render-page.html, applyColormap), and deliberately so: CLONE the
 * pack's own texture and swap only its image, rather than building a texture from scratch. The
 * clone inherits flipY, wrapping, filtering, color space, and any KHR_texture_transform the
 * pack applied - every one of which a hand-rolled CanvasTexture gets wrong in a different way.
 */
function cloneWithColormap(
  scene: THREE.Object3D,
  colormap: HTMLCanvasElement | null,
): THREE.Object3D {
  const root = cloneSkinned(scene);
  if (colormap === null) return root;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.material as THREE.MeshStandardMaterial;
    if (source.map === null) return;
    const material = source.clone();
    const texture = source.map.clone();
    texture.image = colormap;
    texture.needsUpdate = true;
    material.map = texture;
    object.material = material;
  });
  return root;
}

export class DioramaScene {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene: THREE.Scene;
  readonly #camera: THREE.PerspectiveCamera;
  readonly #crowd = new THREE.Group();
  readonly #loader = new GLTFLoader();
  readonly #modelCache = new Map<string, Promise<LoadedModel>>();
  /** avatar+accent -> the recolored palette image both its meshes sample. */
  readonly #colormapCanvasCache = new Map<string, Promise<HTMLCanvasElement | null>>();
  readonly #colormapCache = new Map<string, Promise<HTMLImageElement>>();
  readonly #instances = new Map<string, Instance>();
  readonly #clock = new THREE.Clock();
  readonly #random: RandomSource;
  #celebrating: ReadonlySet<string> = new Set();
  #reducedMotion: boolean;
  #frameHandle: number | null = null;
  #disposed = false;
  /** Themed stage pieces, kept so setPalette can restyle without rebuilding the scene. */
  #ground: THREE.Mesh | null = null;
  #rim: THREE.DirectionalLight | null = null;
  /** Next free slot on the spawn grid; only ever moves forward as players arrive. */
  #nextSlotIndex = 0;
  /** The pen, re-derived from the canvas aspect on every resize (wander.ts explains why). */
  #bounds = boundsForAspect(16 / 9);
  /** Occupants requested while their model was still loading - applied when it arrives. */
  #pendingOccupants: DioramaOccupant[] = [];

  constructor(options: DioramaOptions) {
    this.#random = seededRandom(options.seed);
    this.#reducedMotion = options.reducedMotion;

    this.#renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: true,
    });
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Cap at 2: a 4K projector at devicePixelRatio 3 would quadruple the fill cost of what is
    // decoration sharing a machine with the board.
    this.#renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));

    this.#scene = new THREE.Scene();
    this.#camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    // A low, slightly raised eye line looking at the middle of the pen: the avatars read as
    // standing in a room with you rather than as figures on a map. 8.7 units back puts the
    // pen's NEAR edge 5.9 away, which is where wander.ts's nearVisibleHalfHeight comes from -
    // change one and the other needs re-deriving.
    this.#camera.position.set(0, 1.6, 8.7);
    this.#camera.lookAt(0, 0.45, 0);
    this.#scene.add(this.#crowd);
    this.#buildStage(options.palette);
  }

  /** Ground, backdrop, and lights. Geometry is built once; colors come from setPalette. */
  #buildStage(palette: DioramaPalette): void {
    // Fog dissolves the far edge of the stage into the display's own background, so the
    // diorama has no visible seam against the 2D chrome around it. Its color is a token too.
    this.#scene.fog = new THREE.Fog(0x000000, 8, 17);

    // Ground only - there is deliberately NO backdrop wall. The renderer has an alpha buffer,
    // so everything above the horizon is transparent and the display's own themed page
    // background IS the sky: no seam, no second gradient to keep in sync, and the diorama
    // costs nothing to fill up there. The ground then fogs into that same page color.
    this.#ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshLambertMaterial());
    this.#ground.rotation.x = -Math.PI / 2;
    this.#ground.position.y = -0.001;
    this.#scene.add(this.#ground);

    // The still-sprite lighting recipe (tools/avatar-bake/src/render-page.html), one rig for
    // both tiers: strong ambient keeps the flat low-poly style saturated, key and fill give
    // form, and the rim is tinted by the theme accent so the room's color reaches the lighting.
    this.#scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2.5, 4, 3);
    this.#scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-3, 1.5, 2);
    this.#scene.add(fill);
    this.#rim = new THREE.DirectionalLight(0xffffff, 0.55);
    this.#rim.position.set(0, 3, -4);
    this.#scene.add(this.#rim);
    this.setPalette(palette);
  }

  /**
   * Restyle the stage from the active theme. Separate from construction because a theme can
   * change under a live scene (the /dev/diorama preview switches presets; a display could
   * later too) - and tearing down a running diorama to change a floor color would re-spawn
   * the whole crowd.
   */
  setPalette(palette: DioramaPalette): void {
    this.#scene.fog?.color.set(palette.backdrop);
    (this.#ground?.material as THREE.MeshLambertMaterial | undefined)?.color.set(palette.ground);
    this.#rim?.color.set(palette.accent);
  }

  /** Match the drawing buffer to the element's box. Called from a ResizeObserver. */
  resize(width: number, height: number): void {
    if (this.#disposed || width === 0 || height === 0) return;
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    // The pen follows the frame: a letterbox band under a title card sees far more world
    // width than a 16:9 projector does, and the crowd should use it rather than huddle in the
    // middle third. Existing agents are only clamped, never re-placed - a window resize must
    // not scatter a room that is already standing there.
    this.#bounds = boundsForAspect(this.#camera.aspect);
    for (const instance of this.#instances.values()) {
      instance.agent = clampToBounds(instance.agent, this.#bounds);
    }
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.#reducedMotion = reducedMotion;
  }

  /** The winner screen: these entities stand and celebrate until told otherwise. */
  setCelebrating(entityIds: readonly string[]): void {
    this.#celebrating = new Set(entityIds);
  }

  /**
   * A visible beat for one entity - the buzz reaction. Turn to camera, play the celebrate
   * clip, then rejoin the stroll. A no-op for an entity that is not in the diorama (a buzz
   * during a live clue, when the diorama is not even mounted, lands here harmlessly).
   */
  pulse(entityId: string): void {
    const instance = this.#instances.get(entityId);
    if (instance === undefined) return;
    instance.agent = startBeat(instance.agent, this.#clock.getElapsedTime(), beatSeconds);
  }

  /**
   * Reconcile the crowd with the room roster: add arrivals, drop departures, leave everyone
   * else exactly where they are (a join must never teleport the avatars already strolling).
   */
  setOccupants(occupants: readonly DioramaOccupant[]): void {
    if (this.#disposed) return;
    const shown = occupants.slice(0, maxDioramaAvatars);
    const wanted = new Set(shown.map((occupant) => occupant.entityId));
    for (const [entityId, instance] of this.#instances) {
      if (wanted.has(entityId)) continue;
      this.#crowd.remove(instance.root);
      this.#instances.delete(entityId);
    }
    this.#pendingOccupants = shown.filter((occupant) => !this.#instances.has(occupant.entityId));
    for (const occupant of this.#pendingOccupants) {
      void this.#addOccupant(occupant);
    }
  }

  async #addOccupant(occupant: DioramaOccupant): Promise<void> {
    // A roster entry with no avatar (or one this build does not ship) falls back to the first
    // avatar rather than leaving a gap in the crowd - the same tolerance the chips have.
    const fallbackId = avatarManifest.avatars[0]?.id ?? "";
    const spec = avatarModelById(occupant.avatarId ?? fallbackId) ?? avatarModelById(fallbackId);
    if (spec === null) return;
    // Model and recolored palette together: an avatar is never added to the scene half
    // dressed, so there is no frame where it renders in the wrong colors.
    const [model, colormap] = await Promise.all([
      this.#loadModel(spec),
      this.#recoloredColormap(spec, occupant.accentId),
    ]);
    // Between the await and here the display may have moved on (a phase change unmounted us,
    // or the player left); both are ordinary, so check before touching the scene.
    if (this.#disposed) return;
    if (!this.#pendingOccupants.some((pending) => pending.entityId === occupant.entityId)) return;
    if (this.#instances.has(occupant.entityId)) return;

    const root = cloneWithColormap(model.scene, colormap);
    // Arrivals take the next free slot on the fixed spawn grid, so a join never disturbs
    // anyone already on stage and no two arrivals land on the same spot.
    const placed = spawnAgent(occupant.entityId, this.#nextSlotIndex, this.#bounds, this.#random);
    this.#nextSlotIndex += 1;
    const mixer = new THREE.AnimationMixer(root);
    const actionFor = (clipName: string): THREE.AnimationAction | null => {
      const clip = model.animations.find((candidate) => candidate.name === clipName);
      return clip === undefined ? null : mixer.clipAction(clip);
    };
    const instance: Instance = {
      agent: placed,
      root,
      mixer,
      actions: {
        idle: actionFor(spec.clips.idle),
        walk: actionFor(spec.clips.walk),
        celebrate: actionFor(spec.clips.celebrate),
      },
      current: null,
    };
    this.#crowd.add(root);
    this.#instances.set(occupant.entityId, instance);
    this.#playMode(instance, placed.mode);
  }

  /** Load a GLB (plus its props) once per avatar; instances clone it. */
  #loadModel(model: AvatarModel): Promise<LoadedModel> {
    const cached = this.#modelCache.get(model.id);
    if (cached !== undefined) return cached;
    const loading = (async (): Promise<LoadedModel> => {
      // Character and props in parallel: a lobby fills up all at once, and Ada's wheelchair
      // arriving a round trip after Ada would be visible.
      const [gltf, ...props] = await Promise.all([
        this.#loader.loadAsync(avatarModelUrl(model.file)),
        ...model.props.map((prop) => this.#loader.loadAsync(avatarModelUrl(prop))),
      ]);
      const inner = new THREE.Group();
      inner.add(gltf.scene);
      // Props composite at the shared origin - the pack authors them that way, which is what
      // makes the wheelchair line up for free (tools/avatar-bake/src/render-page.html).
      for (const prop of props) inner.add(prop.scene);
      // The two packs are authored at different scales - a Cube Pet stands 1.4 units, a Mini
      // Character 0.79 - so without this a dog would tower over a person. Normalising to a
      // common height on an OUTER group leaves the skinned meshes and their bind poses
      // untouched; only the wrapper is scaled.
      const group = new THREE.Group();
      group.add(inner);
      const box = new THREE.Box3().setFromObject(inner);
      const height = box.max.y - box.min.y;
      if (height > 0) inner.scale.setScalar(standingHeight / height);
      // Stand them ON the floor whatever the pack's origin convention is.
      inner.position.y = -box.min.y * inner.scale.y;
      return { scene: group, animations: gltf.animations, model };
    })();
    this.#modelCache.set(model.id, loading);
    return loading;
  }

  /**
   * The accent-recolored palette image for one (avatar, accent) pair, as a canvas ready to be
   * a texture. Cached, because a room of 24 is usually a handful of distinct pairs.
   *
   * The pixels go through the SAME palette-recolor.ts the sprite bake used, with the SAME
   * targets and tolerance carried in the manifest - which is what guarantees a player's chip
   * and their model are the same color (docs/decisions/2026-08-14-avatars-in-motion.md,
   * point 4). Resolved BEFORE the avatar enters the scene: an empty texture filled in later
   * needs three to re-upload a resized canvas, which is both fragile and briefly ugly.
   */
  #recoloredColormap(
    model: AvatarModel,
    accentId: string | null,
  ): Promise<HTMLCanvasElement | null> {
    const accent = avatarManifest.accents.find((candidate) => candidate.id === accentId);
    if (accent === undefined) return Promise.resolve(null);
    const cacheKey = `${model.colormap}:${model.id}:${accent.id}`;
    const cached = this.#colormapCanvasCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const building = this.#loadColormap(model.colormap).then((image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) return null;
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      recolorPixels(imageData.data, model.recolorTargets, accent.hex, model.tolerance ?? undefined);
      context.putImageData(imageData, 0, 0);
      return canvas;
    });
    this.#colormapCanvasCache.set(cacheKey, building);
    return building;
  }

  #loadColormap(fileName: string): Promise<HTMLImageElement> {
    const cached = this.#colormapCache.get(fileName);
    if (cached !== undefined) return cached;
    const loading = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => {
        resolve(image);
      });
      image.addEventListener("error", () => {
        reject(new Error(`avatar colormap failed to load: ${fileName}`));
      });
      image.src = avatarModelUrl(fileName);
    });
    this.#colormapCache.set(fileName, loading);
    return loading;
  }

  #playMode(instance: Instance, mode: WanderMode): void {
    if (instance.current === mode) return;
    const next = instance.actions[mode] ?? instance.actions.idle;
    if (next === null) return;
    const previous = instance.current === null ? null : instance.actions[instance.current];
    next.reset().fadeIn(clipFadeSeconds).play();
    previous?.fadeOut(clipFadeSeconds);
    instance.current = mode;
  }

  start(): void {
    if (this.#disposed || this.#frameHandle !== null) return;
    this.#clock.start();
    const frame = (): void => {
      if (this.#disposed) return;
      this.#frameHandle = requestAnimationFrame(frame);
      this.#tick();
    };
    this.#frameHandle = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.#frameHandle !== null) cancelAnimationFrame(this.#frameHandle);
    this.#frameHandle = null;
  }

  #tick(): void {
    // Clamped delta: a display tabbed away for a minute must not teleport the whole crowd
    // across the pen on the frame it comes back.
    const delta = Math.min(0.1, this.#clock.getDelta());
    const now = this.#clock.getElapsedTime();
    const options = { frozen: this.#reducedMotion, celebratingEntityIds: this.#celebrating };
    for (const instance of this.#instances.values()) {
      instance.agent = stepAgent(instance.agent, delta, now, this.#bounds, this.#random, options);
      instance.root.position.set(instance.agent.x, 0, instance.agent.z);
      instance.root.rotation.y = instance.agent.heading;
      this.#playMode(instance, instance.agent.mode);
      instance.mixer.update(delta);
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  /**
   * Tear the scene down. A display route that changes phase does this on every unmount, so
   * GPU resources have to actually go back - geometries and materials (with their per-clone
   * textures) are walked explicitly, because three frees none of that on its own.
   */
  dispose(): void {
    this.stop();
    this.#disposed = true;
    this.#instances.clear();
    this.#modelCache.clear();
    this.#colormapCache.clear();
    this.#colormapCanvasCache.clear();
    this.#scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      }
    });
    this.#renderer.dispose();
  }
}
