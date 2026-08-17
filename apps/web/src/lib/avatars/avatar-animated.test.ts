// The animated tier's contract, in the repo's server-render style (svelte/server render() in
// node vitest, as src/lib/avatars/avatar-components.test.ts does).
//
// The first group is THE REGRESSION TEST for the accent bug
// (docs/decisions/2026-08-16-persistent-layout-and-pregame-rework.md). It is written at the
// level the bug actually lived at: what image the component asks the browser to paint. The old
// version of this file asserted the opposite - that this component renders the walk sheet and
// never a per-accent sprite - which is precisely why the bug survived a green suite. The sheet
// is baked once in pack colors, so a component that renders only the sheet CANNOT show your
// accent on the character, and no assertion about CSS custom properties would have caught it:
// the accent was being passed in correctly the whole time, it was just landing on the backing.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import AvatarAnimated from "#lib/avatars/avatar-animated.svelte";
import { avatarManifest, skinToneById } from "#lib/avatars/avatar-manifest.ts";

const avatar = avatarManifest.avatars[0];
const accent = avatarManifest.accents[0];
const otherAccent = avatarManifest.accents[4];
if (!avatar || !accent || !otherAccent) throw new Error("manifest unexpectedly empty");
const human = avatarManifest.avatars.find((entry) => entry.kind === "human");
if (!human) throw new Error("roster has no human avatar");

describe("the accent lands on the character, not the backdrop", () => {
  it("paints a per-accent sprite of the avatar itself in the first frame it can", () => {
    const { body } = render(AvatarAnimated, { props: { avatar, accent, size: "96px" } });
    expect(body).toContain(`src="/avatars/${avatar.id}--${accent.id}.webp"`);
  });

  it("CHANGES THAT IMAGE when the accent changes - the assertion the bug would fail", () => {
    const first = render(AvatarAnimated, { props: { avatar, accent } }).body;
    const second = render(AvatarAnimated, { props: { avatar, accent: otherAccent } }).body;
    expect(first).toContain(`/avatars/${avatar.id}--${accent.id}.webp`);
    expect(second).toContain(`/avatars/${avatar.id}--${otherAccent.id}.webp`);
    expect(second).not.toContain(`/avatars/${avatar.id}--${accent.id}.webp`);
  });

  it("does that for every accent in the palette, for every avatar in the roster", () => {
    for (const entry of avatarManifest.avatars) {
      for (const paletteAccent of avatarManifest.accents) {
        const { body } = render(AvatarAnimated, {
          props: { avatar: entry, accent: paletteAccent },
        });
        expect(body, `${entry.id}/${paletteAccent.id}`).toContain(
          `/avatars/${entry.id}--${paletteAccent.id}.webp`,
        );
      }
    }
  });

  it("stops using the accent as the backing's fill (the backdrop-tinting half of the bug)", () => {
    // The accent survives as a thin ring for continuity with avatar-chip.svelte, but the
    // backing's own background must no longer be mixed from it - that fill was what a player
    // saw change when they tapped a colour.
    const { body, head } = render(AvatarAnimated, { props: { avatar, accent } });
    const styles = head + body;
    expect(styles).not.toMatch(/background:\s*color-mix\([^)]*--avatar-animated-accent/);
  });

  it("still hands the accent down as a custom property (nothing hard-codes a colour)", () => {
    const { body } = render(AvatarAnimated, { props: { avatar, accent, size: "96px" } });
    expect(body).toContain("--avatar-animated-size: 96px");
    expect(body).toContain(`--avatar-animated-accent: ${accent.hex}`);
    expect(body).toContain(`data-accent-id="${accent.id}"`);
  });
});

describe("skin tone rides the same recolor, and only for humans", () => {
  const tone = avatarManifest.skinTones[3];
  if (!tone) throw new Error("manifest has no skin tones");

  it("records the chosen tone on a human", () => {
    const { body } = render(AvatarAnimated, {
      props: { avatar: human, accent, skinTone: skinToneById(tone.id) },
    });
    expect(body).toContain(`data-skin-tone-id="${tone.id}"`);
  });

  it("ignores a tone handed to a pet rather than pretending to apply it", () => {
    const pet = avatarManifest.avatars.find((entry) => entry.kind === "pet");
    if (!pet) throw new Error("roster has no pet avatar");
    const { body } = render(AvatarAnimated, {
      props: { avatar: pet, accent, skinTone: skinToneById(tone.id) },
    });
    expect(body).toContain('data-skin-tone-id=""');
  });

  it("carries no tone at all when the player has not chosen one", () => {
    const { body } = render(AvatarAnimated, { props: { avatar: human, accent } });
    expect(body).toContain('data-skin-tone-id=""');
  });
});

describe("avatar-animated server render", () => {
  const { body } = render(AvatarAnimated, { props: { avatar, accent, size: "96px" } });

  it("names the avatar for assistive technology", () => {
    expect(body).toContain(`alt="${avatar.displayName}"`);
  });

  it("renders a strip the CSS steps() count agrees with", () => {
    // The strip is `frames` frames wide and the animation steps `frames` times; if the two
    // ever disagreed the walk would drift, so both read the same manifest number.
    expect(body).toContain(`data-frames="${String(avatarManifest.sheet.frames)}"`);
    expect(body).toContain(`--avatar-animated-frames: ${String(avatarManifest.sheet.frames)}`);
  });
});
