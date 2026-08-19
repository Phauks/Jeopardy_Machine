<script lang="ts">
  // A CLUE'S MEDIA, on any surface that shows clues - the picture round, a sound clue, a video,
  // or a file the clue hands the room.
  //
  // It exists because the wire used to carry a bare `mediaId` and every picture clue rendered as
  // words (owner, 2026-08-19: "pictures, videos, audio files, and other files must be
  // renderable"). The room now resolves the id against the pack it holds and sends a descriptor
  // (@jeopardy/protocol room/server-messages.ts, resolvedMediaSchema); this is the one place
  // that turns a descriptor into pixels, so the display, the host card and a phone cannot drift
  // into three different answers about what a clue looks like.
  //
  // FOUR KINDS, ALL HANDLED, and the switch is exhaustive on purpose: `kind` is an enum rather
  // than a free string precisely so a new kind fails to compile here instead of falling through
  // to a blank frame in front of a room.
  //
  // NO BYTES IS A STATE, NOT A FAILURE. `url` is absent whenever the room has nothing fetchable
  // - an asset whose bytes never left the authoring device, a bundled path nobody resolved
  // before hosting, or an id the pack does not hold. The alt text is what shows then, which is
  // what alt has always been for ("a11y, and the fallback when media is missing" -
  // content/media-ref.ts). A projector never shows a broken image icon.
  //
  // AUTOPLAY IS THE HOST'S CALL, NOT THIS COMPONENT'S. Audio and video render with controls and
  // do not start themselves: a clue opening is not consent to make noise on thirty phones at
  // once, and the display owns room audio (docs/decisions/2026-08-14-room-controls-and-staging.md).
  // `autoplay` is passed in by the surface that has the right to make that decision.
  import type { ResolvedMedia } from "@jeopardy/protocol/room/server-messages";

  type Props = {
    media: ResolvedMedia;
    /**
     * Only the surface that owns room audio may ask for this, and only for the playable kinds.
     * Muted is not offered as an alternative: a silent autoplaying clue is worse than a control.
     */
    autoplay?: boolean;
    /** Set on a projector, where the media IS the clue and should take the space it needs. */
    variant?: "inline" | "stage";
  };
  let { media, autoplay = false, variant = "inline" }: Props = $props();

  // The alt text, or an honest stand-in. Never empty: this element is announced to a screen
  // reader and shown verbatim when the bytes are missing, so "" would make the clue vanish for
  // anyone who cannot see it.
  const description = $derived(media.alt ?? `A ${media.kind} for this clue`);
</script>

<figure class="clue-media" data-kind={media.kind} data-variant={variant}>
  {#if media.url === undefined}
    <!-- The room has no bytes to give. Say what was meant to be here rather than showing a
         broken frame or, worse, nothing at all. -->
    <p class="missing" role="status">{description}</p>
  {:else if media.kind === "image"}
    <img src={media.url} alt={description} decoding="async" />
  {:else if media.kind === "audio"}
    <!-- svelte-ignore a11y_media_has_caption - a buzzer-round sound clue has no track to caption;
         the alt text below is the equivalent, and it is always rendered. -->
    <audio src={media.url} controls {autoplay} preload="auto"></audio>
    <figcaption>{description}</figcaption>
  {:else if media.kind === "video"}
    <!-- svelte-ignore a11y_media_has_caption - same: captions ride with the file when it has
         them, and the description is always shown beneath. -->
    <video src={media.url} controls {autoplay} preload="auto" playsinline></video>
    <figcaption>{description}</figcaption>
  {:else}
    <!-- The open end. Nothing here tries to render an unknown type - it is offered by name, in
         a new tab, which is the only honest thing to do with bytes whose shape we do not know.
         `download` is deliberately absent: a host opening a PDF mid-game wants to SEE it. -->
    <a class="attachment" href={media.url} target="_blank" rel="noopener noreferrer">
      {description}
      <span class="mime">{media.mime}</span>
    </a>
  {/if}
</figure>

<style>
  .clue-media {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  /* A projector's clue media is the clue. It gets the room's height budget, capped so a tall
     portrait image cannot push the prompt text off the bottom of the screen. */
  .clue-media[data-variant="stage"] img,
  .clue-media[data-variant="stage"] video {
    max-height: 46vh;
  }

  .clue-media[data-variant="inline"] img,
  .clue-media[data-variant="inline"] video {
    max-height: 14rem;
  }

  img,
  video {
    display: block;
    max-width: 100%;
    /* Never crop and never stretch: a picture clue that has been cropped may have had the
       answer cropped out of it. */
    object-fit: contain;
    border-radius: var(--board-radius, 2px);
    background: #000000;
  }

  audio {
    width: min(100%, 28rem);
  }

  figcaption,
  .missing {
    margin: 0;
    font-size: 0.8em;
    line-height: 1.35;
    text-align: center;
    text-wrap: pretty;
    max-inline-size: 60ch;
    color: var(--clue-text-color, inherit);
    opacity: 0.75;
  }

  /* The missing state is not decoration - it carries the whole content of the media, so it
     reads at clue size rather than as a caption. */
  .missing {
    font-size: 0.95em;
    opacity: 0.9;
    padding: 0.5rem 0.8rem;
    border: 1px dashed currentColor;
    border-radius: var(--board-radius, 2px);
  }

  .attachment {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.5rem 0.8rem;
    border: 1px solid currentColor;
    border-radius: var(--board-radius, 2px);
    color: inherit;
    text-decoration: none;
    font-size: 0.9em;
  }

  .attachment:hover,
  .attachment:focus-visible {
    text-decoration: underline;
  }

  .mime {
    font-size: 0.75em;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
</style>
