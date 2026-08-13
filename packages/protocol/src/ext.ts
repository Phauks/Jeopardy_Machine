// The `ext` extension bag - the only place user- or third-party-defined data may ride
// inside our documents and wire messages (docs/design/expansion-and-boundaries.md, boundary 2.6:
// "no user-defined fields outside the `ext` bag"). Every versioned document (settings, theme,
// content pack, game definition) and every wire envelope carries an optional `ext` object whose
// keys are reverse-domain strings (e.g. "com.example.annotations"). Parsers MUST preserve the
// bag byte-for-byte semantically: parse -> serialize round-trips it untouched, so third parties
// and future-us can annotate without forking the format.
import { z } from "zod";

// Reverse-domain key: two or more dot-separated lowercase labels ("com.example", "org.club.notes").
// Labels are lowercase alphanumerics with interior hyphens - the DNS-label shape - so keys sort
// stably and can never collide with our own schema fields (which are never dotted).
export const extensionKeyPattern =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// Values are deliberately unconstrained (z.unknown, not a JSON-value schema): the whole point of
// the bag is that we do not understand its contents. Anything JSON.parse produced is JSON-safe
// already, which is the only context this schema runs in.
export const extensionBagSchema = z.record(
  z
    .string()
    .regex(
      extensionKeyPattern,
      'ext keys must be reverse-domain strings like "com.example.feature"',
    ),
  z.unknown(),
);

export type ExtensionBag = z.infer<typeof extensionBagSchema>;
