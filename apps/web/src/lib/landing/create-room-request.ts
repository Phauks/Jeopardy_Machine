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
import type { GameDefinitionBody } from "@jeopardy/protocol";

export type CreateRoomForm = {
  title: string;
  hostLabel: string;
  listing: "public" | "private";
  /** Empty = an open room. Any other value makes the room password-entry. */
  password: string;
  maxPlayers: number;
  spectatorsAllowed: boolean;
  /**
   * Individuals or teams. It is NOT a room setting: whether a game is played in teams is a
   * RULE, and rules live in the game document (the design law, docs/design/expansion-and-
   * boundaries.md). So this control does not add a field to the room - it writes a settings
   * override onto the game definition being hosted, and the room learns teams mode the same
   * way it learns everything else about the game (`withPlayerMode` below).
   */
  playerMode: "individuals" | "teams";
};

/**
 * The form a host opens on: private, open, full house. Every control is editable afterwards
 * from the host console, so these are opening positions rather than commitments.
 *
 * Name and host start EMPTY and are required (createFormProblems), so the button starts
 * disabled - two fields is the whole price of admission, and a room with no name is a room
 * nobody can refer to afterwards.
 */
export function blankCreateForm(): CreateRoomForm {
  return {
    title: "",
    hostLabel: "",
    listing: "private",
    password: "",
    maxPlayers: playerCapBounds.max,
    spectatorsAllowed: true,
    // Individuals, which is also the settings registry's default (packages/protocol/src/
    // settings/groups/teams.ts) - so the opening position of the form and the opening position
    // of an unmodified game agree.
    playerMode: "individuals",
  };
}

export type CreateProblem = {
  field: "title" | "hostLabel" | "password" | "maxPlayers";
  message: string;
};

/**
 * The bounds the player-cap field may be set to, and the ones it SHOWS.
 *
 * The ceiling is the SOFT cap, not the hard one (@jeopardy/protocol/limits): the hard cap is
 * refusal headroom so a team rebalance never bounces player 101 of a full room, and it was
 * never a number a host is invited to type. 2-100 is the product promise, so 2-100 is what the
 * field accepts and what it prints beside itself - a control whose maximum is a secret is how
 * the field ended up taking 128 (owner report 2026-08-17).
 */
export const playerCapBounds = { min: 2, max: limits.room.playerSoftCap } as const;

/**
 * A typed player cap, brought inside the bounds. A number input hands back anything - an empty
 * box (NaN), a pasted 5000, a fractional value from a spinner - and hosts tune DOWN, never up
 * (docs/design/expansion-and-boundaries.md boundary 2.7), so the field clamps rather than
 * arguing. Called on commit (change/blur) rather than per keystroke: clamping mid-typing turns
 * "1" on the way to "15" into "2" and eats the next digit.
 */
export function clampPlayerCap(value: number): number {
  if (!Number.isFinite(value)) return playerCapBounds.max;
  return Math.min(Math.max(Math.round(value), playerCapBounds.min), playerCapBounds.max);
}

/**
 * What is wrong with this form right now. Empty = the button works.
 *
 * Name and host are BOTH unconditionally required (owner call 2026-08-17). They used to be
 * public-only, on the reasoning that nobody but a private room's own players ever reads them -
 * which was wrong twice over: the host console, the display's title card and this tab's rejoin
 * offer all render them for a private room too, and a conditional requirement means the field
 * a host skipped becomes mandatory later, when they flip the room public mid-game. One rule,
 * always, is both simpler to obey and simpler to state.
 */
export function createFormProblems(form: CreateRoomForm): CreateProblem[] {
  const problems: CreateProblem[] = [];
  const title = form.title.trim();
  const hostLabel = form.hostLabel.trim();

  if (title === "") {
    problems.push({ field: "title", message: "Give the room a name." });
  }
  if (title.length > limits.room.roomTitleMaxLength) {
    problems.push({
      field: "title",
      message: `Room name is longer than ${String(limits.room.roomTitleMaxLength)} characters.`,
    });
  }
  if (hostLabel === "") {
    problems.push({ field: "hostLabel", message: "Say who is hosting." });
  }
  if (hostLabel.length > limits.room.hostLabelMaxLength) {
    problems.push({
      field: "hostLabel",
      message: `Host name is longer than ${String(limits.room.hostLabelMaxLength)} characters.`,
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
    form.maxPlayers < playerCapBounds.min ||
    form.maxPlayers > playerCapBounds.max
  ) {
    problems.push({
      field: "maxPlayers",
      message: `Between ${String(playerCapBounds.min)} and ${String(playerCapBounds.max)} players.`,
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
 * Empty strings are omitted rather than sent, which `createFormProblems` now makes unreachable
 * from the UI and which stays here anyway: `title: ""` and `hostLabel: ""` are schema-invalid
 * (packages/protocol/src/room/visibility.ts), so a caller that skips the form must fail the
 * server's own refusal rather than write an empty name into a lobby row.
 */
/**
 * Return the game definition body this room should be created with, carrying the host's
 * individuals-or-teams choice as a RULES OVERRIDE on the document.
 *
 * This is the whole implementation of the teams control, and it is deliberately not a room
 * field. Teams mode is matrix row 34 - a rule of the game (packages/protocol/src/settings/
 * groups/teams.ts), which the room reads from the definition it was created with and reports
 * to every client as `teamsMode`. A parallel room-level flag would be a second source of truth
 * for the same fact and would leave a downloaded game playing differently than it did here.
 *
 * A definition carrying a whole inline RULE SET (`rules.kind === "inline"`) rather than a
 * preset is left alone: that
 * document is somebody's authored rules, and quietly overriding a field inside it would be the
 * front door editing a document it did not write. Such a game plays in whatever mode its rule
 * set says, and the control has nothing to add - which is why the form's choice is an opening
 * position on the games the front door itself offers, not a promise about every file.
 */
export function withPlayerMode(
  body: GameDefinitionBody,
  playerMode: CreateRoomForm["playerMode"],
): GameDefinitionBody {
  if (body.rules.kind !== "preset") return body;
  return {
    ...body,
    rules: {
      ...body.rules,
      overrides: {
        ...body.rules.overrides,
        teams: { ...body.rules.overrides.teams, playerMode },
      },
    },
  };
}

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
