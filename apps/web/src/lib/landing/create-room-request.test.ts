// The create form's rules. These exist so a refusal is a sentence under a field rather than
// an opaque 400 after the tap - and so the one case that must NOT hand off (a public room the
// registry could not list) cannot be quietly "fixed" into a navigation later.
import { describe, expect, it } from "vitest";
import { limits } from "@jeopardy/protocol/limits";
import {
  blankCreateForm,
  createFormProblems,
  createRoomBody,
  describeCreateFailure,
  handOffAfterCreate,
} from "#lib/landing/create-room-request.ts";
import type { CreateRoomForm } from "#lib/landing/create-room-request.ts";
import type { CreateRoomResponse } from "@jeopardy/protocol/room/create";

function formOf(overrides: Partial<CreateRoomForm> = {}): CreateRoomForm {
  return { ...blankCreateForm(), ...overrides };
}

describe("create form validation", () => {
  it("opens on the safe default: a private, open room nobody has to name", () => {
    const form = blankCreateForm();
    expect(form.listing).toBe("private");
    expect(form.password).toBe("");
    expect(createFormProblems(form)).toEqual([]);
  });

  it("requires a name only for a public room - a private one is nobody else's business", () => {
    expect(createFormProblems(formOf({ listing: "private", title: "" }))).toEqual([]);
    const problems = createFormProblems(formOf({ listing: "public", title: "  " }));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.field).toBe("title");
    expect(problems[0]?.message).toContain("public room needs a name");
    expect(createFormProblems(formOf({ listing: "public", title: "Pub quiz" }))).toEqual([]);
  });

  it("holds the password floor, and treats empty as 'no password' rather than as too short", () => {
    expect(createFormProblems(formOf({ password: "" }))).toEqual([]);
    const tooShort = createFormProblems(formOf({ password: "ab" }));
    expect(tooShort[0]?.field).toBe("password");
    expect(tooShort[0]?.message).toContain(String(limits.room.roomPasswordMinLength));
    expect(createFormProblems(formOf({ password: "quizzy" }))).toEqual([]);
  });

  it("keeps the player cap inside the limits hosts cannot lift", () => {
    expect(createFormProblems(formOf({ maxPlayers: 0 }))[0]?.field).toBe("maxPlayers");
    expect(
      createFormProblems(formOf({ maxPlayers: limits.room.playerHardCap + 1 }))[0]?.field,
    ).toBe("maxPlayers");
    // A number input handed back a non-integer (or an empty box) must not sail through.
    expect(createFormProblems(formOf({ maxPlayers: Number.NaN }))[0]?.field).toBe("maxPlayers");
    expect(createFormProblems(formOf({ maxPlayers: limits.room.playerHardCap }))).toEqual([]);
  });
});

describe("the request body", () => {
  const game = { kind: "compact", rounds: [{ columns: 3, rows: 3 }] };

  it("omits empty optionals rather than sending schema-invalid empty strings", () => {
    const body = createRoomBody(formOf({ title: "  ", hostLabel: "", password: "" }), game);
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("hostLabel");
    expect(body).not.toHaveProperty("password");
    expect(body).toMatchObject({ game, listing: "private", spectatorsAllowed: true });
  });

  it("trims what it does send, so a stray space never becomes a room's name", () => {
    const body = createRoomBody(
      formOf({ title: "  Pub quiz  ", hostLabel: " Board Game Club ", password: "quizzy" }),
      game,
    );
    expect(body).toMatchObject({
      title: "Pub quiz",
      hostLabel: "Board Game Club",
      password: "quizzy",
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
      entry: "open",
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
