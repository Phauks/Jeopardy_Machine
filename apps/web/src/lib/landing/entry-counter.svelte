<script lang="ts">
  // THE COUNTER: the front door's one entry control, and the page's only primary action
  // (docs/decisions/2026-08-18-front-door-architecture.md).
  //
  // It replaces three controls that used to compete - a code box, a password box beside it,
  // and a create-room form of equal weight - with one field, one Join, and a quiet Host
  // button. The field does both jobs the page has to serve: a complete code arms Join and
  // holds the list back, anything shorter filters the list underneath (the rule lives in
  // #lib/lobby/room-filter.ts, so what a typed string MEANS is a tested function rather than a
  // template condition).
  //
  // ONE real input, deliberately - not five single-character boxes. Boxed-digit inputs look
  // designed and behave badly: they break paste, fight autofill, announce five unlabeled
  // fields to a screen reader, and lose a character every time a soft keyboard autocorrects
  // (docs/research/06-join-flow-patterns.md, pattern 2).
  //
  // THE TYPE IS NOT THEMED, and that is the point (owner, 2026-08-20: "the letters are themed
  // when they should be accessible"). It was set in the theme's VALUE face - the display face a
  // projector shows a dollar amount in - which is the wrong instrument for the one string a
  // person has to transcribe under pressure, and which changes with the theme, so legibility
  // was never guaranteed. It is Atkinson Hyperlegible Next now: a face drawn by the Braille
  // Institute specifically so that characters which usually collapse into each other do not.
  //
  // Deliberately NOT autofocused: a landing page that grabs focus throws a soft keyboard over
  // the page for everyone who arrived to look rather than to type, and the QR path never
  // touches this field anyway. Deliberately NOT auto-submitting on the last character either -
  // a mistyped fifth keystroke would navigate away from the page.
  import type { CounterVerdict } from "#lib/lobby/room-filter.ts";

  type Props = {
    /** Raw field text - codes AND searches, since it is one field. */
    value: string;
    onInput: (raw: string) => void;
    /** What the field currently means, in words (`describeCounter`). */
    verdict: CounterVerdict;
    onJoin: () => void;
    /** The create form is open below the counter; the button says so rather than moving. */
    hostOpen: boolean;
    onToggleHost: () => void;
  };
  let { value, onInput, verdict, onJoin, hostOpen, onToggleHost }: Props = $props();

  // Anything a room code or a room name can contain, and nothing else: the field is shared, so
  // it accepts letters, digits and the separators a title uses, and `readCounter` decides.
  function normalize(raw: string): string {
    return raw.replaceAll(/[^\p{Letter}\p{Number} '&.:-]/gu, "").slice(0, 40);
  }
</script>

<form
  class="counter"
  onsubmit={(event) => {
    event.preventDefault();
    if (verdict.codeWins) onJoin();
  }}
>
  <div class="entry-row">
    <label class="field">
      <span class="field-label">
        Room code
        <span class="field-sub">or search what is on</span>
      </span>
      <input
        class="entry-input"
        class:armed={verdict.codeWins}
        type="text"
        inputmode="text"
        autocapitalize="characters"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="BQKX7"
        aria-describedby="counter-verdict"
        {value}
        oninput={(event) => {
          onInput(normalize(event.currentTarget.value));
        }}
      />
    </label>
  </div>

  <!-- ONE ROW, TWO EQUAL BUTTONS. Join and Host sat on different rows at different widths and
       read as unrelated controls that happened to be near each other (owner, 2026-08-20). They
       are the page's two ways forward, so they are the same size and side by side; only their
       weight says which is primary. -->
  <div class="action-row">
    <button class="join-button" type="submit" disabled={!verdict.codeWins}>Join</button>
    <button
      type="button"
      class="host-button"
      aria-expanded={hostOpen}
      aria-controls="create-room-panel"
      onclick={onToggleHost}
    >
      {hostOpen ? "Close hosting" : "Host a game"}
    </button>
  </div>

  <!-- One block for every state the counter can be in. Its height is reserved for everything
       the PAGE changes on its own - the sentence swapping between a match count, a named room
       and a listing warning as fetches land - which is what the layout law is about
       (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md: nothing reflows when
       content arrives). It used to hold a password box too; passwords are gone
       (@jeopardy/protocol room/visibility.ts) and the code is the whole story. -->
  <div class="verdict-block">
    <p class="verdict-line" id="counter-verdict" role="status" data-tone={verdict.tone}>
      {verdict.line}
    </p>
  </div>
</form>

<style>
  /* Board materials, like every surface here: the counter is a value CELL with a number in it,
     so it derives from --board-cell-bg + --board-value-color rather than the chrome tokens.
     That is the pairing the theme contract guarantees legible under every preset, including
     the light paper one where the derived chrome tokens converge (docs/design/theming.md). */
  .counter {
    --counter-ink: var(--clue-text-color);
    --counter-muted: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
    --counter-rule: color-mix(in srgb, var(--clue-text-color) 26%, transparent);
    --counter-well: color-mix(in srgb, var(--board-cell-bg) 55%, #000000);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    color: var(--counter-ink);
  }

  .entry-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.6rem;
  }

  /* The code is five characters, so the box is sized for five characters plus room to breathe -
     not for whatever width the window has. A field stretched across a 1440px laptop makes the
     placeholder float in the middle of nowhere and makes the pair read as a search bar rather
     than as the counter it is. */
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1 1 16rem;
    max-width: 26rem;
    min-width: 0;
  }

  .field-label {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.72rem;
    color: var(--counter-muted);
  }

  /* The second job, said out loud on the label - the omnibox rule: a field that does two
     things has to name both (docs/research/06-join-flow-patterns.md, pattern 4). */
  .field-sub {
    letter-spacing: 0.08em;
    text-transform: none;
    font-size: 0.72rem;
    opacity: 0.8;
  }

  /* NOT --font-values. A room code is data a person transcribes, so it is set in the app's
     legibility face and stays that way under every theme (src/lib/theme/tokens.css). */
  .entry-input {
    font-family: var(--font-legible);
    font-size: clamp(2.1rem, 7.5vw, 3rem);
    line-height: 1;
    letter-spacing: 0.2em;
    /* The tracking adds a trailing gap after the last glyph; pulling it back keeps the text
       optically centred instead of drifting left. */
    text-indent: 0.2em;
    text-align: center;
    text-transform: uppercase;
    color: var(--board-value-color);
    background: var(--counter-well);
    border: 2px solid var(--counter-rule);
    border-radius: 2px;
    padding: 0.45rem 0.6rem 0.35rem;
    width: 100%;
    min-width: 0;
  }

  .entry-input::placeholder {
    color: var(--counter-muted);
    opacity: 0.4;
  }

  .entry-input.armed {
    border-color: var(--accent);
    text-shadow: var(--effect-value-glow);
  }

  /* The two ways forward, side by side and the SAME SIZE. Only weight says which is primary:
     Join is filled, Host is outlined. */
  .action-row {
    display: flex;
    gap: 0.6rem;
  }

  .join-button,
  .host-button {
    flex: 1 1 0;
    min-width: 0;
    font-family: var(--font-chrome);
    border: 1px solid transparent;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 1rem;
    padding: 0.9rem 1rem;
    border-radius: 2px;
    cursor: pointer;
    text-align: center;
  }

  .join-button {
    background: var(--board-value-color);
    color: color-mix(in srgb, var(--board-cell-bg) 26%, #000000);
  }

  /* Disabled is INERT, not a second slab: a filled block that cannot be pressed is louder than
     the field it is waiting on. It outlines instead, and fills with the value color the moment
     the code is complete - which is the arming signal. */
  .join-button:disabled {
    background: transparent;
    border: 1px solid var(--counter-rule);
    color: var(--counter-muted);
    cursor: default;
  }


  .verdict-block {
    /* Reserved for the tallest state the page reaches by itself: a two-line sentence. */
    min-height: 3rem;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
  }

  .verdict-line {
    margin: 0;
    max-inline-size: 60ch;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--counter-muted);
  }

  .verdict-line[data-tone="code"] {
    color: var(--counter-ink);
  }

  .verdict-line[data-tone="warning"] {
    color: var(--score-negative);
  }

  /* Hosting is a peer BUTTON, never a peer form: one person per event needs it, and the form
     it opens used to be the code box's loudest competitor (decision 2026-08-18 §3). Outlined
     rather than filled, so the filled Join beside it stays the only primary action. */
  .host-button {
    border-color: var(--board-value-color);
    background: transparent;
    color: var(--board-value-color);
  }

  .host-button:hover {
    background: color-mix(in srgb, var(--board-value-color) 14%, transparent);
  }

  .entry-input:focus-visible,
  .join-button:focus-visible,
  .host-button:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
</style>
