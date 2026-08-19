<script lang="ts">
  // "Create room" as a first-class front-door action (docs/decisions/2026-08-16-persistent-
  // layout-and-pregame-rework.md: "Nobody should have to find /dev/rooms to start a game").
  //
  // Presentational: the form is a $state object owned by the route, the rules live in
  // #lib/landing/create-room-request.ts, and the fetch + navigation live in the route. This
  // file renders and calls back, which is what lets the whole panel be server-rendered in a
  // test the way every other surface here is.
  //
  // The panel changes STATE, it never swaps places (the standing layout law): creating,
  // failing, and "created but not listed" all happen in this box, under the same heading, with
  // the form still on screen. The one thing that does not happen here is success - a room that
  // was created cleanly hands straight off to the host console, because a confirmation screen
  // between the button and the game is a wizard step nobody asked for.
  import RegistryStatusLine from "#lib/lobby/registry-status-line.svelte";
  import {
    clampPlayerCap,
    createFormProblems,
    playerCapBounds,
  } from "#lib/landing/create-room-request.ts";
  import { limits } from "@jeopardy/protocol/limits";
  import type { CreateRoomForm } from "#lib/landing/create-room-request.ts";
  import type { RegistryStatus } from "@jeopardy/protocol/room/registry";

  export type CreateState =
    | { status: "idle" }
    | { status: "creating" }
    | { status: "failed"; message: string }
    // The room exists and is joinable by code, but the listing it was promised did not happen.
    // Held here deliberately: navigating away would replace that sentence with a host console
    // that looks perfectly normal (owner report 2026-08-14).
    | { status: "held"; code: string; warning: string; registry: RegistryStatus };

  type Props = {
    form: CreateRoomForm;
    state: CreateState;
    onCreate: () => void;
    onContinue: (code: string) => void;
  };
  let { form, state, onCreate, onContinue }: Props = $props();

  const problems = $derived(createFormProblems(form));
  const busy = $derived(state.status === "creating");
  // Problems are collected field-by-field in form order (create-room-request.ts), so the
  // first one is also the topmost one on screen - the right one to say out loud.
  const firstProblem = $derived(problems[0]?.message ?? null);
</script>

<section class="create" aria-labelledby="create-heading">
  <h2 class="panel-heading" id="create-heading">Create a room</h2>

  <form
    class="create-form"
    onsubmit={(event) => {
      event.preventDefault();
      if (problems.length === 0 && !busy) onCreate();
    }}
  >
    <label class="field name-field">
      <span class="field-label">
        <span>Room name<span class="required" aria-hidden="true">*</span></span>
        <span class="counter" aria-hidden="true">
          {form.title.length}/{limits.room.roomTitleMaxLength}
        </span>
      </span>
      <input
        type="text"
        autocomplete="off"
        required
        maxlength={limits.room.roomTitleMaxLength}
        placeholder="Thursday pub quiz"
        bind:value={form.title}
      />
    </label>

    <label class="field">
      <span class="field-label">
        <span>Hosted by<span class="required" aria-hidden="true">*</span></span>
        <span class="counter" aria-hidden="true">
          {form.hostLabel.length}/{limits.room.hostLabelMaxLength}
        </span>
      </span>
      <input
        type="text"
        autocomplete="off"
        required
        maxlength={limits.room.hostLabelMaxLength}
        placeholder="Board Game Club"
        bind:value={form.hostLabel}
      />
    </label>

    <fieldset class="field listing-field">
      <legend class="field-label">Who can find it</legend>
      <div class="segmented">
        <label class:selected={form.listing === "private"}>
          <input type="radio" name="listing" value="private" bind:group={form.listing} />
          <span class="segment-title">Private</span>
          <span class="segment-note">Code only</span>
        </label>
        <label class:selected={form.listing === "public"}>
          <input type="radio" name="listing" value="public" bind:group={form.listing} />
          <span class="segment-title">Public</span>
          <span class="segment-note">Listed here</span>
        </label>
      </div>
    </fieldset>

    <!-- HOW PEOPLE PLAY, and it belongs on this form because there is nowhere else to put it:
         teams mode is a rule of the GAME, so it is fixed the moment the room opens and no
         console switch can flip it mid-night. Without this control every room the front door
         made was an individuals room, and the pre-game screen's teams region said so - "this
         room plays as individuals" with no way to have asked for anything else (owner report
         2026-08-19, "main join screen does not show how to create a team or join a team"). -->
    <fieldset class="field listing-field">
      <legend class="field-label">How people play</legend>
      <div class="segmented">
        <label class:selected={form.playerMode === "individuals"}>
          <input
            type="radio"
            name="player-mode"
            value="individuals"
            bind:group={form.playerMode}
          />
          <span class="segment-title">Individuals</span>
          <span class="segment-note">Everyone for themselves</span>
        </label>
        <label class:selected={form.playerMode === "teams"}>
          <input type="radio" name="player-mode" value="teams" bind:group={form.playerMode} />
          <span class="segment-title">Teams</span>
          <span class="segment-note">Players make and join teams</span>
        </label>
      </div>
    </fieldset>

    <label class="field">
      <span class="field-label">Password</span>
      <input
        type="password"
        autocomplete="new-password"
        maxlength={limits.room.roomPasswordMaxLength}
        placeholder="Optional"
        bind:value={form.password}
      />
    </label>

    <label class="field cap-field">
      <!-- The bound is printed, not hidden behind a refusal: the field took 128 because the
           only thing that knew the real ceiling was the validator (owner report 2026-08-17). -->
      <span class="field-label">
        <span>Player cap</span>
        <span class="counter" aria-hidden="true">
          {playerCapBounds.min}-{playerCapBounds.max}
        </span>
      </span>
      <input
        type="number"
        min={playerCapBounds.min}
        max={playerCapBounds.max}
        step="1"
        inputmode="numeric"
        bind:value={form.maxPlayers}
        onchange={() => {
          // Clamped on commit rather than per keystroke: mid-typing, "1" on the way to "15"
          // would become the minimum and swallow the next digit.
          form.maxPlayers = clampPlayerCap(form.maxPlayers);
        }}
      />
    </label>

    <label class="field toggle-field">
      <input type="checkbox" bind:checked={form.spectatorsAllowed} />
      <span>Allow spectators</span>
    </label>

    <!-- Reserved: problems and refusals land in this block rather than growing the form, so
         the button never moves out from under a thumb that is already reaching for it. It is
         empty when nothing is wrong - a form that narrates its own settings back at the person
         filling it in was the front door's biggest source of prose (owner call 2026-08-17). -->
    <div class="verdict" role="status">
      {#if state.status === "failed"}
        <p class="failure">{state.message}</p>
      {:else if problems.length > 0}
        <p class="problem">{firstProblem}</p>
      {/if}
    </div>

    <button class="create-button" type="submit" disabled={busy || problems.length > 0}>
      {busy ? "Creating the room..." : "Create room"}
    </button>
  </form>

  {#if state.status === "held"}
    <div class="held">
      <p class="held-line">{state.warning}</p>
      <RegistryStatusLine status={state.registry} />
      <button type="button" class="continue-button" onclick={() => onContinue(state.code)}>
        Open the host console
      </button>
    </div>
  {/if}
</section>

<style>
  /* Board materials (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md, art
     direction): fields sunk into the surrounding cell as wells. It carries no fill of its own
     since 2026-08-18 - it opens INSIDE the counter band rather than standing beside it as a
     slab of its own, and a second colored panel inside a cell reads as a page within a page
     (docs/decisions/2026-08-18-front-door-architecture.md). Derived from --board-* rather than
     the chrome tokens so it stays legible under every preset, including the light paper one
     where --surface-page and --surface-text converge. */
  .create {
    --create-ink: var(--clue-text-color);
    --create-muted: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
    --create-rule: color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    --create-well: color-mix(in srgb, var(--board-cell-bg) 55%, #000000);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    color: var(--create-ink);
  }

  /* No section number any more: the numbered headings ("01 Join", "02 Create", "03 Public
     rooms") belonged to a page of four equal panels, and this panel is now a disclosure the
     Host button opens (docs/decisions/2026-08-18-front-door-architecture.md). */
  .panel-heading {
    margin: 0;
    font-family: var(--font-chrome);
    font-weight: 400;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
  }

  /* A form column, not a page width: name and password fields stretched across a 1440px laptop
     look like a database admin screen, and the eye has to travel the whole window to read a
     label and reach its input. */
  .create-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem 0.7rem;
    align-items: end;
    max-width: 46rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
  }

  .name-field,
  .listing-field,
  .verdict,
  .create-button {
    grid-column: 1 / -1;
  }

  .field-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.68rem;
    color: var(--create-muted);
  }

  .counter {
    font-family: var(--font-chrome);
    letter-spacing: 0.1em;
    font-size: 0.7rem;
    white-space: nowrap;
    color: var(--board-value-color);
  }

  /* Required is marked where the eye already is - on the label, in the one color this panel
     uses for "the machine is talking to you". */
  .required {
    padding-left: 0.15rem;
    color: var(--board-value-color);
  }

  .field input[type="text"],
  .field input[type="password"],
  .field input[type="number"] {
    font: inherit;
    font-size: 0.95rem;
    padding: 0.55rem 0.65rem;
    width: 100%;
    min-width: 0;
    border: 1px solid var(--create-rule);
    border-radius: 2px;
    background: var(--create-well);
    color: var(--create-ink);
  }

  .field input::placeholder {
    color: var(--create-muted);
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem;
  }

  .segmented label {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--create-rule);
    border-radius: 2px;
    background: var(--create-well);
    cursor: pointer;
  }

  /* The chosen side is marked by a rule and the value color, not by a fill swap: the two
     options keep the same size and place whichever is selected. */
  .segmented label.selected {
    border-color: var(--board-value-color);
    box-shadow: inset 3px 0 0 var(--board-value-color);
  }

  .segmented input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .segment-title {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.82rem;
  }

  .segment-note {
    font-size: 0.7rem;
    color: var(--create-muted);
  }

  .toggle-field {
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-chrome);
    font-size: 0.78rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--create-muted);
    padding-bottom: 0.55rem;
  }

  .toggle-field input {
    accent-color: var(--board-value-color);
    width: 1.05rem;
    height: 1.05rem;
  }

  .verdict {
    /* Two lines' worth, always: a validation message must not push the button downward. */
    min-height: 2.4rem;
    display: flex;
    align-items: center;
  }

  .verdict p {
    margin: 0;
    max-inline-size: 52ch;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .problem,
  .failure {
    color: var(--score-negative);
  }

  .create-button {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 1rem;
    padding: 0.95rem 1.2rem;
    border: none;
    border-radius: 2px;
    background: var(--board-value-color);
    /* Near-black derived from the panel's own hue, so the slab reads as ink on gold in every
       preset instead of borrowing a chrome token that may be the same color as the panel. */
    color: color-mix(in srgb, var(--board-cell-bg) 26%, #000000);
    cursor: pointer;
  }

  .create-button:disabled {
    background: color-mix(in srgb, var(--clue-text-color) 18%, transparent);
    color: var(--create-muted);
    cursor: default;
  }

  .held {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--create-rule);
  }

  .held-line {
    margin: 0;
    max-inline-size: 52ch;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .continue-button {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: 0.9rem;
    padding: 0.7rem 1rem;
    border: 1px solid var(--board-value-color);
    border-radius: 2px;
    background: transparent;
    color: var(--board-value-color);
    cursor: pointer;
    width: fit-content;
  }

  .create-button:focus-visible,
  .continue-button:focus-visible,
  .field input:focus-visible,
  .segmented input:focus-visible + .segment-title {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  @media (max-width: 30rem) {
    .create-form {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
