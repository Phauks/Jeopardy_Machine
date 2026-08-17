# @jeopardy/audio-bake

The sound pipeline: takes the CC0 sources the owner approved across three Listening Rooms (docs/content/media-and-sounds.md sections 7 and 9) and produces the pack the app actually plays.

| Output           | Where it lands                              | Who reads it                                                         |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| **21 MP3 files** | `apps/web/static/sounds/*.mp3`              | `RoomAudio.prime()` pre-decodes them into Web Audio buffers          |
| **Manifest**     | `apps/web/src/lib/room/sound-manifest.json` | Typed access via `sound-manifest.ts` beside it; the gate test        |
| **Credits**      | `apps/web/static/sounds/LICENSES.md`        | Humans and the license audit (checklist section 5.5 of the worklist) |

This package is tooling, not shipped code: plain Node scripts driving `ffmpeg`. It has no build/test/check scripts, so recursive workspace commands skip it.

## Re-baking

```sh
pnpm -F @jeopardy/audio-bake bake      # fetch + license-verify + process + write everything
pnpm -F @jeopardy/audio-bake bake -- --offline   # reuse downloads/, skip the network
pnpm -F @jeopardy/audio-bake verify    # re-measure the COMMITTED files from their bytes
pnpm -F @jeopardy/audio-bake analyze   # dump source durations + non-silent regions (curation aid)
```

`bake` needs `ffmpeg` (with `libmp3lame`) on PATH; nothing else. A full run is under a minute.

Commit the resulting `static/sounds/` files, the manifest, and `LICENSES.md` **together** - `apps/web/src/lib/room/sound-manifest.gate.test.ts` re-hashes every file against the manifest, so a partial commit fails CI by design.

### Determinism

Re-baking without a real change produces **byte-identical files**, and that is checked by re-running rather than assumed. The properties that make it hold:

- Pinned sources (`src/sources.mjs`): a Freesound id, an expected author, and a hand-picked trim window per file. Nothing is auto-detected at bake time.
- Every sample-level edit (gain, onset cut, pad, fades) happens in Node on a `Float32Array`, not in an ffmpeg filter chain, so nothing depends on how a filter rounds or resamples.
- MP3 muxing with `-map_metadata -1 -id3v2_version 0`: no tags, no timestamps, no encoder string in the output.
- Stable file names, stable manifest key order, and a stale sweep on every run.

A different ffmpeg or LAME build may shift bytes harmlessly; that shows up honestly as a whole-pack diff whose measured onsets and durations are unchanged.

## The processing chain, and why it is in this order

Per file: **decode the curated window -> normalize -> trim the onset -> re-seat at ~10 ms with a micro fade-in -> optional tail fade -> encode -> decode again and measure**.

Two orderings in there are load-bearing and easy to get backwards:

1. **Normalize before trimming the onset.** The onset is defined as "the first sample above -40 dBFS". Gain moves samples across that line, so trimming first would leave every file's real onset offset by however much gain it happened to need.
2. **Measure on the encoded file, not on the PCM going into the encoder.** MP3 smears a sharp transient slightly backwards in time (pre-echo) and the container carries its own encoder delay, so the pre-encode number is not the number the browser will hear. `src/process.mjs` decodes its own output, measures, and - if the onset missed the 8-15 ms window - shifts the pad by exactly the error and re-encodes. It converges in one or two passes; it fails the bake rather than shipping a file outside the window.

A related trap, fixed and worth not re-introducing: MP3 must be muxed to a **file**, never to a pipe. The Xing/LAME header carries the gapless delay and padding counts, and the muxer can only fill those in by seeking back to the start of the stream. Piped output ships them zeroed, which reads back as ~25 ms of phantom leading silence - the precise defect the uniform onset exists to remove.

### Loudness: two metrics on purpose

Music is matched on **integrated** loudness (-20 LUFS), the average level of a whole piece.

Buzz-ins and cues are matched on **maximum momentary** loudness (the loudest 400 ms window, -16 LUFS). Integrated loudness of a one-shot is dominated by its decay tail and its own trailing silence, so matching a punchy 0.6 s honk to a 1.5 s ringing gong on it would make the honk noticeably quieter in the room - the same unfairness the onset rule addresses, in the amplitude axis. Sub-400 ms cues are right-padded with silence so R128's window can close over them at all.

Normalization is **linear gain only**, capped so no file's peak exceeds -1.5 dBFS. When the ceiling binds before the target does, the file ships a little under target and the manifest says so in `peakLimited` - preferable to squashing a transient with a limiter to hit a number.

## Preview quality, honestly

Freesound gates full-quality originals behind a (free) account. This pipeline has no credentials, so it fetches each sound's **HQ preview**: 128 kbps MP3, which is what the site itself streams.

For the 14 buzz-ins and 3 cues this is a non-issue and not a compromise worth apologising for: they are 0.3-1.5 s one-shots that end up as 128 kbps mono MP3 either way, and the preview is already at the shipping bitrate. Any difference is below the noise floor of a phone speaker in a loud room.

For the four music tracks - especially the 4-minute `lobby-theme.mp3` - it is a real, if mild, ceiling: a 128 kbps source re-encoded to 128 kbps is one lossy generation worse than mastering from the original.

**Upgrade path** when someone with an account wants it: download each music source's original from its sound page, drop it into `downloads/<id>.source.mp3` (or point `decodeWindow` at another extension), and re-run with `--offline`. Nothing else changes - the trim windows, levels and onsets are all measured from whatever bytes are there. Automating it would mean putting a Freesound API token in the pipeline, which trades an audible-to-nobody quality gain for a secret in a self-hosted repo; not worth it.

## The lobby track is a placeholder

`lobby-theme.mp3` is currently **Funk Rock, 135 BPM** (carloseton, CC0, 4:05) - round 4's only CC0 candidate that clears the owner's "2-3 minute lap" floor (media-and-sounds.md section 9). The owner has **not** picked the signature lobby track yet; several Pixabay and incompetech candidates are still in that review, and they are not fetchable without a browser (Pixabay) or bring an attribution obligation (incompetech).

Swapping it is deliberately one edit: change the `lobby-theme` row in `src/sources.mjs` and re-bake. The id, the manifest slot (`lobbyTrack`), and every consumer stay exactly where they are. If the winner is not CC0, `src/fetch.mjs`'s license assertion has to be widened at the same time - and the credits screen the CC-BY path requires (checklist section 8) becomes mandatory.

## When to re-bake

- **The owner picks the lobby track** - the `lobby-theme` row in `src/sources.mjs`.
- **A buzz sound is added, dropped or re-cut** - the row in `src/sources.mjs`, plus the matching entry in `apps/web/src/lib/room/buzz-sound-catalog.ts` (the gate test enforces that the two agree).
- **A source is replaced upstream** - `src/fetch.mjs` will already have failed the run: it re-reads each page's license line and author on every fetch and refuses to continue when either changed.
