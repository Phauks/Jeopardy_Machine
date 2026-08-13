// Everyone-answers judging (#22): after the typed window closes, the host (or upstream
// auto-judge) verdicts each submitting entity; the clue resolves when every submission is
// judged. Wrong typed answers never deduct - the mode is Kahoot-shaped (mass participation,
// upside only); row #17 governs buzz-race answers, not this mode.
import { closeClue } from "../flow.ts";
import { everyoneAnswersAward } from "../scoring.ts";
import { closeEveryoneAnswers } from "./judging.ts";
import type { GameAction } from "../actions.ts";
import type { GameEvent } from "../events.ts";
import type { GameSetup } from "../setup.ts";
import type { GameState } from "../state.ts";

export function handleCloseAnswers(
  draft: GameState,
  action: Extract<GameAction, { type: "close-answers" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "all-answering") return "not-collecting-answers";
  return closeEveryoneAnswers(draft, setup, events, action.at);
}

export function handleJudgeSubmission(
  draft: GameState,
  action: Extract<GameAction, { type: "judge-entity" }>,
  setup: GameSetup,
  events: GameEvent[],
): string | null {
  if (draft.phase !== "all-judging") return "not-judging-answers";
  const clue = draft.clue;
  if (clue === null) return "no-clue";
  const submission = clue.submissions[action.entityId];
  if (submission === undefined) return "no-submission";
  if (clue.entityVerdicts[action.entityId] !== undefined) return "already-judged";

  clue.entityVerdicts[action.entityId] = action.verdict;
  let delta = 0;
  if (action.verdict === "correct") {
    delta = everyoneAnswersAward(
      clue.value,
      setup.settings.answerMode.everyoneAnswers,
      submission.at - (clue.answersOpenedAt ?? submission.at),
      setup.settings.buzzing.answerWindowMs,
    );
  }
  const score = (draft.scores[action.entityId] ?? 0) + delta;
  draft.scores[action.entityId] = score;
  events.push({ type: "judged", entityId: action.entityId, verdict: action.verdict, delta, score });

  const allJudged = Object.keys(clue.submissions).every(
    (entityId) => clue.entityVerdicts[entityId] !== undefined,
  );
  if (!allJudged) return null;

  // Board control (#7 last-correct) maps to "fastest correct typist" here; other selector
  // modes keep their own rules (rotation advances in closeClue).
  const correctEntries = Object.entries(clue.submissions)
    .filter(([entityId]) => clue.entityVerdicts[entityId] === "correct")
    .toSorted(([, left], [, right]) => left.at - right.at);
  const fastestCorrect = correctEntries[0]?.[0];
  if (fastestCorrect !== undefined && setup.settings.boardControl.nextSelector === "last-correct") {
    draft.controlEntity = fastestCorrect;
    events.push({ type: "control-assigned", entityId: fastestCorrect, reason: "correct-answer" });
  }
  closeClue(draft, setup, events, action.at, fastestCorrect !== undefined ? "correct" : "dead");
  return null;
}
