// The content-pack document: a portable, attributable batch of content items plus the
// byte-location table for any media they reference (media-ref.ts). Author/license/title live
// in the envelope meta - present from day one because the community pack library (expansion
// 1.3) is only possible if packs are attributable from the first file ever exported. Media
// DESCRIPTIONS live here; media bytes never do (except inside a zip bundle, where storage
// rows say "bundled"). Filename convention: <name>.pack.json - but the `format` field is the
// only machine identity; the importer never trusts filenames.
import { z } from "zod";
import { documentSchema } from "../envelope/document.ts";
import { contentItemSchema, tagSchema } from "./content-item.ts";
import { mediaAssetSchema } from "./media-ref.ts";

export const contentPackBodySchema = z.strictObject({
  items: z.array(contentItemSchema).min(1).max(2000),
  media: z.array(mediaAssetSchema).max(500).default([]),
  description: z.string().max(1000).optional(),
  tags: z.array(tagSchema).max(20).default([]),
});

export const contentPackSchema = documentSchema("content-pack", contentPackBodySchema);
export const contentPackSchemaVersion = "1.0.0";

export type ContentPackBody = z.infer<typeof contentPackBodySchema>;
export type ContentPack = z.infer<typeof contentPackSchema>;
