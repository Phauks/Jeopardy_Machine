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

describe("the skin-tone row appears only where it can do something", () => {
  // The honesty rule from the 2026-08-16 decision: pets have no skin cells, so offering them a
  // tone would be a control that silently changes nothing. This is checked at the picker rather
  // than left to callers, because it is the picker that knows which avatar is selected.
  const human = avatarManifest.avatars.find((entry) => entry.kind === "human");
  const pet = avatarManifest.avatars.find((entry) => entry.kind === "pet");
  if (!human || !pet) throw new Error("roster needs both a human and a pet");
  // Re-bound so the narrowing survives into the closure below.
  const accentId = firstAccent.id;

  function pickerFor(selectedAvatarId: string): string {
    return render(AvatarPicker, {
      props: {
        avatars: avatarManifest.avatars,
        accents: avatarManifest.accents,
        skinTones: avatarManifest.skinTones,
        selectedAvatarId,
        selectedAccentId: accentId,
      },
    }).body;
  }

  it("offers every tone plus an explicit 'as drawn' when a human is selected", () => {
    const body = pickerFor(human.id);
    expect(body).toContain('aria-label="Skin tone"');
    for (const tone of avatarManifest.skinTones) {
      expect(body, tone.id).toContain(`aria-label="Skin ${tone.label}"`);
    }
    // "Not chosen" is a swatch of its own, so a player can always get back to it.
    expect(body).toContain('aria-label="Skin tone: as drawn"');
    expect(body).toContain('aria-pressed="true"');
  });

  it("shows no tone control at all when a pet is selected", () => {
    const body = pickerFor(pet.id);
    expect(body).not.toContain('aria-label="Skin tone"');
    expect(body).not.toContain("Skin tone: as drawn");
  });

  it("shows none when the caller offers no tones (the dev gallery, the old callers)", () => {
    const body = render(AvatarPicker, {
      props: {
        avatars: avatarManifest.avatars,
        accents: avatarManifest.accents,
        selectedAvatarId: human.id,
        selectedAccentId: accentId,
      },
    }).body;
    expect(body).not.toContain('aria-label="Skin tone"');
  });
});
