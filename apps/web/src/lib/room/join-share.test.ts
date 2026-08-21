// Getting people in: the join URL, and the share-sheet-then-clipboard chain behind one button.
import { describe, expect, it, vi } from "vitest";
import {
  copyJoinLink,
  joinShareText,
  isScannableJoinUrl,
  joinUrlFor,
  joinUrlLabel,
  shareJoinLink,
  shareOutcomeLine,
} from "#lib/room/join-share.ts";
import type { ShareOutcome } from "#lib/room/join-share.ts";

describe("the join URL", () => {
  it("is the player route on this origin, upper-cased, with nothing else on it", () => {
    expect(joinUrlFor("https://play.test", "bqkx7")).toBe("https://play.test/room/BQKX7");
    expect(joinUrlFor("https://play.test/", "BQKX7")).toBe("https://play.test/room/BQKX7");
    expect(joinUrlFor(null, "BQKX7")).toBe("/room/BQKX7");
  });

  it("is read without its scheme - nobody says h-t-t-p-s across a room", () => {
    expect(joinUrlLabel("https://play.test/room/BQKX7")).toBe("play.test/room/BQKX7");
  });

  it("shares the link AND the code, because the two fail differently", () => {
    const text = joinShareText("bqkx7", "https://play.test/room/BQKX7");
    expect(text).toContain("https://play.test/room/BQKX7");
    expect(text).toContain("BQKX7");
  });
});

// Owner report 2026-08-20: "the qr code is inaccurate. It only shows the join code, not the
// source url." Root cause: both surfaces fell back to the ambient `location.origin`, which
// does not exist during SSR, so the SERVER-RENDERED markup encoded the bare path `/room/BQKX7`.
// That QR scans perfectly and goes nowhere, which is worse than no QR at all - the picture
// looks right, so nobody checks it until thirty people are standing there.
//
// Both routes now pass `page.url.origin`, which is correct in SSR and in the browser alike.
// This predicate is the belt: no origin means no QR and a sentence saying so.
describe("what a camera can actually act on", () => {
  it("accepts the absolute join URL and refuses the bare path", () => {
    expect(isScannableJoinUrl("https://play.test/room/BQKX7")).toBe(true);
    expect(isScannableJoinUrl("http://localhost:5173/room/BQKX7")).toBe(true);
    expect(isScannableJoinUrl(joinUrlFor(null, "BQKX7"))).toBe(false);
    expect(isScannableJoinUrl("/room/BQKX7")).toBe(false);
  });

  it("refuses anything that is not exactly a join URL, scheme included", () => {
    expect(isScannableJoinUrl("ws://play.test/room/BQKX7")).toBe(false);
    expect(isScannableJoinUrl("https://play.test/room/BQKX7/host")).toBe(false);
    expect(isScannableJoinUrl("https://play.test/")).toBe(false);
    expect(isScannableJoinUrl("")).toBe(false);
  });

  it("is satisfied by what joinUrlFor builds from a real origin", () => {
    expect(isScannableJoinUrl(joinUrlFor("https://play.test", "bqkx7"))).toBe(true);
    expect(isScannableJoinUrl(joinUrlFor("https://play.test/", "BQKX7"))).toBe(true);
  });
});

describe("one share button, three browsers", () => {
  const payload = { roomCode: "BQKX7", joinUrl: "https://play.test/room/BQKX7" };

  it("prefers the share sheet - the phone-to-phone path into a group chat", async () => {
    const shared: { url?: string; text?: string }[] = [];
    const share = vi.fn(async (data: { url?: string; text?: string }) => {
      shared.push(data);
    });
    const writeText = vi.fn(async () => undefined);
    expect(await shareJoinLink({ share, clipboard: { writeText } }, payload)).toBe("shared");
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(shared[0]?.url).toBe(payload.joinUrl);
    // The code rides along in the text, because a link can die behind a scanner and a typed
    // code cannot.
    expect(shared[0]?.text).toContain(payload.roomCode);
  });

  it("falls back to the clipboard where there is no share sheet", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await shareJoinLink({ clipboard: { writeText } }, payload)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(joinShareText(payload.roomCode, payload.joinUrl));
  });

  it("treats a closed share sheet as an outcome, not a failure", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const writeText = vi.fn(async () => undefined);
    const outcome = await shareJoinLink(
      {
        share: async () => {
          throw abort;
        },
        clipboard: { writeText },
      },
      payload,
    );
    expect(outcome).toBe("dismissed");
    // Dismissing must not silently copy instead - the host chose not to share.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls through to the clipboard when the share sheet fails for any other reason", async () => {
    const writeText = vi.fn(async () => undefined);
    const outcome = await shareJoinLink(
      {
        share: async () => {
          throw new Error("permissions policy");
        },
        clipboard: { writeText },
      },
      payload,
    );
    expect(outcome).toBe("copied");
  });

  it("never throws when the browser offers neither - the QR and the code still work", async () => {
    expect(await shareJoinLink(null, payload)).toBe("unavailable");
    expect(await shareJoinLink({}, payload)).toBe("unavailable");
    expect(
      await shareJoinLink(
        {
          clipboard: {
            writeText: async () => {
              throw new Error("denied");
            },
          },
        },
        payload,
      ),
    ).toBe("unavailable");
  });

  it("respects canShare when the browser offers it", async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    const outcome = await shareJoinLink(
      { share, canShare: () => false, clipboard: { writeText } },
      payload,
    );
    expect(outcome).toBe("copied");
    expect(share).not.toHaveBeenCalled();
  });

  it("copies the bare link when the host asked to copy rather than share", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyJoinLink({ clipboard: { writeText } }, payload.joinUrl)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(payload.joinUrl);
    expect(await copyJoinLink(null, payload.joinUrl)).toBe("unavailable");
  });

  it("has a sentence for every outcome, and advice only where advice helps", () => {
    const outcomes: ShareOutcome[] = ["shared", "copied", "dismissed", "unavailable"];
    for (const outcome of outcomes) expect(shareOutcomeLine(outcome).length).toBeGreaterThan(0);
    expect(shareOutcomeLine("unavailable")).toContain("code");
  });
});
