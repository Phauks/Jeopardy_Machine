<script lang="ts">
  // The staged lobby WITHOUT WebGL - and the reason it is a real screen rather than a blank
  // rectangle. The 3D diorama is decoration and degrades to nothing (guardrail 3 of
  // docs/decisions/2026-08-14-avatars-in-motion.md), but STAGING is not decoration: "am I in
  // the water or on a boat" is the answer to the question the pre-game screens are asking. So
  // the layout survives the loss of the renderer even though the scenery does not.
  //
  // It is the same information in CSS: stations along the top, each in its team's colour with
  // its nameplate and its crew aboard; the holding area as a band beneath them, and it looks
  // like water when the theme says water. Rendered by SSR too, so a phone sees the staged
  // lobby before any JavaScript has decided whether the device can run three.
  import AvatarChip from "#lib/avatars/avatar-chip.svelte";
  import { accentById, avatarById } from "#lib/avatars/avatar-manifest.ts";
  import type { StagingStation } from "#lib/staging/staging-layout.ts";
  import type { StagingTheme } from "#lib/staging/staging-theme.ts";

  /** One person on the stage, as the 2D view needs them (the 3D view needs less). */
  export type StagedOccupant = {
    entityId: string;
    label: string;
    avatarId: string | null;
    accentId: string | null;
    /** Draws the crown on a station's leader. */
    leader?: boolean;
    /** Highlights the viewer's own chip - "that one is me" is the whole point. */
    self?: boolean;
  };

  type Props = {
    theme: StagingTheme;
    stations: readonly StagingStation[];
    occupants: readonly StagedOccupant[];
    waitingEntityIds: readonly string[];
    /** Tapping a station is how you board it, when the surface allows boarding. */
    onSelectStation?: ((stationId: string) => void) | null;
    /** The station the viewer is aboard, so it can be marked without a store lookup. */
    selectedStationId?: string | null;
  };
  let {
    theme,
    stations,
    occupants,
    waitingEntityIds,
    onSelectStation = null,
    selectedStationId = null,
  }: Props = $props();

  const byId = $derived(new Map(occupants.map((occupant) => [occupant.entityId, occupant])));
  const waiting = $derived(
    waitingEntityIds
      .map((entityId) => byId.get(entityId))
      .filter((occupant) => occupant !== undefined),
  );
</script>

{#snippet stationContents(station: StagingStation)}
  <!-- The nameplate: the same string the 3D station carries over its mast. -->
  <span class="nameplate">{station.label}</span>
  <span class="hull">
    <span class="crew">
      {#each station.memberIds as memberId (memberId)}
        {@const member = byId.get(memberId)}
        {#if member !== undefined}
          {@const avatar = avatarById(member.avatarId)}
          <span class="crew-member" class:self={member.self === true}>
            {#if avatar}
              <AvatarChip {avatar} accent={accentById(member.accentId)} size="28px" />
            {/if}
            <span class="crew-name">{member.label}</span>
            {#if member.leader === true}
              <span class="crown" title="Team leader">leader</span>
            {/if}
          </span>
        {/if}
      {/each}
      {#if station.memberIds.length === 0}
        <span class="empty-crew">Nobody aboard yet</span>
      {/if}
    </span>
  </span>
  <span class="station-noun">{theme.stationNoun}</span>
{/snippet}

<div class="staged-lobby" data-staging-theme={theme.id}>
  <ul class="stations">
    {#each stations as station (station.stationId)}
      <li>
        <!-- Two real elements rather than a <svelte:element>: a station is a BUTTON where you
             can board and a plain block where you cannot, and a button is the only honest
             markup for something a keyboard must be able to activate. -->
        {#if onSelectStation === null}
          <div
            class="station"
            class:selected={station.stationId === selectedStationId}
            style="--station-color: {station.colorHex}"
          >
            {@render stationContents(station)}
          </div>
        {:else}
          <button
            type="button"
            class="station"
            class:selected={station.stationId === selectedStationId}
            style="--station-color: {station.colorHex}"
            aria-pressed={station.stationId === selectedStationId}
            onclick={() => {
              onSelectStation(station.stationId);
            }}
          >
            {@render stationContents(station)}
          </button>
        {/if}
      </li>
    {/each}
    {#if stations.length === 0}
      <li class="no-stations">
        No {theme.stationNoun}s yet - the first one is made by whoever creates a team.
      </li>
    {/if}
  </ul>

  <section class="holding" class:surfaced={theme.holdingSurface !== null}>
    <h3 class="holding-label">{theme.holdingAreaNoun}</h3>
    <ul class="waiting">
      {#each waiting as occupant (occupant.entityId)}
        {@const avatar = avatarById(occupant.avatarId)}
        <li class:self={occupant.self === true}>
          {#if avatar}
            <AvatarChip {avatar} accent={accentById(occupant.accentId)} size="28px" />
          {/if}
          <span class="waiting-name">{occupant.label}</span>
        </li>
      {/each}
      {#if waiting.length === 0}
        <li class="empty-waiting">Everybody has picked a team</li>
      {/if}
    </ul>
  </section>
</div>

<style>
  .staged-lobby {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-radius: calc(var(--board-radius) + 4px);
    overflow: hidden;
    border: 1px solid var(--surface-border);
  }

  .stations {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.6rem;
    list-style: none;
    margin: 0;
    padding: 0.8rem;
    background: var(--surface-page);
  }

  .station {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.3rem;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    color: var(--surface-text);
    text-align: left;
    cursor: inherit;
  }

  /* A button station is tappable; a div station is a picture. */
  button.station {
    cursor: pointer;
  }

  .nameplate {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.8rem;
    color: var(--station-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The hull IS the team colour - the same rule the 3D station follows, so the two views can
     never disagree about which colour belongs to whom. */
  .hull {
    display: block;
    padding: 0.5rem;
    border-radius: 0.6rem 0.6rem 1.4rem 1.4rem;
    background: color-mix(in srgb, var(--station-color) 26%, var(--surface-raised));
    border: 2px solid var(--station-color);
    min-height: 3.4rem;
  }

  .station.selected .hull {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--station-color) 60%, transparent);
  }

  .crew {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .crew-member {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
  }

  .crew-member.self .crew-name,
  .waiting li.self .waiting-name {
    color: var(--accent);
    font-weight: 600;
  }

  .crew-name,
  .waiting-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .crown {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--board-value-color);
    border: 1px solid currentColor;
    border-radius: var(--board-radius);
    padding: 0 0.25rem;
  }

  .empty-crew,
  .empty-waiting,
  .no-stations {
    font-size: 0.78rem;
    color: var(--surface-text-muted);
  }

  .no-stations {
    grid-column: 1 / -1;
    text-align: center;
    padding: 1rem;
  }

  .station-noun {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.6rem;
    color: var(--surface-text-muted);
  }

  .holding {
    padding: 0.7rem 0.8rem 0.9rem;
    background: var(--surface-raised);
  }

  /* When the theme draws a surface, so does this: the holding area gets the theme's water
     colour and a wave edge, so "in the water" survives the loss of the renderer. */
  .holding.surfaced {
    background:
      radial-gradient(
          1.1rem 0.55rem at 0.9rem 0,
          transparent 0 0.5rem,
          var(--board-category-bg) 0.5rem
        )
        0 0 / 1.8rem 0.6rem repeat-x,
      linear-gradient(var(--board-category-bg), color-mix(in srgb, var(--board-category-bg) 78%, var(--surface-page)));
    padding-top: 1.1rem;
  }

  .holding-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.65rem;
    color: var(--surface-text-muted);
    margin: 0 0 0.4rem;
  }

  .waiting {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .waiting li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
  }

  button.station:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
</style>
