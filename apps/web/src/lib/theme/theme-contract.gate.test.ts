// Invariant gate for the token contract (docs/design/theming.md): every built-in preset must
// emit the COMPLETE semantic token set, and the presets must be genuinely distinct themes -
// the theming decision's claim is visual range on one contract, not hue swaps. If a token is
// added to tokens.css without extending themeToTokens (or vice versa), this gate is what
// fails, not a screen at game night.
import { describe, expect, it } from "vitest";
import { themePresets, terraVerdePreset, retroTvPreset } from "#lib/theme/theme-presets.ts";
import {
  fillToCss,
  themeTokenNames,
  themeToStyleAttribute,
  themeToTokens,
} from "#lib/theme/theme-to-css.ts";

describe("token contract completeness", () => {
  it.each(themePresets.map((preset) => [preset.id, preset] as const))(
    "%s emits every contract token with a non-empty value",
    (_id, preset) => {
      const tokens = themeToTokens(preset);
      for (const name of themeTokenNames) {
        expect(tokens[name], name).toBeTruthy();
      }
      expect(Object.keys(tokens).toSorted()).toEqual(themeTokenNames.toSorted());
    },
  );

  it("presets have unique ids and unique looks (cell background differs everywhere)", () => {
    const ids = themePresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(themePresets.length);
    const cellBackgrounds = themePresets.map((preset) => themeToTokens(preset)["--board-cell-bg"]);
    expect(new Set(cellBackgrounds).size).toBe(themePresets.length);
  });

  it("switching preset changes the applied tokens (the gallery switcher mechanism)", () => {
    const styles = themePresets.map((preset) => themeToStyleAttribute(preset));
    expect(new Set(styles).size).toBe(themePresets.length);
    for (const style of styles) {
      // Applied as one inline style attribute: every declaration must be a custom property.
      for (const declaration of style.split(";").filter((part) => part.trim() !== "")) {
        expect(declaration.trim().startsWith("--")).toBe(true);
      }
    }
  });

  it("terra-verde is a pure override of retro-tv: same font slots, different palette", () => {
    expect(terraVerdePreset.fontSlots).toEqual(retroTvPreset.fontSlots);
    expect(terraVerdePreset.effectsLevel).toBe(retroTvPreset.effectsLevel);
    const terra = themeToTokens(terraVerdePreset);
    const retro = themeToTokens(retroTvPreset);
    expect(terra["--board-cell-bg"]).not.toBe(retro["--board-cell-bg"]);
    expect(terra["--font-values"]).toBe(retro["--font-values"]);
  });
});

describe("fill rendering", () => {
  it("solid fills render as the color, gradients as linear-gradient", () => {
    expect(fillToCss({ kind: "solid", color: "#060ce9" })).toBe("#060ce9");
    expect(fillToCss({ kind: "gradient", from: "#0a0b33", to: "#04041a", angleDeg: 180 })).toBe(
      "linear-gradient(180deg, #0a0b33, #04041a)",
    );
  });
});

describe("used-cell treatments", () => {
  it("the three treatments produce three distinct used-cell token sets", () => {
    const byTreatment = (["blank-dark", "dimmed", "outline"] as const).map((treatment) =>
      themeToTokens({
        ...retroTvPreset,
        tokens: { ...retroTvPreset.tokens, usedCellTreatment: treatment },
      }),
    );
    const signatures = byTreatment.map((tokens) =>
      [
        tokens["--board-cell-used-bg"],
        tokens["--board-cell-used-outline"],
        tokens["--board-cell-used-opacity"],
      ].join("|"),
    );
    expect(new Set(signatures).size).toBe(3);
  });
});

describe("font slots", () => {
  it("each slot resolves to a stack leading with the curated face's family name", () => {
    const tokens = themeToTokens(retroTvPreset);
    expect(tokens["--font-display"]).toMatch(/^"Anton"/);
    expect(tokens["--font-values"]).toMatch(/^"Six Caps"/);
    expect(tokens["--font-clue"]).toMatch(/^"Bitter"/);
    expect(tokens["--font-chrome"]).toMatch(/^"Oswald"/);
  });
});
