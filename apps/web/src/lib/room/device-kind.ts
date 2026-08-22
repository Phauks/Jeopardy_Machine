// WHAT KIND OF THING IS THIS, in the only terms a host cares about.
//
// Owner, 2026-08-20: "show in roster whether users are on mobile or computers." A host
// scanning a roster before starting is asking whether somebody is holding a buzzer they can
// hit with a thumb or sitting at a keyboard - because that is what predicts a slow buzz, a
// shared screen, or a person who wandered off with a tab open.
//
// WHY NOT THE USER AGENT. It is the obvious answer and it is the wrong one twice over. The
// server could read it without asking, but user-agent strings are a decades-long history of
// programs lying to each other about what they are, iPads have claimed to be desktops by
// default for years, and every "is mobile" regex ever written is a list of yesterday's
// devices. It is also more than was asked for: a UA string is a fingerprint, and this product
// has no accounts precisely so it holds nothing about anyone.
//
// WHAT THIS USES INSTEAD is the browser's own answer to the question actually being asked.
// `pointer: coarse` means the primary input is a finger, and `hover: none` means it cannot
// hover - together they describe a touch device rather than a brand of one. A laptop with a
// touchscreen reports a fine pointer AND hover, because its primary input is still the
// trackpad, which is exactly the right answer for a host reading a roster.
//
// It is a hint, not an identity: it says how somebody is holding the thing, and a person who
// switches devices simply reports the new one on their next join.
import type { DeviceKind } from "@jeopardy/protocol/room/identity";

/**
 * This browser's kind, or undefined when nothing can be known - SSR, a headless test, or an
 * environment without `matchMedia`.
 *
 * Undefined rather than a default, because "did not say" is a real answer the roster renders
 * as nothing. Guessing "computer" for every server render would put a wrong device beside
 * every name on the first paint and then correct itself, which is worse than a blank.
 */
export function detectDeviceKind(): DeviceKind | undefined {
  const query = globalThis.matchMedia as typeof globalThis.matchMedia | undefined;
  if (typeof query !== "function") return undefined;
  try {
    // Both halves, and AND rather than OR: a coarse pointer alone catches a TV remote and a
    // games console, and no-hover alone catches some styluses. The pair is what says "a
    // finger on a screen somebody is holding".
    const coarse = query.call(globalThis, "(pointer: coarse)").matches;
    const cannotHover = query.call(globalThis, "(hover: none)").matches;
    return coarse && cannotHover ? "phone" : "computer";
  } catch {
    // A browser that refuses the query is one that cannot answer, which is the same state as
    // not having been asked. Never worth failing a join over.
    return undefined;
  }
}
