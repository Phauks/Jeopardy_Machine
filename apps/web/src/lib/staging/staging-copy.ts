// The WORDS the staged lobby says, in one place, so the 3D stage and the 2D degradation cannot
// say different things about the same room.
//
// Owner report, 2026-08-16: "I don't understand still in the water." Being unassigned was drawn
// as a POSITION and nothing else - people floating in a band with a lower-case noun over it -
// and a position is not a state anybody can read from the back of a hall. Everything here
// exists to answer, in words, the three questions the holding area was silently posing: what is
// this place, why am I in it, and how many of us are there.
//
// Pure and theme-driven: the nouns and the verb come from the staging theme (staging-theme.ts),
// so "Waiting to board - choose a team" over the water becomes "Waiting to join - choose a
// team" over the clearing without a second string being written anywhere.
import type { StagingTheme } from "#lib/staging/staging-theme.ts";

export type HoldingAreaCopy = {
  /** What this place IS - the line the screen wears in its largest holding-area type. */
  title: string;
  /** What to do about being in it. Empty is never returned; there is always an instruction. */
  hint: string;
  /** The group, made countable: "6 waiting". Empty when nobody is. */
  count: string;
};

/** Plural of a station noun. Every noun the themes use pluralises with an s; guard anyway. */
export function stationNounPlural(theme: StagingTheme): string {
  const noun = theme.stationNoun;
  return noun.endsWith("s") ? noun : `${noun}s`;
}

/**
 * The holding area's own label. Three states, because they are genuinely different rooms:
 * nobody has made a team yet, people are waiting, everybody has boarded.
 */
export function holdingAreaCopy(
  theme: StagingTheme,
  waitingCount: number,
  stationCount: number,
): HoldingAreaCopy {
  if (waitingCount === 0) {
    return {
      title: `Nobody in ${theme.holdingAreaNoun}`,
      hint: "Everybody has picked a team",
      count: "",
    };
  }
  return {
    title: `Waiting to ${theme.boardVerb}`,
    hint:
      stationCount === 0
        ? `No ${stationNounPlural(theme)} yet - the first team makes one`
        : `Choose a team to ${theme.boardVerb}`,
    count: `${String(waitingCount)} waiting`,
  };
}

/**
 * The longest a name may be on a station's crew plate before it is cut. Long enough for the
 * nicknames people actually type, short enough that one show-off cannot take the whole plate.
 */
export const crewNameMaxLength = 14;

/**
 * How many names a crew plate lists before it starts counting instead. Six is the boats theme's
 * seat count, which is not a coincidence: past a full boat the plate is answering "how many"
 * rather than "who", and a projector cannot read twelve names at that size anyway.
 */
export const crewPlateNameLimit = 6;

export type CrewPlate = {
  /** The names actually drawn, already truncated. */
  shown: string[];
  /** How many crew did not fit. */
  overflow: number;
  /** The whole plate as one line, ready for a canvas texture or a title attribute. */
  text: string;
};

/** Cut a long nickname down, keeping the start (which is what people recognise). */
export function truncateCrewName(name: string, maxLength = crewNameMaxLength): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

/**
 * The crew of one station, as the plate beneath it reads (owner: "names beneath the boats on
 * the display, so the room can see who is aboard which").
 *
 * Overflow is a COUNT, never a scroll and never a shrink: a plate that stayed readable by
 * getting smaller would be unreadable at exactly the moment it has the most to say.
 */
export function crewPlate(names: readonly string[], limit = crewPlateNameLimit): CrewPlate {
  const shown = names.slice(0, limit).map((name) => truncateCrewName(name));
  const overflow = Math.max(0, names.length - shown.length);
  if (shown.length === 0) return { shown, overflow: 0, text: "" };
  const text = overflow === 0 ? shown.join("  ") : `${shown.join("  ")}  +${String(overflow)}`;
  return { shown, overflow, text };
}
