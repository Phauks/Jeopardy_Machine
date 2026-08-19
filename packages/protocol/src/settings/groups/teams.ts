// Rules-matrix rows 34-36: team play (docs/research/01-game-anatomy.md section 6).
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

// MIXED IS THE THIRD MODE, and it is not a half-measure between the other two (owner,
// 2026-08-19): a room night is rarely all pairs or all soloists, and forcing the odd person
// into a team of one - which is what "teams" does to a straggler - makes the scoreboard lie
// about what happened. In mixed, a player with no team scores as themselves, which is exactly
// what the engine already does (a participant's scoring entity is `teamId ?? playerId`).
// NO default on the schema itself. It carries a default where it is a SETTING (below, so
// `settingsSchema.parse({})` still yields a complete game) and none on the wire, where a
// snapshot that forgot to say how the room seats people must fail loudly rather than quietly
// become an individuals room (room/messages.test.ts holds that line).
export const playerModeSchema = z.enum(["individuals", "teams", "mixed"]);

export type PlayerMode = "individuals" | "teams" | "mixed";

/**
 * May this room have teams at all? True for teams AND mixed.
 *
 * Every place that used to ask `playerMode === "teams"` was really asking one of two different
 * questions, and the boolean hid the difference. This is the one about whether the team
 * MACHINERY exists: whether the pre-game screen shows a teams region, whether `team-create` and
 * `team-join` are accepted, whether the staged lobby draws team stations.
 */
export function teamsAreOffered(mode: PlayerMode): boolean {
  return mode !== "individuals";
}

/**
 * Must every player end up on a team? True for teams only.
 *
 * The other question: whether being teamless is an unfinished state to be corrected (the room
 * seats stragglers as solo teams at start-game, and refuses a join that names no team) or a
 * choice to be respected. Mixed says respected, which is the whole point of it.
 */
export function teamsAreRequired(mode: PlayerMode): boolean {
  return mode === "teams";
}

export const teamsGroup = defineSettingsGroup({
  id: "teams",
  label: "Teams",
  description: "Individuals or teams, and how a team buzzes.",
  settings: {
    playerMode: defineSetting({
      matrixRow: 34,
      label: "Player mode",
      description:
        "individuals: everyone scores for themselves. teams: everyone plays for a shared team score. mixed: teams exist and playing solo is a legitimate choice, so a room can hold three couples and two people who came alone.",
      schema: playerModeSchema.default("individuals"),
    }),
    teamBuzzer: defineSetting({
      matrixRow: 35,
      label: "Team buzzer",
      description:
        "shared-phone: one phone per team (simplest and most robust). any-member: first buzz from any teammate counts. rotating-captain: one active buzzer per clue, rotated to keep everyone engaged.",
      constraints: "Only read when teams exist (teams or mixed); soloists are unaffected.",
      schema: z.enum(["shared-phone", "any-member", "rotating-captain"]).default("shared-phone"),
    }),
    teamWideEarlyBuzzPenalty: defineSetting({
      matrixRow: 36,
      label: "Team-wide early-buzz penalty",
      description:
        "An early buzz locks out the whole team, not just the presser - otherwise multi-phone teams can spam the arm window.",
      constraints:
        "Only read when teams exist (teams or mixed). A soloist is their own entity, so it cannot reach them either way.",
      schema: z.boolean().default(true),
    }),
  },
  refinements: [],
});
