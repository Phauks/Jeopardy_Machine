// GETTING PEOPLE IN: the three ways a room code travels, in one place.
//
// A quiz night starts with a host holding a laptop and thirty people who need to be in the room
// in under a minute. There are exactly three paths that work in a real room, and the console has
// to offer all three because which one wins depends on where people are standing:
//
//   the QR      for anyone who can see the screen. The fastest path, no typing at all.
//   the link    for anyone who cannot - the group chat, the WhatsApp thread, the person who
//               arrived late. Share sheet on a laptop with one, clipboard everywhere else.
//   the code    for the room being read to, and for the person whose camera will not focus.
//
// Everything here is pure so the copy and the fallback chain are testable in node; the panel
// that renders them is join-panel.svelte.

/**
 * The join URL - the player route, and nothing else on it.
 *
 * Never a token, never a password, never a nickname (packages/protocol/src/room/client-messages.ts
 * states the same rule for the wire): this string is pasted into group chats, printed on QR codes,
 * and read out loud, and every one of those is a place a secret would end up in public.
 */
export function joinUrlFor(origin: string | null, roomCode: string): string {
  const base = origin === null ? "" : origin.replace(/\/+$/, "");
  return `${base}/room/${roomCode.toUpperCase()}`;
}

/**
 * Is this URL something a CAMERA can act on?
 *
 * The bug this exists to make impossible (owner, 2026-08-20: "the qr code is inaccurate. It
 * only shows the join code, not the source url"): with no origin, `joinUrlFor` returns the
 * bare path `/room/BQKX7`, which is correct for an `href` and useless in a QR - a phone
 * scanning it gets a string of text with nowhere to go. Both surfaces fell back to the
 * ambient `location.origin`, which does not exist during SSR, so the SERVER-RENDERED markup
 * always encoded the path. The routes now pass `page.url.origin`, which is right in both
 * places; this predicate is the belt, because the failure is silent - the QR renders, it
 * scans, and it simply does not go anywhere.
 */
export function isScannableJoinUrl(joinUrl: string): boolean {
  return /^https?:\/\/[^/]+\/room\/[A-Z0-9]+$/.test(joinUrl);
}

/** The URL as it is READ rather than clicked - no scheme, because nobody says "h-t-t-p-s". */
export function joinUrlLabel(joinUrl: string): string {
  return joinUrl.replace(/^https?:\/\//, "");
}

/**
 * What goes on the clipboard or into the share sheet: the link AND the code, because the two
 * fail differently. A pasted link is one tap and dies behind a link-scanner; a typed code
 * survives anything, including being read down a phone line.
 */
export function joinShareText(roomCode: string, joinUrl: string): string {
  return `Join the quiz: ${joinUrl} (room code ${roomCode.toUpperCase()})`;
}

/**
 * The outcome of the one share button, in the host's terms rather than the API's.
 *
 * `dismissed` is separated from `unavailable` on purpose: a host who opened the share sheet and
 * changed their mind must not be told the copy failed, and a browser with no share sheet and no
 * clipboard must not be told nothing happened. Both are ordinary; only one deserves advice.
 */
export type ShareOutcome = "shared" | "copied" | "dismissed" | "unavailable";

/** The slice of `navigator` this needs - injected, so every branch below is testable in node. */
export type ShareTarget = {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  canShare?: (data: { title?: string; text?: string; url?: string }) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/**
 * Share the room, preferring the native share sheet and falling back to the clipboard.
 *
 * Share sheet FIRST because the natural path in a room is phone-to-phone: the host's laptop or
 * tablet hands the link to Messages/WhatsApp/AirDrop in one gesture, which is what people
 * actually do. It is also the only path that reaches a person who is not in the room. Clipboard
 * is the desktop answer and the universal fallback; a browser with neither says so, and the code
 * and QR on the panel still work, which is why this never throws.
 */
export async function shareJoinLink(
  target: ShareTarget | null,
  payload: { roomCode: string; joinUrl: string },
): Promise<ShareOutcome> {
  const text = joinShareText(payload.roomCode, payload.joinUrl);
  const data = { title: `Room ${payload.roomCode.toUpperCase()}`, text, url: payload.joinUrl };
  if (target?.share !== undefined && (target.canShare === undefined || target.canShare(data))) {
    try {
      await target.share(data);
      return "shared";
    } catch (error) {
      // AbortError is the host closing the sheet - an outcome, not a failure. Anything else
      // (a permissions policy, a hostile embed) falls through to the clipboard rather than
      // leaving the host with nothing.
      if (error instanceof Error && error.name === "AbortError") return "dismissed";
    }
  }
  if (target?.clipboard !== undefined) {
    try {
      await target.clipboard.writeText(text);
      return "copied";
    } catch {
      return "unavailable";
    }
  }
  return "unavailable";
}

/** Copy the link alone (the "paste it somewhere" button, no share sheet in the way). */
export async function copyJoinLink(
  target: ShareTarget | null,
  joinUrl: string,
): Promise<ShareOutcome> {
  if (target?.clipboard === undefined) return "unavailable";
  try {
    await target.clipboard.writeText(joinUrl);
    return "copied";
  } catch {
    return "unavailable";
  }
}

/** One sentence per outcome, so the button's own status line never invents copy. */
export function shareOutcomeLine(outcome: ShareOutcome): string {
  switch (outcome) {
    case "shared":
      return "Shared.";
    case "copied":
      return "Link copied.";
    case "dismissed":
      return "Nothing shared.";
    case "unavailable":
      return "This browser will not copy - read the code out instead.";
  }
}
