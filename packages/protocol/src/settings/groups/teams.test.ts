// The two questions matrix row 34 actually answers, which one boolean used to blur.
//
// Every call site in the repo used to compare `playerMode === "teams"`, and the comparison was
// doing double duty: sometimes it meant "may this room have teams at all" and sometimes "must
// everybody be on one". Those are the same answer in a two-mode world and different answers the
// moment mixed exists (owner, 2026-08-19), so they are two named functions and a site has to
// pick one. These tests are the table.
import { describe, expect, it } from "vitest";
import { playerModeSchema, teamsAreOffered, teamsAreRequired } from "./teams.ts";
import type { PlayerMode } from "./teams.ts";

const modes: readonly PlayerMode[] = ["individuals", "teams", "mixed"];

describe("player mode", () => {
  it("has exactly three values, and mixed is one of them", () => {
    expect(playerModeSchema.options).toEqual(["individuals", "teams", "mixed"]);
  });

  it("does not default on its own - the wire must say, and the setting supplies its own", () => {
    // A snapshot that forgot to carry the seating rule has to fail loudly rather than silently
    // become an individuals room (room/messages.test.ts asserts the mandatory half).
    expect(playerModeSchema.safeParse(undefined).success).toBe(false);
  });

  it("offers teams in teams AND mixed - the machinery question", () => {
    expect(modes.filter(teamsAreOffered)).toEqual(["teams", "mixed"]);
  });

  it("requires a team in teams ONLY - the is-teamless-unfinished question", () => {
    expect(modes.filter(teamsAreRequired)).toEqual(["teams"]);
  });

  it("mixed is the only mode where the two answers disagree, which is why it needed both", () => {
    const disagreeing = modes.filter((mode) => teamsAreOffered(mode) !== teamsAreRequired(mode));
    expect(disagreeing).toEqual(["mixed"]);
  });

  it("required implies offered - a room cannot demand a team it does not have", () => {
    for (const mode of modes) {
      if (teamsAreRequired(mode)) expect(teamsAreOffered(mode)).toBe(true);
    }
  });
});
