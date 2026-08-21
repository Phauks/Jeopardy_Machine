// Clue media, through every kind and both byte states. Server-rendered per the repo pattern.
//
// This is the surface half of the 2026-08-19 fix (owner: "pictures, videos, audio files, and
// other files must be renderable"). The room resolves a media id into a descriptor; these are
// the assertions that the descriptor becomes something a room can actually see - and that the
// one case with no bytes behind it degrades to words rather than to a broken frame.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import ClueMedia from "#lib/room/clue-media.svelte";
import type { ResolvedMedia } from "@jeopardy/protocol/room/server-messages";

function media(overrides: Partial<ResolvedMedia> = {}): ResolvedMedia {
  return {
    mediaId: "0198f00d-0002-7000-8000-000000000111",
    kind: "image",
    mime: "image/webp",
    alt: "A stand of very large trees",
    url: "https://media.test/trees.webp",
    ...overrides,
  };
}

function bodyOf(value: ResolvedMedia, props: Record<string, unknown> = {}): string {
  return render(ClueMedia, { props: { media: value, ...props } }).body;
}

describe("the four kinds all render as themselves", () => {
  it("paints an image, with its alt text on the element", () => {
    const body = bodyOf(media());
    expect(body).toContain("<img");
    expect(body).toContain('src="https://media.test/trees.webp"');
    expect(body).toContain('alt="A stand of very large trees"');
  });

  it("gives audio a player and keeps the description visible beside it", () => {
    const body = bodyOf(media({ kind: "audio", mime: "audio/mpeg", alt: "A birdsong recording" }));
    expect(body).toContain("<audio");
    expect(body).toContain("controls");
    // The description is not optional chrome: a sound clue is inaudible to part of the room.
    expect(body).toContain("A birdsong recording");
  });

  it("gives video a player", () => {
    const body = bodyOf(media({ kind: "video", mime: "video/mp4", alt: "A launch clip" }));
    expect(body).toContain("<video");
    expect(body).toContain("controls");
    expect(body).toContain("playsinline");
  });

  it("offers anything else by name and type rather than pretending to paint it", () => {
    const body = bodyOf(
      media({ kind: "file", mime: "application/pdf", alt: "The scoring rules, one page" }),
    );
    expect(body).toContain("The scoring rules, one page");
    expect(body).toContain("application/pdf");
    expect(body).toContain('href="https://media.test/trees.webp"');
    // A new tab, and safely: an authored document is not this origin's code.
    expect(body).toContain('rel="noopener noreferrer"');
  });
});

describe("no bytes is a state, not a failure", () => {
  const byteless = media({ url: undefined, alt: "A photograph of Wizard Island" });

  it("shows what was meant to be there instead of a broken frame", () => {
    const body = bodyOf(byteless);
    expect(body).toContain("A photograph of Wizard Island");
    expect(body).not.toContain("<img");
  });

  it("still says something when the asset carried no alt text at all", () => {
    // Silence would make the clue vanish for anyone who cannot see it, and "" as alt is how
    // that happens by accident.
    const body = bodyOf(media({ url: undefined, alt: undefined, kind: "audio" }));
    expect(body).toContain("audio");
    expect(body.includes("A audio for this clue") || body.includes("an audio")).toBe(true);
  });

  it("does the same for every kind - none of them assumes bytes", () => {
    for (const kind of ["image", "audio", "video", "file"] as const) {
      const body = bodyOf(media({ kind, url: undefined, alt: `The ${kind} for this clue` }));
      expect(body, kind).toContain(`The ${kind} for this clue`);
      expect(body, kind).not.toContain("src=");
      expect(body, kind).not.toContain("href=");
    }
  });
});

describe("who is allowed to make noise", () => {
  it("does not autoplay by default - a clue opening is not consent to play sound", () => {
    expect(bodyOf(media({ kind: "audio" }))).not.toContain("autoplay");
  });

  it("autoplays only when the surface that owns room audio asks", () => {
    expect(bodyOf(media({ kind: "audio" }), { autoplay: true })).toContain("autoplay");
  });
});
