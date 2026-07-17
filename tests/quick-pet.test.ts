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
  QUICK_PET_FPS,
  repairBoundaryChromaFringe,
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

  it("defines a slow four-frame idle loop without resizing the canvas", () => {
    expect(QUICK_PET_FPS).toBe(4);
    expect(IDLE_VARIANTS.map((variant) => variant.id)).toEqual([
      "neutral",
      "rise",
      "hold",
      "settle",
    ]);
    expect(
      IDLE_VARIANTS.map((variant) =>
        idleVariantPlacement({ width: 64, height: 64 }, variant),
      ),
    ).toEqual([
      { x: 0, y: 0, width: 64, height: 64 },
      { x: 0, y: -1, width: 64, height: 64 },
      { x: 0, y: -1, width: 64, height: 64 },
      { x: 0, y: 0, width: 64, height: 64 },
    ]);
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

  it("discards dark hue-preserving chroma spill that RGB distance misses", () => {
    const key = { red: 255, green: 0, blue: 245 };
    const original = new Uint8ClampedArray([
      255, 0, 245, 255,
      109, 8, 103, 255,
      235, 158, 52, 255,
    ]);
    const result = cleanupFlatChroma(original, original, key);

    expect(colorDistance(109, 8, 103, key)).toBeGreaterThan(190);
    expect([result[3], result[7], result[11]]).toEqual([0, 0, 255]);
  });

  it("recolors only exterior purple spill while preserving the foreground shape", () => {
    const width = 7;
    const height = 7;
    const key = { red: 255, green: 0, blue: 255 };
    const original = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < original.length; index += 4) {
      original[index] = key.red;
      original[index + 1] = key.green;
      original[index + 2] = key.blue;
      original[index + 3] = 255;
    }
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        const index = (y * width + x) * 4;
        const edge = x === 2 || x === 4 || y === 2 || y === 4;
        original[index] = edge ? 80 : 20;
        original[index + 1] = edge ? 10 : 50;
        original[index + 2] = edge ? 120 : 100;
      }
    }

    const result = cleanupFlatChroma(original, original, key, width, height);
    const center = (3 * width + 3) * 4;
    const repairedEdge = (2 * width + 3) * 4;
    expect(result[3]).toBe(0);
    expect(result[center + 3]).toBe(255);
    expect(result[repairedEdge + 3]).toBe(255);
    expect([
      result[repairedEdge],
      result[repairedEdge + 1],
      result[repairedEdge + 2],
    ]).toEqual([20, 50, 100]);
  });

  it("keeps a similar purple detail when it is enclosed inside the character", () => {
    const width = 9;
    const height = 9;
    const key = { red: 255, green: 0, blue: 255 };
    const original = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < original.length; index += 4) {
      original[index] = key.red;
      original[index + 1] = key.green;
      original[index + 2] = key.blue;
      original[index + 3] = 255;
    }
    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 6; x += 1) {
        const index = (y * width + x) * 4;
        original[index] = 20;
        original[index + 1] = 50;
        original[index + 2] = 100;
      }
    }
    const detail = (4 * width + 4) * 4;
    original[detail] = 80;
    original[detail + 1] = 10;
    original[detail + 2] = 120;

    const result = cleanupFlatChroma(original, original, key, width, height);
    expect([result[detail], result[detail + 1], result[detail + 2], result[detail + 3]])
      .toEqual([80, 10, 120, 255]);
  });

  it("repairs a muted inner halo when the original pixel was key-contaminated", () => {
    const width = 9;
    const height = 9;
    const key = { red: 255, green: 0, blue: 255 };
    const original = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < original.length; index += 4) {
      original[index] = key.red;
      original[index + 1] = key.green;
      original[index + 2] = key.blue;
      original[index + 3] = 255;
    }
    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 6; x += 1) {
        const index = (y * width + x) * 4;
        original[index] = 45;
        original[index + 1] = 105;
        original[index + 2] = 55;
      }
    }
    const halo = (4 * width + 3) * 4;
    original[halo] = 171;
    original[halo + 1] = 17;
    original[halo + 2] = 176;
    const cleaned = new Uint8ClampedArray(original);
    cleaned[halo] = 101;
    cleaned[halo + 1] = 65;
    cleaned[halo + 2] = 111;

    const result = cleanupFlatChroma(original, cleaned, key, width, height);
    expect([result[halo], result[halo + 1], result[halo + 2], result[halo + 3]])
      .toEqual([45, 105, 55, 255]);
  });

  it("repairs a halo even when the same color appears in a distant safe detail", () => {
    const width = 25;
    const height = 9;
    const key = { red: 255, green: 0, blue: 255 };
    const original = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < original.length; index += 4) {
      original[index] = key.red;
      original[index + 1] = key.green;
      original[index + 2] = key.blue;
      original[index + 3] = 255;
    }
    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 22; x += 1) {
        const index = (y * width + x) * 4;
        original.set([45, 105, 55, 255], index);
      }
    }
    const halo = (4 * width + 3) * 4;
    original.set([171, 17, 176, 255], halo);
    const distantDetail = (4 * width + 21) * 4;
    original.set([101, 65, 111, 255], distantDetail);
    const cleaned = new Uint8ClampedArray(original);
    cleaned.set([101, 65, 111, 255], halo);

    const result = cleanupFlatChroma(original, cleaned, key, width, height);
    expect([result[halo], result[halo + 1], result[halo + 2], result[halo + 3]])
      .toEqual([45, 105, 55, 255]);
  });

  it("preserves a nearly black outline even when original chroma evidence is nearby", () => {
    const width = 7;
    const height = 7;
    const key = { red: 255, green: 0, blue: 255 };
    const cleaned = new Uint8ClampedArray(width * height * 4);
    const evidence = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < evidence.length; index += 4) {
      evidence[index] = key.red;
      evidence[index + 1] = key.green;
      evidence[index + 2] = key.blue;
      evidence[index + 3] = 255;
    }
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        const index = (y * width + x) * 4;
        cleaned.set([45, 105, 55, 255], index);
        evidence.set([45, 105, 55, 255], index);
      }
    }
    const outline = (4 * width + 3) * 4;
    cleaned.set([12, 5, 19, 255], outline);
    evidence.set([151, 7, 164, 255], outline);

    const result = repairBoundaryChromaFringe(cleaned, width, height, key, evidence);
    expect([result[outline], result[outline + 1], result[outline + 2], result[outline + 3]])
      .toEqual([12, 5, 19, 255]);
  });
});
