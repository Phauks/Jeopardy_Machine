// Score deltas in one place, so every penalty branch (settings rows #17/#18) and the
// speed-weighted decay (#22) has exactly one implementation. Scores are always integers;
// anything fractional rounds here and nowhere else.
import type { Settings } from "@jeopardy/protocol";

/**
 * Delta for a wrong answer at the given stake under settings row #17. floor-at-zero deducts
 * only down to zero; none deducts nothing (kids/casual mode).
 */
export function wrongAnswerDelta(
  currentScore: number,
  stake: number,
  penalty: Settings["scoring"]["wrongAnswerPenalty"],
): number {
  if (penalty === "none") return 0;
  if (penalty === "floor-at-zero") return Math.max(currentScore - stake, 0) - currentScore;
  return -stake;
}

/**
 * Delta when the answer window expires after a buzz (#18): treated as a wrong answer when
 * deductOnAnswerTimeout is on, free otherwise. The lockout consequence (#16) is separate -
 * a timeout locks the answerer out either way.
 */
export function answerTimeoutDelta(
  currentScore: number,
  stake: number,
  settings: Settings,
): number {
  if (!settings.scoring.deductOnAnswerTimeout) return 0;
  return wrongAnswerDelta(currentScore, stake, settings.scoring.wrongAnswerPenalty);
}

/**
 * Points for a correct everyone-answers submission (#22). speed-weighted decays linearly
 * from full value at instant answers to half value at the window's end - a documented
 * engine constant, not a setting (the mode is Kahoot-shaped; half value keeps slow-but-right
 * clearly ahead of wrong).
 */
export function everyoneAnswersAward(
  value: number,
  mode: Settings["answerMode"]["everyoneAnswers"],
  elapsedMs: number,
  windowMs: number,
): number {
  if (mode !== "speed-weighted") return value;
  const progress = Math.min(Math.max(elapsedMs / windowMs, 0), 1);
  return Math.round(value * (1 - 0.5 * progress));
}
