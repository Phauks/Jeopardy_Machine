// The front page's create form, as logic rather than as markup: what a host may type, what
// the server is asked for, and what happens with the answer.
//
// Creating a room is a FIRST-CLASS front-door action (docs/decisions/2026-08-16-persistent-
// layout-and-pregame-rework.md: "Nobody should have to find /dev/rooms to start a game"), so
// the rules that decide whether the button works have to be as testable as the endpoint they
// call. Everything here is pure: no fetch, no storage, no navigation.
//
// The validation duplicates the protocol's schema on purpose, and only where a refusal would
// otherwise arrive as an opaque 400: the room's OWN rules are still the server's
// (packages/protocol/src/room/create.ts is authority). This exists so a four-character
// password floor is a sentence under the field rather than a bad-request after the tap.
import { limits } from "@jeopardy/protocol/limits";
import type { CreateRoomResponse } from "@jeopardy/protocol/room/create";

export type CreateRoomForm = {
  title: string;
  hostLabel: string;
  listing: "public" | "private";
  /** Empty = an open room. Any other value makes the room password-entry. */
  password: string;
  maxPlayers: number;
  spectatorsAllowed: boolean;
};

/** Every control on the form is editable afterwards from the host console, so the opening
 * position is allowed to be small: a private, open room for a hundred people. */
export function blankCreateForm(): CreateRoomForm {
  return {
    title: "",
    hostLabel: "",
    listing: "private",
    password: "",
    maxPlayers: limits.room.playerSoftCap,
    spectatorsAllowed: true,
  };
}

export type CreateProblem = {
  field: "title" | "password" | "maxPlayers";
  message: string;
};

/**
 * What is wrong with this form right now. Empty = the button works.
 *
 * The title rule is the interesting one and it is NOT "a room needs a name": a private room
 * genuinely does not - nobody but its own players ever reads it. A public room does, because
 * an unnamed row in a server browser is noise rather than an invitation. Same rule the
 * protocol enforces, said here in words instead of as a 400.
 */
export function createFormProblems(form: CreateRoomForm): CreateProblem[] {
  const problems: CreateProblem[] = [];
  const title = form.title.trim();

  if (form.listing === "public" && title === "") {
    problems.push({
      field: "title",
      message: "A public room needs a name - it is the line people read in the list.",
    });
  }
  if (title.length > limits.room.roomTitleMaxLength) {
    problems.push({
      field: "title",
      message: `Room name is longer than ${String(limits.room.roomTitleMaxLength)} characters.`,
    });
  }
  if (form.password !== "" && form.password.length < limits.room.roomPasswordMinLength) {
    problems.push({
      field: "password",
      message: `A password needs at least ${String(limits.room.roomPasswordMinLength)} characters, or leave it empty for an open room.`,
    });
  }
  if (form.password.length > limits.room.roomPasswordMaxLength) {
    problems.push({
      field: "password",
      message: `Passwords stop at ${String(limits.room.roomPasswordMaxLength)} characters.`,
    });
  }
  if (
    !Number.isInteger(form.maxPlayers) ||
    form.maxPlayers < 1 ||
    form.maxPlayers > limits.room.playerHardCap
  ) {
    problems.push({
      field: "maxPlayers",
      message: `Between 1 and ${String(limits.room.playerHardCap)} players.`,
    });
  }
  return problems;
}

/**
 * The POST body. `game` is passed in rather than imported: the sample game definition drags
 * the engine and the whole content schema behind it, and the front door must not carry that
 * weight for the visitors who only came to type a code (the route imports it dynamically at
 * the moment of the tap).
 *
 * Empty optional strings are omitted rather than sent: `hostLabel: ""` and `title: ""` are
 * schema-invalid, and "the host did not say who they are" is a real, rendered state in the
 * lobby row rather than an empty string to store.
 */
export function createRoomBody(form: CreateRoomForm, game: unknown): Record<string, unknown> {
  const title = form.title.trim();
  const hostLabel = form.hostLabel.trim();
  return {
    game,
    listing: form.listing,
    ...(title === "" ? {} : { title }),
    ...(hostLabel === "" ? {} : { hostLabel }),
    ...(form.password === "" ? {} : { password: form.password }),
    maxPlayers: form.maxPlayers,
    spectatorsAllowed: form.spectatorsAllowed,
  };
}

/**
 * The room exists - now what? Usually: walk straight into the host console, because a create
 * button that lands you on a confirmation screen is a wizard step nobody asked for.
 *
 * The exception is the failure this whole registry-status apparatus exists for (owner report
 * 2026-08-14): a host who asked for a PUBLIC room and got a room nobody can find must be told
 * so, at the moment it happens, on the surface that promised the listing. Navigating away
 * would replace that sentence with a host console that looks perfectly normal.
 */
export function handOffAfterCreate(response: CreateRoomResponse): {
  handOff: boolean;
  warning: string | null;
} {
  if (response.settings.listing !== "public" || response.registry.status === "ok") {
    return { handOff: true, warning: null };
  }
  return {
    handOff: false,
    warning: `Room ${response.code} is live and joinable by code, but it could NOT be added to the public list.`,
  };
}

/** A create that did not happen, in the words of the person who tried. */
export function describeCreateFailure(status: number, error: string | null): string {
  if (error === "realtime-binding-unavailable") {
    return "This server cannot host rooms: it has no room binding. Rooms need the single-origin loop (docs/DEVELOPMENT.md) or a real deployment.";
  }
  if (error === "no-code-available") {
    return "Every room code drawn was already taken - vanishingly unlikely, and fixed by trying again.";
  }
  if (error === "bad-request") {
    return "The room settings were refused as malformed. That is a bug in this page, not in what you typed.";
  }
  if (error === "initialize-failed") {
    return "The room server refused to start the room. Try again; if it keeps failing, the realtime Worker is unhealthy.";
  }
  return `Creating the room failed (${String(status)}).`;
}
