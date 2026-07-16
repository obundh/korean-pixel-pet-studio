import { describe, expect, it, vi } from "vitest";

import {
  calculateSharedMotionLayout,
  findStableHorizontalAnchor,
  inspectMotionBackground,
  processMotionFrames,
  type MotionFrameProcessorDependencies,
  type PreparedMotionFrame,
} from "../src/renderer/lib/motionFrames";
import type { FrameAsset } from "../src/renderer/types";

const frame = (id: string): FrameAsset => ({
  id,
  name: `${id}.png`,
  dataUrl: `data:image/png;base64,${id}`,
  originalDataUrl: `data:image/png;base64,original-${id}`,
  width: 100,
  height: 100,
  backgroundRemoved: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("motion frame background routing", () => {
  it("routes a uniform magenta prompt background directly to flat chroma cleanup", () => {
    const width = 20;
    const height = 20;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = 255;
      rgba[index + 1] = 0;
      rgba[index + 2] = 255;
      rgba[index + 3] = 255;
    }
    for (let y = 7; y < 13; y += 1) {
      for (let x = 7; x < 13; x += 1) {
        const index = (y * width + x) * 4;
        rgba[index] = 230;
        rgba[index + 1] = 140;
        rgba[index + 2] = 40;
      }
    }

    expect(inspectMotionBackground(rgba, width, height)).toEqual({
      strategy: "flat-chroma",
      chromaKey: { red: 255, green: 0, blue: 255 },
    });
  });

  it("uses AI only for an opaque background that is not a safe flat key", () => {
    const width = 20;
    const height = 20;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = 160 + ((index / 4) % 7);
      rgba[index + 1] = 155;
      rgba[index + 2] = 150;
      rgba[index + 3] = 255;
    }
    expect(inspectMotionBackground(rgba, width, height)).toEqual({
      strategy: "ai-removal",
    });
  });

  it("keeps a known chroma key authoritative after a normalized frame is restored", () => {
    const width = 20;
    const height = 20;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 4; y < 16; y += 1) {
      for (let x = 4; x < 16; x += 1) {
        const index = (y * width + x) * 4;
        rgba[index] = 255;
        rgba[index + 2] = 255;
        rgba[index + 3] = 255;
      }
    }

    expect(inspectMotionBackground(rgba, width, height, [255, 0, 255])).toEqual({
      strategy: "flat-chroma",
      chromaKey: { red: 255, green: 0, blue: 255 },
    });
  });
});

describe("shared motion layout", () => {
  it("does not move the body merely because an appendage changes the alpha bounds", () => {
    const layout = calculateSharedMotionLayout(
      [
        {
          width: 100,
          height: 100,
          bounds: { x: 20, y: 10, width: 30, height: 70 },
          anchorX: 35,
        },
        {
          width: 100,
          height: 100,
          bounds: { x: 15, y: 20, width: 45, height: 65 },
          anchorX: 35,
        },
      ],
      { width: 64, height: 64 },
      4,
    );

    expect(layout.sourceCanvas).toEqual({ width: 100, height: 100 });
    expect(layout.sourceOffsets).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(layout.horizontalCorrections).toEqual([0, 0]);
    expect(layout.unionBounds).toEqual({ x: 15, y: 10, width: 45, height: 75 });
    expect(layout.placement).toEqual({
      sourceX: 15,
      sourceY: 10,
      sourceWidth: 45,
      sourceHeight: 75,
      destinationX: 15,
      destinationY: 4,
      destinationWidth: 34,
      destinationHeight: 56,
    });
  });

  it("places different-size inputs in a shared bottom-center source plane", () => {
    const layout = calculateSharedMotionLayout(
      [
        { width: 80, height: 100, bounds: { x: 20, y: 20, width: 40, height: 70 } },
        { width: 100, height: 80, bounds: { x: 30, y: 5, width: 40, height: 70 } },
      ],
      { width: 64, height: 64 },
      4,
    );

    expect(layout.sourceCanvas).toEqual({ width: 100, height: 100 });
    expect(layout.sourceOffsets).toEqual([{ x: 10, y: 0 }, { x: 0, y: 20 }]);
    expect(layout.unionBounds).toEqual({ x: 30, y: 20, width: 40, height: 75 });
  });

  it("caps an extreme anchor difference instead of shifting the whole pose without limit", () => {
    const layout = calculateSharedMotionLayout(
      [
        {
          width: 100,
          height: 100,
          bounds: { x: 10, y: 10, width: 30, height: 80 },
          anchorX: 20,
        },
        {
          width: 100,
          height: 100,
          bounds: { x: 60, y: 10, width: 30, height: 80 },
          anchorX: 80,
        },
      ],
      { width: 64, height: 64 },
      4,
    );

    expect(layout.maxHorizontalCorrection).toBe(6);
    expect(layout.horizontalCorrections).toEqual([6, -6]);
    expect(layout.sourceOffsets).toEqual([{ x: 12, y: 0 }, { x: 0, y: 0 }]);
  });

  it("keeps the pairwise correction bound for small and non-multiple-of-16 cells", () => {
    const small = calculateSharedMotionLayout(
      [
        {
          width: 24,
          height: 24,
          bounds: { x: 2, y: 2, width: 8, height: 20 },
          anchorX: 4,
        },
        {
          width: 24,
          height: 24,
          bounds: { x: 14, y: 2, width: 8, height: 20 },
          anchorX: 20,
        },
      ],
      { width: 64, height: 64 },
      4,
    );
    expect(small.maxHorizontalCorrection).toBe(1);
    expect(small.horizontalCorrections).toEqual([1, -1]);
    expect(
      Math.abs(small.horizontalCorrections[0] - small.horizontalCorrections[1]) / 24,
    ).toBeLessThanOrEqual(0.125);

    const tiny = calculateSharedMotionLayout(
      [
        {
          width: 8,
          height: 8,
          bounds: { x: 0, y: 0, width: 3, height: 8 },
          anchorX: 1,
        },
        {
          width: 8,
          height: 8,
          bounds: { x: 5, y: 0, width: 3, height: 8 },
          anchorX: 7,
        },
      ],
      { width: 64, height: 64 },
      2,
    );
    expect(tiny.maxHorizontalCorrection).toBe(0);
    expect(tiny.horizontalCorrections).toEqual([0, 0]);
  });

  it("finds a stable body-row anchor without letting a thin tail dominate", () => {
    const width = 100;
    const height = 100;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const paint = (left: number, right: number, top: number, bottom: number) => {
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          rgba[(y * width + x) * 4 + 3] = 255;
        }
      }
    };
    paint(30, 49, 15, 85);
    paint(50, 80, 60, 62);

    expect(
      findStableHorizontalAnchor(
        rgba,
        width,
        height,
        { x: 30, y: 15, width: 51, height: 71 },
      ),
    ).toBe(40);
  });

  it("ignores a one-pixel vertical appendage that spans most body rows", () => {
    const width = 100;
    const height = 100;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const paint = (left: number, right: number, top: number, bottom: number) => {
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          rgba[(y * width + x) * 4 + 3] = 255;
        }
      }
    };
    paint(30, 49, 15, 85);
    const bodyOnly = new Uint8ClampedArray(rgba);
    paint(80, 80, 20, 80);

    const bodyAnchor = findStableHorizontalAnchor(
      bodyOnly,
      width,
      height,
      { x: 30, y: 15, width: 20, height: 71 },
    );
    const appendageAnchor = findStableHorizontalAnchor(
      rgba,
      width,
      height,
      { x: 30, y: 15, width: 51, height: 71 },
    );
    expect(Math.abs(appendageAnchor - bodyAnchor)).toBeLessThanOrEqual(0.5);

    const layout = calculateSharedMotionLayout(
      [
        {
          width,
          height,
          bounds: { x: 30, y: 15, width: 20, height: 71 },
          anchorX: bodyAnchor,
        },
        {
          width,
          height,
          bounds: { x: 30, y: 15, width: 51, height: 71 },
          anchorX: appendageAnchor,
        },
      ],
      { width: 64, height: 64 },
      4,
    );
    expect(layout.horizontalCorrections).toEqual([0, 0]);
  });
});

describe("motion frame processing", () => {
  it("replaces every FrameAsset using the same calculated layout", async () => {
    const inputs = [frame("pose-1"), frame("pose-2")];
    const prepared: PreparedMotionFrame[] = [
      {
        frame: inputs[0],
        originalDataUrl: inputs[0].originalDataUrl,
        cleanedDataUrl: "cleaned-1",
        width: 100,
        height: 100,
        bounds: { x: 20, y: 10, width: 30, height: 70 },
        strategy: "flat-chroma",
        chromaKey: [255, 0, 255],
      },
      {
        frame: inputs[1],
        originalDataUrl: inputs[1].originalDataUrl,
        cleanedDataUrl: "cleaned-2",
        width: 100,
        height: 100,
        bounds: { x: 15, y: 20, width: 45, height: 65 },
        strategy: "existing-cutout",
      },
    ];
    const layouts: unknown[] = [];
    const dependencies: MotionFrameProcessorDependencies = {
      prepareFrame: vi.fn(async (input) => prepared.find((item) => item.frame.id === input.id)!),
      renderFrame: vi.fn(async (input, layout, index) => {
        layouts.push(layout);
        return {
          dataUrl: `normalized-cleaned-${index}`,
          originalDataUrl: `normalized-original-${index}`,
        };
      }),
    };

    const result = await processMotionFrames(
      {
        frames: inputs,
        canvas: { width: 64, height: 64 },
        padding: 4,
        now: () => "2026-07-16T00:00:00.000Z",
      },
      dependencies,
    );

    expect(layouts).toHaveLength(2);
    expect(layouts[0]).toBe(layouts[1]);
    expect(result.flatChromaCount).toBe(1);
    expect(result.existingCutoutCount).toBe(1);
    expect(result.aiRemovalCount).toBe(0);
    expect(result.frames).toEqual([
      expect.objectContaining({
        id: "pose-1",
        dataUrl: "normalized-cleaned-0",
        originalDataUrl: "normalized-original-0",
        width: 64,
        height: 64,
        backgroundRemoved: true,
        chromaKey: [255, 0, 255],
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
      expect.objectContaining({
        id: "pose-2",
        dataUrl: "normalized-cleaned-1",
        originalDataUrl: "normalized-original-1",
        width: 64,
        height: 64,
        backgroundRemoved: true,
      }),
    ]);
  });
});
