// The assembled settings registry: the ordered list of groups that IS the rules matrix,
// typed. Order here is presentation order - the docs table and the future settings UI both
// render groups in this sequence. Everything downstream derives from this list (derive.ts,
// describe.ts, docs-table.ts); nothing else may enumerate settings.
//
// Deliberately absent: matrix row 20 (host score override + undo) - always on, not data
// (see groups/scoring.ts). The registry gate test pins exactly which rows are covered.
import { answerModeGroup } from "./groups/answer-mode.ts";
import { boardControlGroup } from "./groups/board-control.ts";
import { buzzingGroup } from "./groups/buzzing.ts";
import { endGroup } from "./groups/end.ts";
import { finalGroup } from "./groups/final.ts";
import { joinGroup } from "./groups/join.ts";
import { presentationGroup } from "./groups/presentation.ts";
import { scoringGroup } from "./groups/scoring.ts";
import { structureGroup } from "./groups/structure.ts";
import { teamsGroup } from "./groups/teams.ts";
import { wagersGroup } from "./groups/wagers.ts";
import type { SettingsGroup } from "./definition.ts";

export const settingsGroups: readonly SettingsGroup[] = [
  structureGroup,
  boardControlGroup,
  buzzingGroup,
  scoringGroup,
  answerModeGroup,
  wagersGroup,
  finalGroup,
  teamsGroup,
  endGroup,
  presentationGroup,
  joinGroup,
];
