// What a refused player is told, in words.
//
// The room protocol refuses with a REASON, not a sentence (`refusalReasonSchema` in
// packages/protocol/src/room/server-messages.ts) - the right split, because the server should
// not be writing copy and the phone should not be guessing why. This module is the one place
// the vocabulary becomes English, so the character screen, the team screen and the lobby all
// say the same thing about the same fact.
//
// Two rules the copy follows, both from the room-controls decision
// (docs/decisions/2026-08-14-room-controls-and-staging.md):
//
// 1. NEVER SHOW THE CODE. "room-full" and "spectators-full" are different from
//    "spectators-not-allowed" on purpose - a person turned away deserves to know whether to
//    wait a minute or to stop trying - and none of them is a protocol string on screen.
// 2. NEVER BLAME THE PLAYER. A full room, a locked team and a wrong password are all facts
//    about the room; the sentence says what happened and, where there is one, what to do.
import type { RefusalReason } from "@jeopardy/protocol/room/server-messages";
import type { RoomView } from "#lib/room/room-view.ts";

/** The refusal as a phone shows it: a headline plus, when there is one, the way forward. */
export type RefusalCopy = {
  headline: string;
  advice: string | null;
};

/**
 * Exhaustive by construction: the switch has no default, so a reason added to the protocol
 * enum fails to compile here rather than reaching a player as a raw string.
 */
export function refusalCopy(reason: RefusalReason): RefusalCopy {
  switch (reason) {
    case "no-such-room":
      return {
        headline: "That room is not here",
        advice: "Check the code with whoever is hosting - rooms close when everyone leaves.",
      };
    case "room-full":
      return {
        headline: "This room is full",
        advice: "The host set a limit on players. Ask them to raise it, or wait for a seat.",
      };
    case "spectators-full":
      return {
        headline: "The audience is full",
        advice: "Try again in a minute - watching spots free up as people leave.",
      };
    case "spectators-not-allowed":
      return {
        headline: "This host is not taking spectators",
        advice: "Ask them for a player seat instead.",
      };
    case "late-join-disabled":
      return {
        headline: "This game has already started",
        advice: "The host chose not to take late arrivals. Catch the next one.",
      };
    case "team-locked":
      return { headline: "That team is locked", advice: "Pick another team, or play on your own." };
    case "unknown-team":
      return { headline: "That team is gone", advice: "It was disbanded - pick another one." };
    case "teams-full":
      return {
        headline: "This room has all the teams it can hold",
        advice: "Join one of the teams that is already here.",
      };
    case "password-required":
      return { headline: "This room needs a password", advice: "The host has it." };
    case "bad-password":
      return { headline: "That password did not work", advice: "Try again, carefully." };
    // The token refusals are device-level accidents (a stale tab, a copied link), never
    // something a player did wrong - and never a reason to explain tokens to anybody.
    case "bad-host-token":
      return { headline: "This host link is no longer valid", advice: "Open the room again." };
    case "bad-session-token":
      return {
        headline: "This device lost its seat",
        advice: "Join again - your name and colours are still yours to pick.",
      };
  }
}

/**
 * Why this phone cannot take a seat right now, BEFORE it tries - or null when it can.
 *
 * A courtesy, never the authority: the room itself refuses on join regardless (the roster the
 * view carries can be a moment stale, and only the DO counts spectators, which hold no seat).
 * Its job is to disable a button with an explanation instead of letting a player fill in a
 * name, tap join, and be turned away by the same fact that was visible all along.
 */
/**
 * Is this connection standing outside a password door?
 *
 * Both password refusals KEEP the socket open (packages/protocol/src/room/server-messages.ts)
 * precisely so a phone can prompt and retry on it. This is the predicate that turns that
 * allowance into a screen: `needsPassword` means "ask", and `wasWrong` is the difference
 * between the first ask and a retry, which have to read differently or a second wrong attempt
 * looks like a screen that ignored you.
 */
export function passwordPrompt(
  view: RoomView,
): { needsPassword: true; wasWrong: boolean } | { needsPassword: false } {
  const reason = view.refusal?.reason;
  if (reason === "password-required") return { needsPassword: true, wasWrong: false };
  if (reason === "bad-password") return { needsPassword: true, wasWrong: true };
  return { needsPassword: false };
}

export function joinBlock(view: RoomView): RefusalCopy | null {
  if (view.role === "spectator") {
    return view.settings.spectatorsAllowed ? null : refusalCopy("spectators-not-allowed");
  }
  // Already seated: a cap that filled up behind you never pushes you out (nobody is ever
  // ejected by a settings edit - room-settings.ts).
  if (view.myPlayerId !== null) return null;
  if (view.roster.players.length >= view.settings.maxPlayers) return refusalCopy("room-full");
  return null;
}
