<script lang="ts">
  // THE RULES OF THE GAME BEING PLAYED, where the host can reach them.
  //
  // Owner, 2026-08-20, four sentences that are all this panel:
  //   "the timer for answering should be on the screen as well as the device, it should be
  //    settable by the host."
  //   "Just because it times out, doesn't mean it was wrong. People will be discussing the
  //    question."
  //   "Just because you got it wrong does not mean you lose money, allow for setting in
  //    settings."
  //   "when someone gets a question wrong, other people answer until they someone gets it
  //    right."
  //
  // Three of the four were already rules-matrix rows, and every one of them was unreachable:
  // rules arrive inside a game definition, so changing one meant authoring a new document and
  // making a new room - at a quiz night, in front of everybody. The fourth was a rule the
  // matrix never had, because the matrix inventories the SHOW's rules and on television a
  // clock running out IS a verdict.
  //
  // WHAT MAKES THIS SAFE is not this panel, it is the subset (@jeopardy/protocol
  // room/live-rules.ts): only rules the engine reads FRESH when it needs them can move, so a
  // change between clues - or during one - means the next read simply sees the new value.
  // Anything the running state was BUILT from is refused by the schema, not hidden by the UI.
  //
  // WHY IT READS `view.rules` RATHER THAN A LOCAL DRAFT: these are room state, broadcast to
  // everyone. A second host console, or this one after a reload, must show what the room is
  // actually playing by. The controls apply immediately for the same reason the room's own
  // switches do - there is nothing to type here, so there is nothing to hold.
  import { answerWindowSecondBounds } from "@jeopardy/protocol/room/live-rules";
  import type { RoomStore } from "#lib/room/room-store.ts";

  type Props = {
    store: RoomStore;
    /** Rendered inside a dock section, which owns the heading, the border and the scrolling. */
    embedded?: boolean;
  };
  let { store, embedded = false }: Props = $props();

  const view = $derived(store.view);
  const rules = $derived(view.rules);

  // Seconds on screen, milliseconds on the wire. A host thinks "give them ten seconds", and
  // the bounds are the settings registry's own (buzzing.answerWindowMs) so a host tuning live
  // cannot escape a limit an authored rule set is held to.
  //
  // null is NO LIMIT (owner, 2026-08-20: "time to answer should allow for no time limit"), and
  // the slider keeps its last position while the switch is off so turning the clock back on
  // returns the number the host had chosen rather than a default they have to find again.
  const limited = $derived(rules.answerWindowMs !== null);
  let rememberedSeconds = $state(5);
  $effect(() => {
    if (rules.answerWindowMs !== null) rememberedSeconds = Math.round(rules.answerWindowMs / 1000);
  });
  const answerSeconds = $derived(
    rules.answerWindowMs === null ? rememberedSeconds : Math.round(rules.answerWindowMs / 1000),
  );

  function setAnswerSeconds(seconds: number): void {
    const clamped = Math.min(
      answerWindowSecondBounds.max,
      Math.max(answerWindowSecondBounds.min, Math.round(seconds)),
    );
    store.updateGameRules({ buzzing: { answerWindowMs: clamped * 1000 } });
  }
</script>

<section class="rules-panel" class:embedded aria-label="Game rules">
  {#if !embedded}
    <header class="panel-head"><h2>Rules</h2></header>
  {/if}

  <p class="lede">
    The room is playing by these right now. Changing one reaches every phone immediately - it
    does not wait for the next clue, and it does not need a new room.
  </p>

  <!-- ANSWER CLOCK. The owner's first ask, and the one with a visible consequence: this is the
       number the countdown on the projector and on the phone both run against
       (#lib/room/answer-clock.svelte). -->
  <div class="control">
    <label for="answer-window">
      Time to answer
      <span class="value">{limited ? `${String(answerSeconds)}s` : "no limit"}</span>
    </label>
    <input
      id="answer-window"
      type="range"
      min={answerWindowSecondBounds.min}
      max={answerWindowSecondBounds.max}
      step="1"
      value={answerSeconds}
      disabled={!limited}
      oninput={(event) => {
        setAnswerSeconds(event.currentTarget.valueAsNumber);
      }}
    />
    <label class="switch">
      <input
        type="checkbox"
        checked={!limited}
        onchange={(event) => {
          store.updateGameRules({
            buzzing: {
              answerWindowMs: event.currentTarget.checked ? null : rememberedSeconds * 1000,
            },
          });
        }}
      />
      <span>
        <strong>No time limit</strong>
        <span class="note">
          No countdown anywhere, and nothing runs out. Take as long as the room needs and judge
          when you are ready.
        </span>
      </span>
    </label>
    <p class="note">
      {limited
        ? "Counted down on the big screen and in the answerer's hand. Running out changes nothing on its own - you still judge every answer."
        : "Nothing is being counted."}
    </p>
  </div>

  <!-- WHAT A WRONG ANSWER COSTS. "Just because you got it wrong does not mean you lose money." -->
  <fieldset class="control">
    <legend>A wrong answer</legend>
    {#each [{ id: "deduct", label: "Costs the clue's value", note: "The television rule. Scores can go negative." }, { id: "floor-at-zero", label: "Costs, but never below zero", note: "Deducts what it can. Nobody ends the night in the red." }, { id: "none", label: "Costs nothing", note: "You can be wrong for free. The friendly setting for a room that is here to have fun." }] as option (option.id)}
      <label class="choice">
        <input
          type="radio"
          name="wrong-answer-penalty"
          checked={rules.wrongAnswerPenalty === option.id}
          onchange={() => {
            store.updateGameRules({
              scoring: {
                wrongAnswerPenalty: option.id as "deduct" | "floor-at-zero" | "none",
              },
            });
          }}
        />
        <span>
          <strong>{option.label}</strong>
          <span class="note">{option.note}</span>
        </span>
      </label>
    {/each}
  </fieldset>

  <!-- THE REBOUND. "when someone gets a question wrong, other people answer until they someone
       gets it right." Two settings, deliberately adjacent: passing the clue on is only "until
       someone gets it right" if the person who missed steps aside. The copy was rewritten on
       the owner's call the same day - the first version described the MECHANISM ("buzzers
       re-arm") to a host who is asking what happens at their quiz night. -->
  <div class="control">
    <label class="switch">
      <input
        type="checkbox"
        checked={rules.rebound}
        onchange={(event) => {
          store.updateGameRules({ buzzing: { rebound: event.currentTarget.checked } });
        }}
      />
      <span>
        <strong>Keep going after a wrong answer</strong>
        <span class="note">
          Everyone else gets a shot at the same clue, until somebody is right or nobody is left
          to try. Off ends the clue on the first wrong answer.
        </span>
      </span>
    </label>
    <label class="switch">
      <input
        type="checkbox"
        checked={rules.wrongAnswererLockedOut}
        disabled={!rules.rebound}
        onchange={(event) => {
          store.updateGameRules({
            buzzing: { wrongAnswererLockedOut: event.currentTarget.checked },
          });
        }}
      />
      <span>
        <strong>...and whoever missed sits that clue out</strong>
        <span class="note">
          {rules.rebound
            ? "Turn this off and they can buzz again on the same clue."
            : "Nothing to sit out - a wrong answer already ends the clue."}
        </span>
      </span>
    </label>
  </div>

  <!-- The old version of this footnote explained the ARCHITECTURE - which rules the running
       state was built from, and a phone count that read "the state on 0 phones was built from"
       in an empty room. A host does not need the reason; they need to know where to look for
       the settings that are not here (owner, 2026-08-20). -->
  <p class="foot">
    The board, the rounds, the wager cells and whether people play in teams were set when this
    room opened. Changing those means a new room.
  </p>
</section>

<style>
  /* Control chrome, never the room's theme: this panel steers the game, so painting it in the
     game's own colours is the bug console-chrome.gate.test.ts exists to prevent. */
  .rules-panel {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    font-family: var(--control-font);
    color: var(--control-text);
    font-size: 0.85em;
  }

  /* Standalone it is a panel; inside a dock section the section owns the border, the heading
     and the scrolling, and a second box around this would be exactly the boxes-in-boxes the
     owner rejected (2026-08-20). */
  .rules-panel:not(.embedded) {
    width: 20rem;
    max-height: calc(100dvh - 2rem);
    overflow-y: auto;
    padding: 0.8rem 0.9rem 1.2rem;
    border: 1px solid var(--control-border);
    border-radius: var(--control-radius);
    background: var(--control-page);
  }

  .panel-head h2 {
    margin: 0;
    font-size: 1em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .lede,
  .note,
  .foot {
    margin: 0;
    color: var(--control-text-muted);
    line-height: 1.45;
    text-wrap: pretty;
  }

  .lede {
    font-size: 0.95em;
  }

  /* A band, not a card. Groups are separated by a hairline and their own legend, so the panel
     has ONE level of enclosure instead of three (owner: "settings are boxes in boxes"). */
  .control {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin: 0;
    padding: 0.7rem 0 0;
    border: none;
    border-block-start: 1px solid var(--control-border);
  }

  legend,
  .control > label:not(.choice):not(.switch) {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0;
    font-size: 0.95em;
    font-weight: 600;
    color: var(--control-text);
  }

  .value {
    font-variant-numeric: tabular-nums;
    color: var(--control-accent);
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--control-accent);
  }

  .choice,
  .switch {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
  }

  .choice input,
  .switch input {
    margin-top: 0.2em;
    flex: none;
    accent-color: var(--control-accent);
  }

  .choice span,
  .switch span {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .choice strong,
  .switch strong {
    font-weight: 600;
  }

  .note {
    font-size: 0.9em;
  }

  .switch input:disabled + span strong,
  .switch input:disabled + span .note {
    opacity: 0.55;
  }

  .foot {
    padding-block-start: 0.7rem;
    border-block-start: 1px solid var(--control-border);
    font-size: 0.85em;
  }
</style>
