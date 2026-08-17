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
  import { crewPlateNameLimit, holdingAreaCopy } from "#lib/staging/staging-copy.ts";
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
  // The same words the 3D sign carries, from the same function - so a device without WebGL is
  // told exactly what a projector is told (staging-copy.ts).
  const holdingCopy = $derived(holdingAreaCopy(theme, waiting.length, stations.length));

  function crewOf(station: StagingStation): StagedOccupant[] {
    return station.memberIds
      .map((memberId) => byId.get(memberId))
      .filter((member) => member !== undefined);
  }
</script>

{#snippet stationContents(station: StagingStation)}
  <!-- The nameplate: the same string the 3D station carries over its mast. -->
  <span class="nameplate">{station.label}</span>
  {@const crew = crewOf(station)}
  <span class="hull">
    <span class="crew-chips">
      {#each crew.slice(0, crewPlateNameLimit) as member (member.entityId)}
        {@const avatar = avatarById(member.avatarId)}
        {#if avatar}
          <AvatarChip {avatar} accent={accentById(member.accentId)} size="26px" />
        {/if}
      {/each}
      {#if crew.length === 0}
        <span class="empty-crew">Nobody aboard yet</span>
      {/if}
    </span>
  </span>
  <!-- NAMES BENEATH THE BOAT (owner, 2026-08-16): the room has to be able to see who is
       aboard which. Capped by the SAME rule the 3D crew plate uses (staging-copy.ts) so the
       two views never disagree about who is listed, with the rest counted rather than cut
       silently - and each name ellipsised on its own, so one long nickname cannot push the
       others off the plate. -->
  <span class="crew-plate">
    {#each crew.slice(0, crewPlateNameLimit) as member (member.entityId)}
      <span class="crew-name" class:self={member.self === true}>
        {member.label}{#if member.leader === true}<span class="crown" title="Team leader"
            >leader</span
          >{/if}
      </span>
    {/each}
    {#if crew.length > crewPlateNameLimit}
      <span class="crew-overflow">+{crew.length - crewPlateNameLimit} more</span>
    {/if}
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

  <!-- THE HOLDING AREA AS A PLACE. Owner, 2026-08-16: "I don't understand still in the water."
       Being unassigned was drawn as a position in a band and nothing else. It now says what it
       is, what to do about it, and how many people are in it - and it has a drawn boundary, so
       the un-teamed read as one group standing somewhere rather than as leftovers. -->
  <section
    class="holding"
    class:surfaced={theme.holdingSurface !== null}
    aria-label={holdingCopy.title}
  >
    <header class="holding-header">
      <h3 class="holding-title">{holdingCopy.title}</h3>
      <p class="holding-hint">{holdingCopy.hint}</p>
      {#if holdingCopy.count.length > 0}
        <span class="holding-count">{holdingCopy.count}</span>
      {/if}
    </header>
    <span class="holding-noun">{theme.holdingAreaNoun}</span>
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

  /* Chips ride ON the hull, in a row that wraps - a crowded boat looks crowded, which is the
     same thing the 3D seat wrapping does. */
  .crew-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }

  .crew-overflow {
    font-family: var(--font-chrome);
    font-size: 0.7rem;
    color: var(--surface-text);
  }

  /* ...and the NAMES sit beneath it, which is the whole point: the room reads who is aboard
     which without having to recognise six avatars at projector distance. Long names ellipsis
     individually rather than pushing the others off the plate. */
  .crew-plate {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.5rem;
    font-size: 0.78rem;
    line-height: 1.25;
    color: var(--surface-text-muted);
  }

  .crew-name {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .crew-name.self,
  .waiting li.self .waiting-name {
    color: var(--accent);
    font-weight: 600;
  }

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

  /* THE BOUNDARY. A place has edges; the previous version was a band of slightly different
     background, which is why "in the water" read as "nowhere in particular". The inset border
     and the corner caption are what make the un-teamed look like a group standing somewhere. */
  .holding {
    position: relative;
    margin: 0 0.8rem 0.8rem;
    padding: 0.9rem 0.9rem 1rem;
    border: 2px solid var(--surface-border);
    border-radius: 0.9rem;
    background: var(--surface-raised);
  }

  /* When the theme draws a surface, so does this: the holding area gets the theme's water
     colour and a wave edge, so "in the water" survives the loss of the renderer. */
  .holding.surfaced {
    border-color: color-mix(in srgb, var(--board-category-bg) 55%, var(--surface-text));
    background:
      radial-gradient(
          1.1rem 0.55rem at 0.9rem 0,
          transparent 0 0.5rem,
          var(--board-category-bg) 0.5rem
        )
        0 0 / 1.8rem 0.6rem repeat-x,
      linear-gradient(var(--board-category-bg), color-mix(in srgb, var(--board-category-bg) 78%, var(--surface-page)));
    padding-top: 1.2rem;
  }

  .holding-header {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.3rem 0.6rem;
    margin-bottom: 0.5rem;
  }

  .holding-title {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.95rem;
    color: var(--surface-text);
    margin: 0;
  }

  .holding-hint {
    margin: 0;
    font-size: 0.8rem;
    color: var(--accent);
  }

  .holding-count {
    margin-left: auto;
    font-family: var(--font-chrome);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--surface-text-muted);
    border: 1px solid var(--surface-border);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
  }

  /* The theme's own noun, small, on the boundary - "the water" / "the clearing" names the
     place without competing with the instruction. */
  .holding-noun {
    position: absolute;
    top: -0.55rem;
    left: 0.9rem;
    padding: 0 0.35rem;
    background: var(--surface-page);
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.6rem;
    color: var(--surface-text-muted);
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
