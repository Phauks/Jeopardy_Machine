// The document envelope - every portable document (content pack, game definition, rule set,
// theme) is this shape: identity + version + meta in the envelope, everything format-specific
// nested under `body`. Nesting keeps envelope fields collision-proof forever, lets this one
// generic helper build every document schema, and lets migrations be written against `body`
// alone while the envelope stays stable (docs/proposals/m1-protocol.md section 1).
//
// Two versioning regimes exist on purpose and must not be conflated: the WS wire (wire.ts)
// uses a single integer because both ends deploy together and skew is refused outright;
// documents use semver strings because files live for years in strangers' Downloads folders
// and old files must migrate forward. Semver rules: patch = spec-text clarification only;
// minor = additive optional-with-default fields only (old files parse, no upgrader);
// major = shape change, a registered migration is mandatory (migration.ts enforces).
import { z } from "zod";
import { extensionBagSchema } from "../ext.ts";

export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'schemaVersion must be a plain semver string like "1.0.0"');

export type Semver = z.infer<typeof semverSchema>;

// Author and license exist from the first exported file ever: the community pack library
// (docs/design/expansion-and-boundaries.md 1.3) is only possible if documents are attributable
// from day one. Timestamps are UTC ISO strings (Date.toISOString shape) - z.iso.datetime
// rejects offset forms, so there is exactly one serialization of a given instant.
export const documentMetaSchema = z.strictObject({
  title: z.string().min(1).max(200),
  author: z.string().max(120).optional(),
  license: z.string().max(120).optional(), // SPDX id preferred, free text allowed
  created: z.iso.datetime(),
  modified: z.iso.datetime(),
});

export type DocumentMeta = z.infer<typeof documentMetaSchema>;

// strictObject everywhere in documents: unknown keys are rejected loudly because the only
// sanctioned home for foreign data is `ext` (boundary 2.6). The wire envelope is loose since
// payloads extend it; documents have nothing extending them.
export function documentSchema<Format extends string, Body extends z.ZodType>(
  format: Format,
  bodySchema: Body,
) {
  return z.strictObject({
    format: z.literal(format), // machine identity - never the filename (importers ignore names)
    schemaVersion: semverSchema, // version of this format's schema, not of the app
    meta: documentMetaSchema,
    ext: extensionBagSchema.optional(), // preserved untouched on round-trip (boundary 2.6)
    body: bodySchema,
  });
}
