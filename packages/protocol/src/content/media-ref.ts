// Media indirection (docs/proposals/m1-protocol.md section 6): content references media
// IDENTITY (`mediaRef` - an id, nothing else); a separate per-document `media` table maps ids
// to bytes-right-now. Moving bytes (upload, bundle, re-import) rewrites only storage entries -
// no content item ever changes. The sha256 is what makes that safe: dedupe on re-import,
// verification of remote fetches, and re-linking a JSON-only export whose URLs later died by
// dropping the same files onto the importer.
import { z } from "zod";
import { idSchema } from "../ids.ts";

export const mediaRefSchema = z.strictObject({ mediaId: idSchema });

export type MediaRef = z.infer<typeof mediaRefSchema>;

// Storage states map to real flows (byte caps live in limits.ts, enforced by lint + upload):
// pending-local - bytes only in this device's IndexedDB; valid in local library autosaves,
//                 lint blocks it in any export.
// remote        - R2 behind a Worker-served URL; valid in library docs and JSON-only exports
//                 (cross-instance import warns the URLs may die).
// bundled       - media/<path> inside an export zip; import rewrites to pending-local, upload
//                 then rewrites to remote.
export const mediaStorageSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("remote"), url: z.url() }),
  z.strictObject({ state: z.literal("bundled"), path: z.string().min(1).max(200) }),
  z.strictObject({ state: z.literal("pending-local") }),
]);

// REVERSED 2026-08-19 (owner: "pictures, videos, audio files, and other files must be
// renderable"). `kind` was image|audio with a note that video was "deliberately absent until a
// mode needs it" - the mode needs it. `file` is the open end: anything a clue wants to hand the
// room that is not one of the three playable kinds, which a surface offers by name and type
// rather than pretending it can paint. Keeping it an enum rather than a free string is what
// lets every surface handle every kind exhaustively - a new kind fails to compile instead of
// falling through to a blank cell.
export const mediaKindSchema = z.enum(["image", "audio", "video", "file"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const mediaAssetSchema = z.strictObject({
  id: idSchema,
  kind: mediaKindSchema,
  mime: z.string().min(1).max(100),
  bytes: z.int().positive(), // checked against limits.media caps in lint + upload, not here
  sha256: z.string().regex(/^[0-9a-f]{64}$/), // integrity, dedupe, and re-link key
  alt: z.string().max(300).optional(), // a11y, and the fallback when media is missing
  storage: mediaStorageSchema,
});

export type MediaAsset = z.infer<typeof mediaAssetSchema>;
