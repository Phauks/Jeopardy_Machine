<script lang="ts">
  // The room-code box: the front door's primary control, and the one thing on the landing
  // page that must work on a cracked phone screen in a loud hall.
  //
  // ONE real <input>, deliberately - not five single-character boxes. Boxed-digit inputs look
  // designed and behave badly: they break paste, they fight autofill, they announce five
  // unlabeled fields to a screen reader, and they lose a character every time a soft keyboard
  // autocorrects. The designed part here is the TYPE (the theme's value face, tracked out to
  // read like the code on the projector) rather than the widget.
  //
  // Normalization happens on the way in - lowercase and stray spaces are what people actually
  // type from a table tent - so the caller only ever sees a canonical code.
  import { limits } from "@jeopardy/protocol/limits";

  // Deliberately NOT autofocused. A landing page that grabs focus throws up the soft keyboard
  // over the sentence explaining what the site is, and steals the first swipe from anyone who
  // arrived to read rather than to type. The QR path skips this field entirely anyway.
  type Props = {
    value: string;
    /** Rendered above the field; the label is never a placeholder (placeholders vanish). */
    label?: string;
    onInput: (code: string) => void;
  };
  let { value, label = "Room code", onInput }: Props = $props();

  const complete = $derived(value.length === limits.room.roomCodeLength);

  function normalize(raw: string): string {
    return raw
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]/g, "")
      .slice(0, limits.room.roomCodeLength);
  }
</script>

<label class="code-field">
  <span class="code-label">{label}</span>
  <input
    class="code-input"
    class:complete
    type="text"
    inputmode="text"
    autocapitalize="characters"
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    maxlength={limits.room.roomCodeLength}
    placeholder="BQKX7"
    aria-describedby="room-code-hint"
    {value}
    oninput={(event) => {
      onInput(normalize(event.currentTarget.value));
    }}
  />
  <span class="code-hint" id="room-code-hint">
    {limits.room.roomCodeLength} letters and digits, from the big screen
  </span>
</label>

<style>
  /* Board materials, like everything on the front door: the code box is a value cell with a
     number in it, so it derives from --board-cell-bg + --board-value-color rather than the
     chrome tokens. That pairing is the one the theme contract guarantees to be legible under
     every preset - including the light paper one, where the chrome tokens converge. */
  .code-field {
    --field-ink: var(--clue-text-color);
    --field-muted: color-mix(in srgb, var(--clue-text-color) 66%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .code-label {
    font-family: var(--font-chrome);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.75rem;
    color: var(--field-muted);
  }

  /* The code reads the way it reads on the projector: the theme's value face, tracked out,
     in the value color. This is the one input on the site that is allowed to be loud. */
  .code-input {
    font-family: var(--font-values);
    font-size: clamp(2.4rem, 9vw, 3.4rem);
    line-height: 1;
    letter-spacing: 0.22em;
    /* The tracking above adds a trailing gap after the last glyph; pulling it back keeps the
       text optically centred in the box instead of drifting left. */
    text-indent: 0.22em;
    text-align: center;
    text-transform: uppercase;
    color: var(--board-value-color);
    background: color-mix(in srgb, var(--board-cell-bg) 55%, #000000);
    border: 2px solid color-mix(in srgb, var(--clue-text-color) 26%, transparent);
    border-radius: 2px;
    padding: 0.35rem 0.5rem 0.25rem;
    width: 100%;
    min-width: 0;
  }

  .code-input::placeholder {
    color: var(--field-muted);
    opacity: 0.4;
  }

  .code-input.complete {
    border-color: var(--accent);
    text-shadow: var(--effect-value-glow);
  }

  .code-input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }

  .code-hint {
    font-family: var(--font-chrome);
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    color: var(--field-muted);
  }
</style>
