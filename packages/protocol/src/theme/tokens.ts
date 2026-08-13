// Theme tokens: the colors and fills the board surfaces render from. Themes change look,
// never structure (boundary 2.4), and nothing here can reach past the player a11y floor
// (boundary 2.9) - phone-side device overrides always win, which is enforced by the player UI
// consuming only the chrome subset of these tokens.
import { z } from "zod";

// Lowercase six-digit hex only: one canonical serialization per color (no shorthand, no
// alpha - dimming is its own explicit control where it exists).
export const colorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'colors are lowercase six-digit hex like "#0a1a6e"');

export type Color = z.infer<typeof colorSchema>;

export const fillSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("solid"), color: colorSchema }),
  z.strictObject({
    kind: z.literal("gradient"),
    from: colorSchema,
    to: colorSchema,
    angleDeg: z.int().min(0).max(359).default(180),
  }),
]);

export type Fill = z.infer<typeof fillSchema>;

export const themeTokensSchema = z.strictObject({
  boardBackground: fillSchema,
  cellBackground: fillSchema,
  categoryBackground: fillSchema,
  valueColor: colorSchema,
  clueTextColor: colorSchema,
  accentColor: colorSchema,
  usedCellTreatment: z.enum(["blank-dark", "dimmed", "outline"]).default("blank-dark"),
});

export type ThemeTokens = z.infer<typeof themeTokensSchema>;
