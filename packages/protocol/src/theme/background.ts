// The stage behind the board: solid, gradient, tiled pattern, or an uploaded image (via the
// media indirection - bytes ride in the theme document's media table, content/media-ref.ts).
// The image variant's dim is the auto-dim overlay slider from the theming decision: clue text
// must stay readable over any photo, so the overlay strength is data, not taste.
import { z } from "zod";
import { mediaRefSchema } from "../content/media-ref.ts";
import { colorSchema } from "./tokens.ts";

export const themeBackgroundSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("solid"), color: colorSchema }),
  z.strictObject({
    kind: z.literal("gradient"),
    from: colorSchema,
    to: colorSchema,
    angleDeg: z.int().min(0).max(359).default(180),
  }),
  z.strictObject({
    kind: z.literal("pattern"),
    patternId: z.enum(["dots", "grid", "diagonal"]),
    foreground: colorSchema,
    background: colorSchema,
  }),
  z.strictObject({
    kind: z.literal("image"),
    media: mediaRefSchema,
    dim: z.number().min(0).max(1).default(0.4),
  }),
]);

export type ThemeBackground = z.infer<typeof themeBackgroundSchema>;
