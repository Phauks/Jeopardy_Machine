// The create form's rules. These exist so a refusal is a sentence under a field rather than
// an opaque 400 after the tap - and so the one case that must NOT hand off (a public room the
// registry could not list) cannot be quietly "fixed" into a navigation later.
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import {
  blankCreateForm,
  clampPlayerCap,
  createFormProblems,
  createRoomBody,
  describeCreateFailure,
  handOffAfterCreate,
  playerCapBounds,
  withPlayerMode,
} from "#lib/landing/create-room-request.ts";
import { resolveGameRules, ruleSetSchema } from "@jeopardy/protocol";
import { teamsAreOffered, teamsAreRequired } from "@jeopardy/protocol/settings/player-mode";
import { sampleGameDefinition } from "#lib/hotseat/sample-game.ts";
import type { CreateRoomForm } from "#lib/landing/create-room-request.ts";
import type { CreateRoomResponse } from "@jeopardy/protocol/room/create";

function formOf(overrides: Partial<CreateRoomForm> = {}): CreateRoomForm {
  return { ...blankCreateForm(), ...overrides };
}

const named = { title: "Pub quiz", hostLabel: "Board Game Club" };

describe("create form validation", () => {
  it("opens private, with the two required fields empty and the button off", () => {
    const form = blankCreateForm();
    expect(form.listing).toBe("private");
    expect(createFormProblems(form).map((problem) => problem.field)).toEqual([
      "title",
      "hostLabel",
    ]);
    expect(createFormProblems(formOf(named))).toEqual([]);
  });

  // Owner call 2026-08-17: the requirement used to be public-only. It is now unconditional -
  // there is no listing-dependent branch for the name left in the module at all.
  it("requires a name whatever the listing, private included", () => {
    for (const listing of ["private", "public"] as const) {
      const problems = createFormProblems(formOf({ ...named, listing, title: "  " }));
      expect(problems).toHaveLength(1);
      expect(problems[0]?.field).toBe("title");
    }
  });

  it("refuses a PRIVATE room with a blank host label, same as a public one", () => {
    const problems = createFormProblems(formOf({ ...named, listing: "private", hostLabel: " " }));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe("hostLabel");
    expect(createFormProblems(formOf({ ...named, listing: "public", hostLabel: "" }))).toHaveLength(
      1,
    );
  });

  it("holds the caps on both listing strings, so a paste cannot outgrow the lobby row", () => {
    expect(
      createFormProblems(
        formOf({ ...named, title: "x".repeat(limits.room.roomTitleMaxLength + 1) }),
      ).length,
    ).toBe(1);
    expect(
      createFormProblems(
        formOf({ ...named, hostLabel: "x".repeat(limits.room.hostLabelMaxLength + 1) }),
      ).length,
    ).toBe(1);
  });

  // Owner report 2026-08-17: "the player-cap field accepts values over 100". The ceiling the
  // form offers is the SOFT cap - the product promise - never the hard cap, which is refusal
  // headroom and was never a number a host is invited to type.
  it("bounds the player cap by the soft cap, not by the refusal headroom", () => {
    expect(playerCapBounds).toEqual({ min: 2, max: limits.room.playerSoftCap });
    expect(playerCapBounds.max).toBeLessThan(limits.room.playerHardCap);
    expect(createFormProblems(formOf({ ...named, maxPlayers: 1 }))[0]?.field).toBe("maxPlayers");
    expect(createFormProblems(formOf({ ...named, maxPlayers: 101 }))[0]?.field).toBe("maxPlayers");
    expect(
      createFormProblems(formOf({ ...named, maxPlayers: limits.room.playerHardCap }))[0]?.field,
    ).toBe("maxPlayers");
    // A number input handed back a non-integer (or an empty box) must not sail through.
    expect(createFormProblems(formOf({ ...named, maxPlayers: Number.NaN }))[0]?.field).toBe(
      "maxPlayers",
    );
    expect(createFormProblems(formOf({ ...named, maxPlayers: 100 }))).toEqual([]);
    expect(createFormProblems(formOf({ ...named, maxPlayers: 2 }))).toEqual([]);
  });

  it("names the bound it enforces, so the refusal is actionable without guessing", () => {
    const message = createFormProblems(formOf({ ...named, maxPlayers: 500 }))[0]?.message ?? "";
    expect(message).toContain("2");
    expect(message).toContain("100");
    expect(message).not.toContain(String(limits.room.playerHardCap));
  });
});

describe("clamping the player cap", () => {
  it("pulls anything typed or pasted back inside the bounds", () => {
    expect(clampPlayerCap(500)).toBe(playerCapBounds.max);
    expect(clampPlayerCap(limits.room.playerHardCap)).toBe(playerCapBounds.max);
    expect(clampPlayerCap(0)).toBe(playerCapBounds.min);
    expect(clampPlayerCap(-12)).toBe(playerCapBounds.min);
  });

  it("rounds a fractional spinner value instead of carrying it into the payload", () => {
    expect(clampPlayerCap(12.4)).toBe(12);
    expect(clampPlayerCap(12.6)).toBe(13);
  });

  it("treats an emptied box as the full house rather than as zero players", () => {
    expect(clampPlayerCap(Number.NaN)).toBe(playerCapBounds.max);
    expect(clampPlayerCap(Number.POSITIVE_INFINITY)).toBe(playerCapBounds.max);
  });

  it("leaves a legal value exactly as typed", () => {
    expect(clampPlayerCap(24)).toBe(24);
  });
});

describe("the request body", () => {
  const game = { kind: "compact", rounds: [{ columns: 3, rows: 3 }] };

  it("omits empty optionals rather than sending schema-invalid empty strings", () => {
    const body = createRoomBody(formOf({ title: "  ", hostLabel: "" }), game);
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("hostLabel");
    expect(body).toMatchObject({ game, listing: "private", spectatorsAllowed: true });
  });

  it("trims what it does send, so a stray space never becomes a room's name", () => {
    const body = createRoomBody(
      formOf({ title: "  Pub quiz  ", hostLabel: " Board Game Club " }),
      game,
    );
    expect(body).toMatchObject({
      title: "Pub quiz",
      hostLabel: "Board Game Club",
    });
  });

  // The owner report behind the round-trip test in routes/api/rooms/rooms-endpoint.test.ts:
  // "I made a public room but settings said it was private. Also didn't carry title or host
  // name." This is the first link of that chain - what the form actually puts on the wire.
  it("carries listing, title and host label together for a public room", () => {
    const body = createRoomBody(
      formOf({ listing: "public", title: "Pub quiz", hostLabel: "Board Game Club" }),
      game,
    );
    expect(body).toMatchObject({
      listing: "public",
      title: "Pub quiz",
      hostLabel: "Board Game Club",
    });
  });

  it("sends a cap the protocol will accept, whatever the field was left holding", () => {
    expect(createRoomBody(formOf({ ...named, maxPlayers: 42 }), game)).toMatchObject({
      maxPlayers: 42,
    });
  });
});

function responseOf(
  listing: "public" | "private",
  registry: CreateRoomResponse["registry"],
): CreateRoomResponse {
  return {
    code: "BQKX7",
    hostToken: "0".repeat(32),
    expiresAt: Date.now() + 7_200_000,
    settings: {
      listing,
      maxPlayers: 100,
      maxSpectators: 50,
      spectatorsAllowed: true,
      hideJoinCode: false,
      title: "Pub quiz",
      hostLabel: "",
    },
    registry,
  };
}

describe("what happens with the answer", () => {
  it("hands off straight to the console when the room is what was asked for", () => {
    expect(handOffAfterCreate(responseOf("private", { status: "ok" })).handOff).toBe(true);
    expect(handOffAfterCreate(responseOf("public", { status: "ok" })).handOff).toBe(true);
    // A private room never wanted a lobby row, so a broken registry is not its problem.
    expect(
      handOffAfterCreate(responseOf("private", { status: "unavailable", reason: "no-table" }))
        .handOff,
    ).toBe(true);
  });

  it("STOPS when a public room could not be listed, and says so with its code", () => {
    const decision = handOffAfterCreate(
      responseOf("public", { status: "unavailable", reason: "no-table" }),
    );
    expect(decision.handOff).toBe(false);
    expect(decision.warning).toContain("BQKX7");
    expect(decision.warning).toContain("joinable by code");
  });
});

describe("refusals in the words of the person who tried", () => {
  it("names the deployment problem behind a missing room binding", () => {
    expect(describeCreateFailure(503, "realtime-binding-unavailable")).toContain("no room binding");
  });

  it("falls back to the status code rather than to silence", () => {
    expect(describeCreateFailure(500, null)).toContain("500");
  });
});

describe("withPlayerMode - the teams choice, written onto the GAME", () => {
  it("turns the sample game into a teams game through a rules override", () => {
    const teamed = withPlayerMode(sampleGameDefinition.body, "teams");
    // The room learns teams mode by resolving the definition's rules, exactly as it resolves
    // every other rule - there is no room-level teams flag to disagree with this one.
    expect(resolveGameRules(teamed.rules).teams.playerMode).toBe("teams");
    // ...and the rest of the game is untouched: same board, same value scheme, same theme.
    expect(teamed.rounds).toEqual(sampleGameDefinition.body.rounds);
    expect(teamed.valueScheme).toEqual(sampleGameDefinition.body.valueScheme);
  });

  it("writes mixed, which is neither of the other two and not derivable from them", () => {
    const mixed = withPlayerMode(sampleGameDefinition.body, "mixed");
    expect(resolveGameRules(mixed.rules).teams.playerMode).toBe("mixed");
    expect(teamsAreOffered("mixed")).toBe(true);
    expect(teamsAreRequired("mixed")).toBe(false);
  });

  it("leaves individuals as the mode when that is what was chosen", () => {
    const solo = withPlayerMode(sampleGameDefinition.body, "individuals");
    expect(resolveGameRules(solo.rules).teams.playerMode).toBe("individuals");
  });

  it("keeps the other overrides a game already carried", () => {
    const carrying = {
      ...sampleGameDefinition.body,
      rules: {
        kind: "preset" as const,
        preset: "casual-party" as const,
        overrides: { buzzing: { lockoutMs: 250 } },
      },
    };
    const teamed = withPlayerMode(carrying, "teams");
    if (teamed.rules.kind !== "preset") throw new Error("the rules stopped being a preset");
    expect(teamed.rules.overrides.buzzing).toEqual({ lockoutMs: 250 });
    expect(teamed.rules.overrides.teams).toEqual({ playerMode: "teams" });
  });

  it("never edits an embedded RULE SET - that document is somebody else's authored rules", () => {
    const authored = {
      ...sampleGameDefinition.body,
      rules: {
        kind: "inline" as const,
        ruleSet: ruleSetSchema.parse({
          format: "rule-set",
          schemaVersion: "1.0.0",
          meta: {
            title: "House rules",
            created: "2026-08-19T00:00:00.000Z",
            modified: "2026-08-19T00:00:00.000Z",
          },
          body: { base: "casual-party", overrides: {} },
        }),
      },
    };
    expect(withPlayerMode(authored, "teams")).toEqual(authored);
  });
});
