// The animated tier's contract, in the repo's server-render style (svelte/server render() in
// node vitest, as src/lib/avatars/avatar-components.test.ts does).
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import AvatarAnimated from "#lib/avatars/avatar-animated.svelte";
import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";

const avatar = avatarManifest.avatars[0];
const accent = avatarManifest.accents[0];
if (!avatar || !accent) throw new Error("manifest unexpectedly empty");

describe("avatar-animated server render", () => {
  const { body } = render(AvatarAnimated, { props: { avatar, accent, size: "96px" } });

  it("renders the walk filmstrip, not a still sprite", () => {
    expect(body).toContain(`src="/avatars/${avatar.sheet.file}"`);
    expect(body).not.toContain(`/avatars/${avatar.id}--${accent.id}.webp`);
  });

  it("names the avatar for assistive technology", () => {
    expect(body).toContain(`alt="${avatar.displayName}"`);
  });

  it("passes size, accent, and frame count as custom properties (no hard-coded colors)", () => {
    expect(body).toContain("--avatar-animated-size: 96px");
    expect(body).toContain(`--avatar-animated-accent: ${accent.hex}`);
    expect(body).toContain(`--avatar-animated-frames: ${String(avatarManifest.sheet.frames)}`);
  });

  it("renders a strip the CSS steps() count agrees with", () => {
    // The strip is `frames` frames wide and the animation steps `frames` times; if the two
    // ever disagreed the walk would drift, so both read the same manifest number.
    expect(body).toContain(`data-frames="${String(avatarManifest.sheet.frames)}"`);
  });

  it("works for every avatar in the roster", () => {
    for (const entry of avatarManifest.avatars) {
      const { body: entryBody } = render(AvatarAnimated, { props: { avatar: entry, accent } });
      expect(entryBody, entry.id).toContain(`/avatars/${entry.sheet.file}`);
    }
  });
});
