// Server-render tests per the repo pattern (svelte/server render() in node vitest - see
// src/lib/board/board-display.test.ts): markup, props, and accessibility contract of the two
// avatar components. Interaction coverage (click-to-select) arrives with browser mode in the
// M4 phase 2 surfaces.
import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import AvatarChip from "#lib/avatars/avatar-chip.svelte";
import AvatarPicker from "#lib/avatars/avatar-picker.svelte";
import { avatarManifest } from "#lib/avatars/avatar-manifest.ts";

const firstAvatar = avatarManifest.avatars[0];
const firstAccent = avatarManifest.accents[0];
if (!firstAvatar || !firstAccent) throw new Error("manifest unexpectedly empty");

describe("avatar-chip server render", () => {
  const { body } = render(AvatarChip, {
    props: { avatar: firstAvatar, accent: firstAccent, size: "48px" },
  });

  it("renders the sprite from the manifest base path with the display name as alt text", () => {
    expect(body).toContain(`src="/avatars/${firstAvatar.id}--${firstAccent.id}.webp"`);
    expect(body).toContain(`alt="${firstAvatar.displayName}"`);
  });

  it("passes size and accent through as CSS custom properties (no hard-coded colors)", () => {
    expect(body).toContain("--avatar-chip-size: 48px");
    expect(body).toContain(`--avatar-chip-accent: ${firstAccent.hex}`);
  });
});

describe("avatar-picker server render", () => {
  const secondAccent = avatarManifest.accents[1] ?? firstAccent;
  const { body } = render(AvatarPicker, {
    props: {
      avatars: avatarManifest.avatars,
      accents: avatarManifest.accents,
      selectedAvatarId: firstAvatar.id,
      selectedAccentId: secondAccent.id,
    },
  });

  it("renders one labeled button per avatar and one per accent", () => {
    const buttonCount = (body.match(/<button/g) ?? []).length;
    expect(buttonCount).toBe(avatarManifest.avatars.length + avatarManifest.accents.length);
    for (const avatar of avatarManifest.avatars) {
      expect(body).toContain(avatar.displayName);
    }
  });

  it("renders every avatar's sprite in the selected accent", () => {
    for (const avatar of avatarManifest.avatars) {
      expect(body).toContain(`/avatars/${avatar.id}--${secondAccent.id}.webp`);
    }
  });

  it("marks the selections with aria-pressed", () => {
    const pressedCount = (body.match(/aria-pressed="true"/g) ?? []).length;
    // One pressed avatar cell + one pressed accent swatch.
    expect(pressedCount).toBe(2);
  });
});
