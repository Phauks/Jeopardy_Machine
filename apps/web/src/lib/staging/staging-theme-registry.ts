// The staging themes this build ships, and how a surface names one.
//
// Same shape as theme-presets.ts, and for the same reason: which staging theme a room uses is
// a THEME DOCUMENT decision, not a code path (docs/design/expansion-and-boundaries.md). The
// theme schema does not carry the field yet and this milestone does not edit the protocol, so
// the vocabulary lives here as an id, exactly the way diorama-environment.ts reserves its own.
//
// WHAT THE PROTOCOL NEEDS, when it is time (one line in themeBodySchema, beside the
// `environment` reservation that file already writes out):
//   staging: z.enum(["boats", "campfires"]).optional(),
// Optional keeps it a reservation rather than a breaking change. Once it lands, a display
// passes `theme.staging` straight into stagingThemeById() and nothing else here changes.
import { boatsStagingTheme } from "#lib/staging/staging-themes/boats.ts";
import { campfiresStagingTheme } from "#lib/staging/staging-themes/campfires.ts";
import type { StagingTheme } from "#lib/staging/staging-theme.ts";

/** Default first, the way theme-presets.ts orders its own. */
export const stagingThemes: readonly StagingTheme[] = [boatsStagingTheme, campfiresStagingTheme];

export const defaultStagingTheme: StagingTheme = boatsStagingTheme;

/** Unknown ids fall back rather than throwing: a theme document is data, and data can be old. */
export function stagingThemeById(id: string | null | undefined): StagingTheme {
  return stagingThemes.find((theme) => theme.id === id) ?? defaultStagingTheme;
}
