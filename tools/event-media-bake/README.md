# @jeopardy/event-media-bake

The picture-round image pipeline for the first event: takes the eight Wikimedia Commons files the curation pass verified (docs/content/media-and-sounds.md section 1) and produces the committed, projector-sized set the game actually shows.

| Output             | Where it lands                                                     | Who reads it                                    |
| ------------------ | ------------------------------------------------------------------ | ----------------------------------------------- |
| **8 WebP images**  | `apps/web/static/games/board-game-club-x-els/media/img-0N.webp`    | The board display, through the pack's media ids |
| **Rewritten pack** | `apps/web/static/games/board-game-club-x-els/event-pack.pack.json` | Real `bytes`/`sha256`/`mime`, `bundled` storage |
| **Rewritten game** | `apps/web/static/games/board-game-club-x-els/event-game.game.json` | `content.sha256` re-pointed at the new pack     |

This package is tooling, not shipped code: one plain Node script driving `ffmpeg`. It has no build/test/check scripts, so recursive workspace commands skip it.

```sh
pnpm -F @jeopardy/event-media-bake bake              # verify + download + downscale + rewrite
pnpm -F @jeopardy/event-media-bake bake -- --offline # reuse downloads/, skip re-downloading
```

Needs `ffmpeg`/`ffprobe` (with `libwebp`) on PATH. `--offline` still re-checks each file page against the Commons API - only the multi-megabyte download is skipped.

## There is no source table here

The pack **is** the source table. Every image's file page, author, license and Commons sha1 already live in `event-pack.pack.json` under `ext["com.jeopardy-machine.event.media-verification"]`, put there by the curation pass. The bake reads that, verifies it against Commons live, and writes the acquisition facts back into the same records. A second copy of the list in this directory would be one more thing to drift out of sync with the document that actually ships.

## What is verified, and when

Checklist section 5 of the worklist says to re-open every source page before bundling and read the license there, never trusting a doc or a search filter. This bake does that mechanically on every run:

1. **License short name** from the Commons API must equal what the pack recorded (`Public domain`, `CC BY-SA 4.0`, ...). A relicensed file fails the run.
2. **The file's Commons sha1** must equal what the pack recorded. This is the strong check: an uploader who replaces the bytes behind the same file name changes the sha1, and the pack's whole verification record - author, license, dimensions - would then describe an image that no longer exists.
3. **The downloaded bytes' sha1** must equal the API's, so a truncated or rate-limited download cannot be mistaken for a valid image.

Author strings are recorded but not asserted: Commons's `Artist` field is free-form HTML and often narrower than the courtesy credit we display ("Lyn Topinka" vs "USGS / Lyn Topinka"). The sha1 check already proves the file is the same one that author was recorded for.

## Sizing and format

Downscaled to at most **2560 px on the long edge**, never upscaled. The worklist wants at least 1920 px for a 1080p projector and prefers 2560 so a crop survives; past that, every pixel is bytes no projector shows. The bake fails if a result lands under 1920 px on the long edge.

**WebP, quality 82.** Three reasons, in order: the repository already commits WebP for all 243 avatar sprites, so the asset story stays one format; it is roughly 25-35% smaller than visually equivalent JPEG, which matters against `limits.media.imageMaxBytes` (10 MiB) and in an export zip; and every browser that can run this app decodes it (Safari 14+, 2020 - a lower bar than Web Audio, which the buzzers already require). The one image that made the cap non-theoretical is img-01, whose Commons original is **37.2 MB** - nearly four times over - and which comes out of here at about 1.1 MiB.

Encoding is deterministic: fixed scaler flags, fixed quality, `-map_metadata -1` so no EXIF or timestamps ride along. Re-baking without a change produces byte-identical files.

## Storage state: why `bundled`

`mediaStorageSchema` offers `remote`, `bundled`, and `pending-local`. Before this pass the assets were `remote` Commons URLs carrying zero-filled sha256 placeholders, because the curation pass deliberately verified files without downloading them and the schema has no "pending" state (schema friction note 2 in the event README).

They are now `bundled` with `path: "media/img-0N.webp"` - which is exactly what that state means, bytes sitting at a `media/`-relative path beside the document, ready to travel in an export zip. The sha256 values are real, and `packages/protocol/src/event-documents.test.ts` re-hashes every file on every test run, so they cannot quietly stop being true.

## The pack hash chain

The game links the pack by the sha256 of the pack's **exact committed bytes**, so editing the pack always means re-hashing it into `event-game.game.json`. The bake does the whole chain in the right order - write the pack, run the repo formatter over it, hash the formatted bytes, write the game, format the game - because the committed bytes are whatever the formatter last said they are. Doing it by hand is documented in the event README and is easy to get subtly wrong.

## Re-run before event night

The pre-event checklist wants `img-01..05` re-checked for "files still live + licenses unchanged". That check is this bake: run it, and it either completes (nothing changed) or fails naming the image and what moved.
