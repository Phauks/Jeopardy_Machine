<script lang="ts">
  // The staged lobby, whichever way this device can show it. One component so no screen ever
  // has to know which one it got.
  //
  // The choice is not "3D or nothing". The diorama is decoration and may vanish, but staging
  // carries an ANSWER - which boat am I on - and the answer has to survive a browser with no
  // WebGL, a locked-down projector laptop, and server-side rendering. So:
  //
  //   WebGL up      -> the live scene, and the 2D layout is not rendered at all
  //   no WebGL, SSR -> the 2D staged view: stations in their team colours over a water band
  //   environment   -> "none" is the deliberate clean-2D setting and takes the same path
  //
  // The 2D view renders FIRST and is replaced once the scene reports itself ready, so there is
  // no frame where the screen says nothing while a 686 KB chunk is fetched.
  import AvatarDiorama from "#lib/diorama/avatar-diorama.svelte";
  import StagedLobby2d from "#lib/staging/staged-lobby-2d.svelte";
  import type { DioramaEnvironment } from "#lib/diorama/diorama-environment.ts";
  import type { DioramaOccupant } from "#lib/diorama/diorama-scene.ts";
  import type { StagedOccupant } from "#lib/staging/staged-lobby-2d.svelte";
  import type { StagingStation } from "#lib/staging/staging-layout.ts";
  import type { StagingTheme } from "#lib/staging/staging-theme.ts";

  type Props = {
    theme: StagingTheme;
    stations: readonly StagingStation[];
    /** Everyone on the stage. The 3D view reads avatar + accent; the 2D view also reads names. */
    occupants: readonly StagedOccupant[];
    waitingEntityIds: readonly string[];
    environment?: DioramaEnvironment;
    celebratingEntityIds?: readonly string[];
    beat?: { entityId: string; at: number } | null;
    themeKey?: string;
    seed?: number;
    /** Boarding, when the surface offers it (the team screen does; the display does not). */
    onSelectStation?: ((stationId: string) => void) | null;
    selectedStationId?: string | null;
  };
  let {
    theme,
    stations,
    occupants,
    waitingEntityIds,
    environment = "studio",
    celebratingEntityIds = [],
    beat = null,
    themeKey = "default",
    seed = 1,
    onSelectStation = null,
    selectedStationId = null,
  }: Props = $props();

  // Starts false so SSR and the pre-hydration paint both render the 2D staged view - which is
  // also what a browser that will never have WebGL keeps.
  let sceneReady = $state(false);

  const dioramaOccupants: DioramaOccupant[] = $derived(
    occupants.map((occupant) => ({
      entityId: occupant.entityId,
      avatarId: occupant.avatarId,
      accentId: occupant.accentId,
      // The name travels into the scene for the crew plates under the stations - the 3D half
      // of "names beneath the boats" (owner, 2026-08-16). The free-roaming diorama ignores it.
      label: occupant.label,
    })),
  );
  const staging = $derived({ theme, stations, waitingEntityIds });
</script>

<div class="staged-lobby-host">
  {#if environment !== "none"}
    <div class="scene-layer" class:live={sceneReady}>
      <AvatarDiorama
        occupants={dioramaOccupants}
        {staging}
        {environment}
        {celebratingEntityIds}
        {beat}
        {themeKey}
        {seed}
        onAvailability={(available) => {
          sceneReady = available;
        }}
      />
    </div>
  {/if}
  {#if !sceneReady}
    <StagedLobby2d
      {theme}
      {stations}
      {occupants}
      {waitingEntityIds}
      {onSelectStation}
      {selectedStationId}
    />
  {/if}
</div>

<style>
  .staged-lobby-host {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  /* Zero-height until the scene is live, so the 2D view below it owns the box in the
     meantime and there is never a reserved gap for a canvas that may never appear. */
  .scene-layer {
    width: 100%;
    height: 0;
    overflow: hidden;
  }

  .scene-layer.live {
    height: 100%;
    min-height: inherit;
  }
</style>
