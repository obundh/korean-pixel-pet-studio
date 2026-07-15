import { describe, expect, it } from "vitest";

import {
  IDLE_VARIANTS,
  calculateBottomCenterFit,
  cleanupFlatChroma,
  colorDistance,
  detectFlatChromaKey,
  findAlphaBounds,
  findRobustAlphaBounds,
  hasMeaningfulTransparency,
  idleVariantPlacement,
  parseCanvasSize,
} from "../src/renderer/lib/quickPet";

describe("quick pet geometry", () => {
  it("reads the selected style canvas and keeps unsafe values bounded", () => {
    expect(parseCanvasSize("64 × 64")).toEqual({ width: 64, height: 64 });
    expect(parseCanvasSize("96x80 logical 48")).toEqual({ width: 96, height: 80 });
    expect(parseCanvasSize({ width: 4, height: 999 })).toEqual({ width: 16, height: 256 });
    expect(parseCanvasSize("unknown")).toEqual({ width: 64, height: 64 });
  });

  it("finds the inclusive alpha bounds of the cleaned mascot", () => {
    const pixels = new Uint8ClampedArray(6 * 5 * 4);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 2; x <= 4; x += 1) pixels[(y * 6 + x) * 4 + 3] = 255;
    }
    expect(findAlphaBounds(pixels, 6, 5)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
    expect(findAlphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });

  it("ignores isolated dust while retaining a nearby detached ornament", () => {
    const width = 12;
    const height = 12;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 4; y <= 7; y += 1) {
      for (let x = 4; x <= 7; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
    }
    pixels[(3 * width + 9) * 4 + 3] = 255;
    pixels[(3 * width + 10) * 4 + 3] = 255;
    pixels[3] = 255;

    expect(findAlphaBounds(pixels, width, height)).toEqual({
      x: 0,
      y: 0,
      width: 11,
      height: 8,
    });
    expect(findRobustAlphaBounds(pixels, width, height)).toEqual({
      x: 4,
      y: 3,
      width: 7,
      height: 5,
    });
  });

  it("only skips removal for meaningful edge-connected transparency", () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    expect(hasMeaningfulTransparency(pixels, width, height)).toBe(false);

    // A transparent internal hole is part of the subject, not proof that the
    // outer background was already removed.
    for (let y = 3; y < 7; y += 1) {
      for (let x = 3; x < 7; x += 1) pixels[(y * width + x) * 4 + 3] = 0;
    }
    expect(hasMeaningfulTransparency(pixels, width, height)).toBe(false);

    // A one-pixel transparent border is too small to trust by itself.
    const thinWidth = 64;
    const thinHeight = 64;
    const thinBorder = new Uint8ClampedArray(thinWidth * thinHeight * 4).fill(255);
    for (let x = 0; x < thinWidth; x += 1) {
      thinBorder[x * 4 + 3] = 0;
      thinBorder[((thinHeight - 1) * thinWidth + x) * 4 + 3] = 0;
    }
    for (let y = 0; y < thinHeight; y += 1) {
      thinBorder[(y * thinWidth) * 4 + 3] = 0;
      thinBorder[(y * thinWidth + thinWidth - 1) * 4 + 3] = 0;
    }
    expect(hasMeaningfulTransparency(thinBorder, thinWidth, thinHeight)).toBe(false);

    // A real cutout has a substantial outer transparent region and a subject
    // whose alpha bounds are clearly smaller than the full canvas.
    pixels.fill(0);
    for (let y = 2; y < 8; y += 1) {
      for (let x = 2; x < 8; x += 1) {
        const index = (y * width + x) * 4;
        pixels[index] = 40;
        pixels[index + 1] = 100;
        pixels[index + 2] = 220;
        pixels[index + 3] = 255;
      }
    }
    expect(hasMeaningfulTransparency(pixels, width, height)).toBe(true);
  });

  it("fits bottom-center inside the requested padding", () => {
    expect(
      calculateBottomCenterFit(
        { x: 10, y: 20, width: 100, height: 200 },
        { width: 64, height: 64 },
        6,
      ),
    ).toEqual({
      sourceX: 10,
      sourceY: 20,
      sourceWidth: 100,
      sourceHeight: 200,
      destinationX: 19,
      destinationY: 6,
      destinationWidth: 26,
      destinationHeight: 52,
    });
  });

  it("defines four subtle bottom-anchored idle placements", () => {
    expect(IDLE_VARIANTS.map((variant) => variant.id)).toEqual([
      "neutral",
      "up",
      "squash",
      "exhale",
    ]);
    expect(idleVariantPlacement({ width: 64, height: 64 }, IDLE_VARIANTS[0])).toEqual({
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    });
    expect(idleVariantPlacement({ width: 64, height: 64 }, IDLE_VARIANTS[2])).toEqual({
      x: -1,
      y: 2,
      width: 66,
      height: 62,
    });
  });

  it("detects only a uniform high-saturation border as a flat chroma key", () => {
    const width = 20;
    const height = 20;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 0;
      pixels[index + 1] = 255;
      pixels[index + 2] = 0;
      pixels[index + 3] = 255;
    }
    for (let y = 6; y < 14; y += 1) {
      for (let x = 6; x < 14; x += 1) {
        const index = (y * width + x) * 4;
        pixels[index] = 220;
        pixels[index + 1] = 40;
        pixels[index + 2] = 30;
      }
    }
    const detected = detectFlatChromaKey(pixels, width, height);
    expect(detected?.color).toEqual({ red: 0, green: 255, blue: 0 });
    expect(detected?.borderUniformity).toBe(1);
    expect(detected?.imageCoverage).toBeCloseTo(0.84);

    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 220;
      pixels[index + 1] = 220;
      pixels[index + 2] = 220;
    }
    expect(detectFlatChromaKey(pixels, width, height)).toBeNull();
  });

  it("does not mistake a saturated mascot touching a transparent edge for chroma", () => {
    const width = 20;
    const height = 20;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * width + x) * 4;
        pixels[index] = 255;
        pixels[index + 1] = 0;
        pixels[index + 2] = 255;
        pixels[index + 3] = 255;
      }
    }

    expect(hasMeaningfulTransparency(pixels, width, height)).toBe(true);
    expect(detectFlatChromaKey(pixels, width, height)).toBeNull();
  });

  it("removes key pixels, despills edge blends, and emits hard alpha", () => {
    const key = { red: 0, green: 255, blue: 0 };
    const original = new Uint8ClampedArray([
      0, 255, 0, 255,
      80, 175, 0, 255,
      230, 30, 20, 255,
      248, 240, 215, 255,
      0, 0, 0, 0,
    ]);
    const cleaned = new Uint8ClampedArray([
      0, 255, 0, 90,
      80, 175, 0, 190,
      230, 30, 20, 220,
      248, 240, 215, 0,
      0, 0, 0, 0,
    ]);
    const result = cleanupFlatChroma(original, cleaned, key);
    expect([result[3], result[7], result[11], result[15], result[19]]).toEqual([
      0, 255, 255, 255, 0,
    ]);
    expect(colorDistance(result[4], result[5], result[6], key)).toBeGreaterThanOrEqual(80);
    expect([result[12], result[13], result[14]]).toEqual([248, 240, 215]);
    expect(new Set([result[3], result[7], result[11], result[15], result[19]])).toEqual(
      new Set([0, 255]),
    );
  });
});
