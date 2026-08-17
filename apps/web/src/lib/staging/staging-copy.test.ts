// The words the staged lobby says. Owner report, 2026-08-16: "I don't understand still in the
// water" - so what is asserted here is that the state has WORDS at all, that they come from the
// theme rather than from the boats, and that a crew list stays readable when a team gets big.
import { describe, expect, it } from "vitest";
import {
  crewNameMaxLength,
  crewPlate,
  crewPlateNameLimit,
  holdingAreaCopy,
  stationNounPlural,
  truncateCrewName,
} from "#lib/staging/staging-copy.ts";
import { stagingThemes } from "#lib/staging/staging-theme-registry.ts";
import { boatsStagingTheme } from "#lib/staging/staging-themes/boats.ts";
import { campfiresStagingTheme } from "#lib/staging/staging-themes/campfires.ts";

describe("the holding area says what it is", () => {
  it("names the state and the way out of it, in the theme's own verb", () => {
    const water = holdingAreaCopy(boatsStagingTheme, 4, 3);
    expect(water.title).toBe("Waiting to board");
    expect(water.hint).toBe("Choose a team to board");
    expect(water.count).toBe("4 waiting");

    // The same three lines, re-spoken by a theme with a different verb and noun - which is the
    // whole reason the copy is a function of the theme and not a string in a component.
    const clearing = holdingAreaCopy(campfiresStagingTheme, 1, 2);
    expect(clearing.title).toBe("Waiting to join");
    expect(clearing.hint).toBe("Choose a team to join");
    expect(clearing.count).toBe("1 waiting");
  });

  it("tells a room with no teams yet that somebody has to make the first one", () => {
    const copy = holdingAreaCopy(boatsStagingTheme, 6, 0);
    expect(copy.hint).toBe("No boats yet - the first team makes one");
    expect(copy.title).toBe("Waiting to board");
  });

  it("says something true when the water is empty rather than nothing at all", () => {
    const copy = holdingAreaCopy(boatsStagingTheme, 0, 3);
    expect(copy.title).toBe("Nobody in the water");
    expect(copy.hint).toBe("Everybody has picked a team");
    expect(copy.count).toBe("");
  });

  it.each(stagingThemes.map((theme) => [theme.id, theme] as const))(
    "%s: never leaves a state without an instruction",
    (_id, theme) => {
      for (const waiting of [0, 1, 12]) {
        for (const stations of [0, 1, 6]) {
          const copy = holdingAreaCopy(theme, waiting, stations);
          expect(copy.title.length, `${String(waiting)}/${String(stations)}`).toBeGreaterThan(0);
          expect(copy.hint.length, `${String(waiting)}/${String(stations)}`).toBeGreaterThan(0);
        }
      }
      expect(stationNounPlural(theme).endsWith("s")).toBe(true);
    },
  );
});

describe("the crew plate beneath a station", () => {
  const crew = ["Ada", "Grace", "Alan", "Katherine", "Linus", "Margaret"];

  it("lists everybody aboard while everybody fits", () => {
    const plate = crewPlate(crew);
    expect(plate.shown).toEqual(crew);
    expect(plate.overflow).toBe(0);
    for (const name of crew) expect(plate.text).toContain(name);
  });

  it("counts the rest instead of shrinking - a plate must stay readable when it is fullest", () => {
    const plate = crewPlate([...crew, "Seymour", "Tim", "Barbara"]);
    expect(plate.shown).toHaveLength(crewPlateNameLimit);
    expect(plate.overflow).toBe(3);
    expect(plate.text).toContain("+3");
    expect(plate.text).not.toContain("Barbara");
  });

  it("cuts a long nickname rather than letting it own the plate", () => {
    const long = "Bartholomew the Magnificent";
    const cut = truncateCrewName(long);
    expect(cut.length).toBe(crewNameMaxLength);
    expect(cut.startsWith("Bartholomew")).toBe(true);
    expect(crewPlate([long, "Ada"]).text).toContain("Ada");
  });

  it("draws nothing at all for an empty station", () => {
    expect(crewPlate([]).text).toBe("");
    expect(crewPlate([]).overflow).toBe(0);
  });
});
