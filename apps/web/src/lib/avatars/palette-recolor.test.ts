// The recolor is the one piece of avatar code that runs in three places (the sprite bake, the
// sheet bake, the live diorama), so its arithmetic is pinned here rather than eyeballed on a
// projector. Every case below is stated in terms of the mechanism the roster comments rely on:
// cells within tolerance move, cells outside it do not, and shading survives the move.
import { describe, expect, it } from "vitest";
import {
  defaultRecolorTolerance,
  luminance,
  parseHexColor,
  recolorPixels,
  tintTowardAccent,
} from "#lib/avatars/palette-recolor.ts";

/** Build an RGBA buffer from a list of opaque colors. */
function pixelsOf(...colors: readonly (readonly [number, number, number])[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((color, index) => {
    data[index * 4] = color[0];
    data[index * 4 + 1] = color[1];
    data[index * 4 + 2] = color[2];
    data[index * 4 + 3] = 255;
  });
  return data;
}

describe("parseHexColor", () => {
  it("parses #rrggbb in either case", () => {
    expect(parseHexColor("#2d6cdf")).toEqual([45, 108, 223]);
    expect(parseHexColor("#FFCC00")).toEqual([255, 204, 0]);
  });

  it("throws on anything else rather than tinting toward black", () => {
    expect(() => parseHexColor("2d6cdf")).toThrowError(/not a #rrggbb color/);
    expect(() => parseHexColor("#abc")).toThrowError(/not a #rrggbb color/);
  });
});

describe("tintTowardAccent", () => {
  it("returns the accent unchanged for a pixel that IS the target cell", () => {
    const accent = parseHexColor("#2d6cdf");
    expect(tintTowardAccent(parseHexColor("#cc7854"), parseHexColor("#cc7854"), accent)).toEqual([
      45, 108, 223,
    ]);
  });

  it("keeps a shade darker than its cell darker than the accent (shading survives)", () => {
    const target = parseHexColor("#cc7854");
    const accent = parseHexColor("#2d6cdf");
    const shaded = tintTowardAccent([100, 60, 40], target, accent);
    expect(luminance(shaded)).toBeLessThan(luminance(accent));
    // ...and proportionally so: half the cell's luminance -> half the accent's.
    const ratio = luminance([100, 60, 40]) / luminance(target);
    expect(luminance(shaded)).toBeCloseTo(luminance(accent) * ratio, 4);
  });

  it("clamps rather than wrapping when a highlight would overshoot white", () => {
    const tinted = tintTowardAccent([255, 255, 255], parseHexColor("#101010"), [200, 200, 200]);
    expect(tinted.every((channel) => channel <= 255)).toBe(true);
  });
});

describe("recolorPixels", () => {
  const target = "#cc7854"; // the pets' body cell (bunny/dog/hog/monkey)

  it("moves pixels inside the tolerance and leaves everything else alone", () => {
    // Same cell, a near neighbour inside tolerance, and a face-black far outside it.
    const pixels = pixelsOf([204, 120, 84], [212, 127, 89], [20, 20, 26]);
    const changed = recolorPixels(pixels, [target], "#2d6cdf");
    expect(changed).toBe(2);
    expect(Array.from(pixels.subarray(8, 11))).toEqual([20, 20, 26]);
  });

  it("reports zero changes when no target cell is present - the bake's pack-drift alarm", () => {
    const pixels = pixelsOf([20, 20, 26], [250, 250, 250]);
    expect(recolorPixels(pixels, [target], "#2d6cdf")).toBe(0);
  });

  it("never touches alpha (sprites are cut out against transparency)", () => {
    const pixels = pixelsOf([204, 120, 84]);
    pixels[3] = 128;
    recolorPixels(pixels, [target], "#2d6cdf");
    expect(pixels[3]).toBe(128);
  });

  it("honours a tightened tolerance - male-d's tie vs his auburn hair", () => {
    // 30 apart in red only: inside the default 42, outside a tightened 28.
    const near: readonly [number, number, number] = [234, 120, 84];
    expect(recolorPixels(pixelsOf(near), [target], "#2d6cdf", defaultRecolorTolerance)).toBe(1);
    expect(recolorPixels(pixelsOf(near), [target], "#2d6cdf", 28)).toBe(0);
  });

  it("applies only the first matching target so overlapping shade cells never double-tint", () => {
    const once = pixelsOf([204, 120, 84]);
    const twice = pixelsOf([204, 120, 84]);
    recolorPixels(once, [target], "#2d6cdf");
    // Both roster targets for these pets sit within tolerance of each other; listing both
    // must produce exactly what listing the matching one alone produces.
    recolorPixels(twice, [target, "#d47f59"], "#2d6cdf");
    expect([...twice]).toEqual([...once]);
  });
});
