// The staging themes this build ships, and how a surface names one.
//
// Same shape as theme-presets.ts, and for the same reason: which staging theme a room uses is
// a THEME DOCUMENT decision, not a code path (docs/design/expansion-and-boundaries.md). The
// vocabulary lived here alone while the staged lobby was built; the 2026-08-16 reconcile put
// `staging` into `themeBodySchema` (packages/protocol/src/theme/theme.ts) beside the
// `environment` slot, so a surface now passes `theme.staging` straight into stagingThemeById().
//
// The ids below and the protocol enum are the same vocabulary, held equal by a test in
// staged-lobby.states.test.ts: adding a theme is a file next to staging-themes/boats.ts, a line
// here, and the id in the protocol enum - and forgetting the third reddens rather than silently
// making a document that names it invalid.
import { boatsStagingTheme } from "#lib/staging/staging-themes/boats.ts";
import { campfiresStagingTheme } from "#lib/staging/staging-themes/campfires.ts";
import type { ThemeStaging } from "@jeopardy/protocol";
import type { StagingTheme } from "#lib/staging/staging-theme.ts";

/** Default first, the way theme-presets.ts orders its own. */
export const stagingThemes: readonly StagingTheme[] = [boatsStagingTheme, campfiresStagingTheme];

export const defaultStagingTheme: StagingTheme = boatsStagingTheme;

/** Unknown ids fall back rather than throwing: a theme document is data, and data can be old. */
export function stagingThemeById(id: ThemeStaging | string | null | undefined): StagingTheme {
  return stagingThemes.find((theme) => theme.id === id) ?? defaultStagingTheme;
}
