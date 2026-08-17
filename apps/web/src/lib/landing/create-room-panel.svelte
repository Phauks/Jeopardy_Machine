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
  import { createFormProblems } from "#lib/landing/create-room-request.ts";
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
  <h2 class="panel-heading" id="create-heading">
    <span class="marker">02</span>
    <span class="heading-text">Create a room</span>
  </h2>
  <p class="panel-lede">
    You host, everyone else scans. The room opens with the built-in sample game until the
    editor lands - every setting below is editable afterwards from the console.
  </p>

  <form
    class="create-form"
    onsubmit={(event) => {
      event.preventDefault();
      if (problems.length === 0 && !busy) onCreate();
    }}
  >
    <label class="field name-field">
      <span class="field-label">
        Room name
        <span class="counter" aria-hidden="true">
          {form.title.length}/{limits.room.roomTitleMaxLength}
        </span>
      </span>
      <input
        type="text"
        autocomplete="off"
        maxlength={limits.room.roomTitleMaxLength}
        placeholder="Thursday pub quiz"
        bind:value={form.title}
      />
    </label>

    <label class="field">
      <span class="field-label">Hosted by</span>
      <input
        type="text"
        autocomplete="off"
        maxlength={limits.room.hostLabelMaxLength}
        placeholder="Optional"
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
      <span class="field-label">Player cap</span>
      <input
        type="number"
        min="1"
        max={limits.room.playerHardCap}
        inputmode="numeric"
        bind:value={form.maxPlayers}
      />
    </label>

    <label class="field toggle-field">
      <input type="checkbox" bind:checked={form.spectatorsAllowed} />
      <span>Allow spectators</span>
    </label>

    <!-- Reserved: problems and refusals land in this block rather than growing the form, so
         the button never moves out from under a thumb that is already reaching for it. -->
    <div class="verdict" role="status">
      {#if state.status === "failed"}
        <p class="failure">{state.message}</p>
      {:else if problems.length > 0}
        <p class="problem">{firstProblem}</p>
      {:else if form.password !== ""}
        <p class="hint">Everyone joining will be asked for this password.</p>
      {:else if form.listing === "public"}
        <p class="hint">Anyone can see this room in the list and walk in.</p>
      {:else}
        <p class="hint">Only people you give the code to can join.</p>
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
     direction): a category-colored panel with fields sunk into it as wells. Derived from
     --board-* rather than the chrome tokens so it stays legible under every preset, including
     the light paper one where --surface-page and --surface-text converge. */
  .create {
    --create-ink: var(--clue-text-color);
    --create-muted: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
    --create-rule: color-mix(in srgb, var(--clue-text-color) 24%, transparent);
    --create-well: color-mix(in srgb, var(--board-category-bg) 58%, #000000);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: clamp(1rem, 2.2vw, 1.5rem);
    background: var(--board-category-bg);
    color: var(--create-ink);
  }

  .panel-heading {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    margin: 0;
    font-family: var(--font-chrome);
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  /* Chrome face, not the value face: the latter is an ultra-condensed projector face that
     reads as noise below about 2rem. The value COLOR carries the resemblance. */
  .marker {
    font-family: var(--font-chrome);
    font-size: 1.05rem;
    line-height: 1;
    letter-spacing: 0.18em;
    color: var(--board-value-color);
  }

  .heading-text {
    font-weight: 400;
  }

  .panel-lede {
    margin: 0;
    max-inline-size: 44ch;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--create-muted);
  }

  .create-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem 0.7rem;
    align-items: end;
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

  .hint {
    color: var(--create-muted);
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
    color: color-mix(in srgb, var(--board-category-bg) 26%, #000000);
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
