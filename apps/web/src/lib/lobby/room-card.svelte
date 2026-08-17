<script lang="ts">
  // One room in the browser. The two strings at the top are DIFFERENT THINGS and are typed
  // differently on purpose: the TITLE is what the game is called ("Board Game Club Quiz"), the
  // HOST LABEL is who is running it ("Environmental Law Society"). Collapsing them - which the
  // first lobby list did, by rendering the host as a grey continuation of the title line - is
  // what makes a server browser unreadable at a glance.
  //
  // Picking a locked room reveals the password field INSIDE this card rather than opening a
  // dialog: the password is a shared room secret, the room it belongs to is the thing you just
  // tapped, and a modal that forgets which room it is about is a classic lobby bug.
  import { formatRoomAge, formatRoomPhase } from "#lib/lobby/room-age.ts";
  import { playerSeats, roomUnavailableReason, spectatorSeats } from "#lib/lobby/room-capacity.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { RoomSummary } from "@jeopardy/protocol/room/registry";

  type Props = {
    room: RoomSummary;
    /** Server stamp of the listing, so ages are measured against the data's clock. */
    fetchedAt: number;
    /** The code box has a complete code: the list steps back rather than competing for a tap. */
    dimmed?: boolean;
    /** True while this card is the one asking for a password. */
    expanded?: boolean;
    onSelect: (room: RoomSummary, password: string) => void;
    onExpand: (room: RoomSummary) => void;
    onCollapse: () => void;
  };
  let {
    room,
    fetchedAt,
    dimmed = false,
    expanded = false,
    onSelect,
    onExpand,
    onCollapse,
  }: Props = $props();

  let password = $state("");

  const players = $derived(playerSeats(room));
  const spectators = $derived(spectatorSeats(room));
  const unavailable = $derived(roomUnavailableReason(room));
  const disabled = $derived(dimmed || unavailable !== null);

  function pick(): void {
    if (disabled) return;
    if (room.hasPassword && !expanded) {
      onExpand(room);
      return;
    }
    onSelect(room, password);
  }
</script>

<article class="room-card" class:dimmed class:playing={room.phase === "active"} class:expanded>
  <button type="button" class="card-body" {disabled} onclick={pick}>
    <span class="title-row">
      {#if room.hasPassword}
        <!-- A drawn padlock, not an emoji (CLAUDE.md forbids emojis in the UI) and not an icon
             font: at this size a two-path SVG that inherits currentColor is smaller than either
             and themes for free. The hidden sentence carries the meaning to a screen reader. -->
        <svg class="lock" viewBox="0 0 12 14" aria-hidden="true" focusable="false">
          <path
            d="M3.2 6V4.2a2.8 2.8 0 0 1 5.6 0V6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <rect x="1.4" y="6" width="9.2" height="7" rx="1.2" fill="currentColor" />
        </svg>
        <span class="visually-hidden">Password required.</span>
      {/if}
      <span class="title">{room.title}</span>
      <span class="phase-badge" data-phase={room.phase}>{formatRoomPhase(room.phase)}</span>
    </span>

    <span class="host-row">
      {#if room.hostLabel === ""}
        <span class="host-unnamed">Host did not say who they are</span>
      {:else}
        <span class="host-label">{room.hostLabel}</span>
      {/if}
      <span class="age">opened {formatRoomAge(room.createdAt, fetchedAt)} ago</span>
    </span>

    <span class="seats">
      <span class="seat-line">
        <span class="seat-count">{players.count}<span class="seat-cap">/{players.cap}</span></span>
        <span class="seat-word">{players.count === 1 ? "player" : "players"}</span>
        {#if players.fraction !== null}
          <span class="meter" class:full={players.full}>
            <span class="meter-fill" style="--fill: {String(players.fraction * 100)}%"></span>
          </span>
        {/if}
      </span>
      {#if spectators !== null}
        <span class="seat-line spectators">
          <span class="seat-count">
            {spectators.count}{#if spectators.cap !== null}<span class="seat-cap"
                >/{spectators.cap}</span
              >{/if}
          </span>
          <span class="seat-word">watching</span>
        </span>
      {/if}
    </span>

    {#if unavailable !== null}
      <span class="unavailable">{unavailable}</span>
    {/if}
  </button>

  {#if expanded && room.hasPassword}
    <form
      class="password-row"
      onsubmit={(event) => {
        event.preventDefault();
        onSelect(room, password);
      }}
    >
      <label class="password-field">
        <span>Password for {room.title}</span>
        <input
          type="password"
          autocomplete="off"
          maxlength={limits.room.roomPasswordMaxLength}
          placeholder="Ask the host"
          bind:value={password}
        />
      </label>
      <button type="submit" class="password-go">Join</button>
      <button type="button" class="password-cancel" onclick={onCollapse}>Cancel</button>
    </form>
  {/if}
</article>

<style>
  /* A listed room is drawn as a BOARD CELL - the cell fill, the clue text color, the value
     face for the numbers - because the front door is built from the board's own materials
     (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, the art direction).
     Deriving from --board-* rather than the chrome tokens also keeps it legible under the
     light paper preset, where --surface-page and --surface-text collapse toward each other. */
  .room-card {
    --card-ink: var(--clue-text-color);
    --card-muted: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
    --card-rule: color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    --card-well: color-mix(in srgb, var(--board-cell-bg) 62%, #000000);
    display: flex;
    flex-direction: column;
    /* Square: cells are square, and a rounded card is the generic look this page rejects. */
    border-radius: 0;
    border-left: 3px solid transparent;
    background: var(--board-cell-bg);
    box-shadow: var(--effect-cell-shadow);
    overflow: hidden;
    transition:
      opacity 150ms ease,
      border-color 150ms ease;
  }

  .room-card.expanded {
    border-left-color: var(--accent);
  }

  /* "Playing" is dimmed the way a server browser dims an in-progress match - a cue, not a
     verdict: whether it accepts an arrival is the room's answer, never the list's. */
  .room-card.playing {
    opacity: 0.78;
  }

  .room-card.dimmed {
    opacity: 0.4;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    width: 100%;
    text-align: left;
    padding: 0.85rem 0.95rem;
    background: none;
    border: none;
    color: var(--card-ink);
    font: inherit;
    cursor: pointer;
  }

  .card-body:disabled {
    cursor: default;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .lock {
    width: 0.8em;
    height: 0.95em;
    flex: none;
    align-self: center;
    color: var(--board-value-color);
  }

  .room-card:hover {
    border-left-color: var(--board-value-color);
  }

  /* The title is the loud line: chrome face, room-name scale. */
  .title {
    font-family: var(--font-chrome);
    font-size: 1.1rem;
    letter-spacing: 0.02em;
    color: var(--card-ink);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .phase-badge {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.65rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    border: 1px solid currentColor;
    color: var(--card-muted);
  }

  .phase-badge[data-phase="lobby"] {
    color: var(--accent);
  }

  /* The host is the quiet line, and visibly a different KIND of fact from the title. */
  .host-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.82rem;
    color: var(--card-muted);
  }

  .host-label {
    color: var(--card-ink);
    opacity: 0.85;
  }

  .host-label::before {
    content: "hosted by ";
    color: var(--card-muted);
  }

  .host-unnamed {
    font-style: italic;
  }

  .seats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
  }

  .seat-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--card-muted);
  }

  .seat-count {
    font-family: var(--font-values);
    /* Large enough that the ultra-condensed value face is still a NUMBER: below about 1.4rem
       Six Caps (the retro preset's value face) reads as a smudge. */
    font-size: 1.45rem;
    letter-spacing: 0.04em;
    color: var(--board-value-color);
    line-height: 1;
  }

  .seat-cap {
    color: var(--card-muted);
  }

  .seat-word {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.68rem;
  }

  .meter {
    width: 5rem;
    height: 0.35rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--clue-text-color) 20%, transparent);
    overflow: hidden;
  }

  .meter-fill {
    display: block;
    height: 100%;
    width: var(--fill);
    background: var(--accent);
  }

  .meter.full .meter-fill {
    background: var(--score-negative);
  }

  .unavailable {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.7rem;
    color: var(--score-negative);
  }

  .password-row {
    display: flex;
    align-items: end;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0 0.95rem 0.85rem;
    border-top: 1px dashed var(--card-rule);
    padding-top: 0.7rem;
  }

  .password-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    min-width: 10rem;
  }

  .password-field span {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.68rem;
    color: var(--card-muted);
  }

  .password-field input {
    font: inherit;
    font-size: 0.95rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--card-rule);
    border-radius: 2px;
    /* A well sunk INTO the cell rather than a chrome-colored box on top of it: darkening the
       cell's own fill keeps the pairing with --clue-text-color that the board guarantees. */
    background: var(--card-well);
    color: var(--card-ink);
  }

  .password-go,
  .password-cancel {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.85rem;
    padding: 0.55rem 0.9rem;
    border-radius: 2px;
    cursor: pointer;
  }

  .password-go {
    border: none;
    background: var(--board-value-color);
    color: color-mix(in srgb, var(--board-cell-bg) 30%, #000000);
  }

  .password-cancel {
    border: 1px solid var(--card-rule);
    background: transparent;
    color: var(--card-muted);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .card-body:focus-visible,
  .password-go:focus-visible,
  .password-cancel:focus-visible,
  .password-field input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
</style>
