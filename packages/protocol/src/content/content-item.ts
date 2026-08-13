// The mode-agnostic content atom (guiding principle 6): it knows nothing about boards,
// values, rounds, or wager cells - those are the mode layer's business. The type enum is
// designed for extension (ordered-list, estimate, survey are reserved in the proposal's
// table); adding one is a major bump on content-pack with a trivial migration, because a
// strict enum means old readers genuinely cannot render packs that contain it.
import { z } from "zod";
import { extensionBagSchema } from "../ext.ts";
import { idSchema } from "../ids.ts";
import { mediaRefSchema } from "./media-ref.ts";

export const contentItemTypeSchema = z.enum(["basic"]);

export type ContentItemType = z.infer<typeof contentItemTypeSchema>;

// kebab-case tags: sortable, URL-safe, and never a place for prose.
export const tagSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "tags are kebab-case: lowercase alphanumerics and hyphens")
  .max(40);

export type Tag = z.infer<typeof tagSchema>;

export const contentItemSchema = z.strictObject({
  id: idSchema,
  type: contentItemTypeSchema,
  prompt: z.strictObject({
    text: z.string().min(1).max(2000),
    media: mediaRefSchema.optional(), // picture/audio clue - shown when the clue opens
  }),
  answer: z.strictObject({
    canonical: z.string().min(1).max(500), // what the host card / reveal shows
    // Extra equivalents for typed auto-judge (rules-matrix #21). Matching/normalization
    // rules (case, articles, fuzz) are the M2 engine's problem, not the format's.
    accepted: z.array(z.string().min(1).max(500)).max(20).default([]),
    // Owner directive 2026-08-13: media attaches to the ANSWER side too - the reveal can
    // show the labeled park photo of a picture round or the cover art of a music clue.
    media: mediaRefSchema.optional(),
  }),
  tags: z.array(tagSchema).max(20).default([]),
  difficulty: z.int().min(1).max(5).optional(), // authoring aid, not a game rule
  source: z.string().max(500).optional(), // free-text citation / origin note
  // Expansion 1.3 (docs/design/expansion-and-boundaries.md): costless now, trust filter later.
  provenance: z.enum(["human", "ai-draft"]).default("human"),
  ext: extensionBagSchema.optional(),
});

export type ContentItem = z.infer<typeof contentItemSchema>;
