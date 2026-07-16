import { describe, expect, it } from "vitest";

// The production quality gate is a native Node ESM script shared by CI and
// sample generation; it intentionally stays executable without a TS build.
// @ts-expect-error Native .mjs script has no separate declaration file.
import * as qualityGate from "../scripts/frame-quality.mjs";

const {
  evaluateFrameSequence,
  inspectRgbaFrame,
  isChromaLike,
  normalizedShapeSimilarity,
} = qualityGate;

type TestFrame = {
  label: string;
  rgba: Uint8Array;
  evidenceRgba?: Uint8Array;
  width: number;
  height: number;
  keyRgb?: [number, number, number] | null;
};

function makeFrame(
  label: string,
  paint: (
    setPixel: (x: number, y: number, color?: [number, number, number, number]) => void,
  ) => void,
  width = 64,
  height = 64,
): TestFrame {
  const rgba = new Uint8Array(width * height * 4);
  const setPixel = (
    x: number,
    y: number,
    color: [number, number, number, number] = [42, 120, 224, 255],
  ) => {
    const index = (y * width + x) * 4;
    rgba.set(color, index);
  };
  paint(setPixel);
  return { label, rgba, width, height };
}

function rectangle(
  setPixel: (x: number, y: number, color?: [number, number, number, number]) => void,
  x: number,
  y: number,
  width: number,
  height: number,
  color?: [number, number, number, number],
) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(column, row, color);
    }
  }
}

function solidSubject(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): TestFrame {
  return makeFrame(label, (setPixel) => {
    rectangle(setPixel, x, y, width, height);
    rectangle(setPixel, x + 2, y + 3, Math.max(1, width - 4), 3, [244, 173, 39, 255]);
  });
}

describe("frame visual quality gate", () => {
  it("accepts a static frame or a subtle one-pixel translation without resizing it", () => {
    const neutral = solidSubject("neutral", 22, 16, 20, 40);
    const lifted = solidSubject("lifted", 22, 15, 20, 40);

    const report = evaluateFrameSequence([neutral, lifted], {
      maxCentroidJumpRatio: 0.04,
      maxBaselineJumpRatio: 0.04,
    });

    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.transitions.map((transition: { centroidDistance: number }) =>
      transition.centroidDistance)).toEqual([1, 1]);
  });

  it("rejects a whole-character squash/stretch even when normalized pixels still match", () => {
    const neutral = solidSubject("neutral", 22, 10, 20, 46);
    const squash = solidSubject("squash", 20, 14, 24, 42);
    const similarity = normalizedShapeSimilarity(neutral, squash);
    const report = evaluateFrameSequence([neutral, squash], {
      maxCentroidJumpRatio: 1,
      maxBaselineJumpRatio: 1,
    });

    expect(similarity.alphaAgreement).toBeGreaterThan(0.95);
    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "GLOBAL_SCALE_DISTORTION",
          referenceFrame: 0,
          frame: 1,
        }),
      ]),
    );
  });

  it("rejects the subtle one-axis resize that the previous bounds-only test accepted", () => {
    const neutral = solidSubject("neutral", 22, 10, 20, 46);
    const compressed = solidSubject("compressed", 22, 11, 20, 45);
    const report = evaluateFrameSequence([neutral, compressed], {
      maxCentroidJumpRatio: 1,
      maxBaselineJumpRatio: 1,
    });

    expect(report.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "GLOBAL_SCALE_DISTORTION",
          widthPixelDelta: 0,
          heightPixelDelta: -1,
        }),
      ]),
    );
  });

  it("allows a one-pixel bounds change when the pose itself was locally redrawn", () => {
    const neutral = solidSubject("neutral", 22, 10, 20, 46);
    const redrawn = makeFrame("redrawn", (setPixel) => {
      rectangle(setPixel, 22, 10, 20, 46);
      rectangle(setPixel, 24, 13, 16, 3, [244, 173, 39, 255]);
      rectangle(setPixel, 41, 28, 2, 8, [42, 120, 224, 255]);
      rectangle(setPixel, 28, 20, 8, 10, [82, 188, 116, 255]);
    });

    const report = evaluateFrameSequence([neutral, redrawn], {
      maxCentroidJumpRatio: 1,
      maxBaselineJumpRatio: 1,
    });

    expect(report.violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "GLOBAL_SCALE_DISTORTION" }),
      ]),
    );
  });

  it("allows a sprout or ear to lower without calling the whole body squashed", () => {
    const neutral = makeFrame("sprout-up", (setPixel) => {
      rectangle(setPixel, 22, 14, 20, 42);
      rectangle(setPixel, 31, 10, 2, 4, [82, 188, 116, 255]);
      rectangle(setPixel, 25, 23, 14, 4, [244, 173, 39, 255]);
    });
    const relaxed = makeFrame("sprout-down", (setPixel) => {
      rectangle(setPixel, 22, 14, 20, 42);
      rectangle(setPixel, 31, 12, 2, 2, [82, 188, 116, 255]);
      rectangle(setPixel, 26, 24, 12, 3, [92, 156, 224, 255]);
      rectangle(setPixel, 24, 31, 16, 12, [82, 188, 116, 255]);
    });

    const report = evaluateFrameSequence([neutral, relaxed], {
      maxCentroidJumpRatio: 1,
      maxBaselineJumpRatio: 1,
    });

    expect(report.violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "GLOBAL_SCALE_DISTORTION" }),
      ]),
    );
  });

  it("checks chronological transitions including the loop boundary for position jumps", () => {
    const first = solidSubject("first", 22, 18, 20, 38);
    const second = solidSubject("second", 23, 18, 20, 38);
    const jumped = solidSubject("jumped", 34, 4, 20, 38);
    const report = evaluateFrameSequence([first, second, jumped]);

    expect(report.violations.filter((item: { code: string }) => item.code === "POSITION_JUMP"))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: 1, to: 2 }),
          expect.objectContaining({ from: 2, to: 0 }),
        ]),
      );
  });

  it("detects dark hue-preserving chroma residue on a transparent boundary", () => {
    const key: [number, number, number] = [255, 0, 245];
    const frame = makeFrame("fringe", (setPixel) => {
      rectangle(setPixel, 24, 18, 16, 38, [235, 158, 52, 255]);
      // Far from the bright key in Euclidean RGB, but visibly the same purple hue.
      setPixel(24, 30, [109, 8, 103, 255]);
    });
    frame.keyRgb = key;

    expect(Math.hypot(109 - key[0], 8 - key[1], 103 - key[2])).toBeGreaterThan(190);
    expect(isChromaLike(109, 8, 103, key)).toBe(true);
    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(1);

    const report = evaluateFrameSequence([frame]);
    expect(report.violations).toEqual([
      expect.objectContaining({
        code: "CHROMA_FRINGE",
        actual: 1,
      }),
    ]);
  });

  it("detects a purple edge whose hue shifted far from a bright magenta key", () => {
    const frame = makeFrame("shifted-purple-fringe", (setPixel) => {
      rectangle(setPixel, 24, 18, 16, 38, [35, 55, 115, 255]);
      setPixel(24, 30, [80, 10, 120, 255]);
    });
    frame.keyRgb = [255, 0, 255];

    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(1);
    expect(evaluateFrameSequence([frame]).violations).toEqual([
      expect.objectContaining({
        code: "CHROMA_FRINGE",
        actual: 1,
      }),
    ]);
  });

  it("does not classify a similarly colored interior detail as edge spill", () => {
    const frame = makeFrame("interior-purple", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [235, 158, 52, 255]);
      setPixel(32, 34, [109, 8, 103, 255]);
    });
    frame.keyRgb = [255, 0, 245];

    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(0);
    expect(evaluateFrameSequence([frame]).passed).toBe(true);
  });

  it("does not mistake a normal dark brown outline for magenta spill", () => {
    const key: [number, number, number] = [245, 12, 229];
    const frame = makeFrame("brown-outline", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [42, 15, 17, 255]);
      rectangle(setPixel, 22, 18, 20, 36, [235, 158, 52, 255]);
    });
    frame.keyRgb = key;

    expect(isChromaLike(42, 15, 17, key)).toBe(false);
    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(0);
    expect(evaluateFrameSequence([frame]).passed).toBe(true);
  });

  it("uses the original chroma image to catch a halo hidden one pixel inside", () => {
    const key: [number, number, number] = [255, 0, 255];
    const frame = makeFrame("evidence-backed-halo", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [35, 55, 115, 255]);
      setPixel(22, 30, [68, 32, 147, 255]);
    });
    const evidence = makeFrame("original-chroma", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [35, 55, 115, 255]);
      setPixel(22, 30, [155, 10, 182, 255]);
      setPixel(21, 30, [255, 0, 255, 255]);
    });
    frame.keyRgb = key;
    frame.evidenceRgba = evidence.rgba;

    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(1);
    expect(evaluateFrameSequence([frame]).violations).toEqual([
      expect.objectContaining({
        code: "CHROMA_FRINGE",
        actual: 1,
      }),
    ]);
  });

  it("does not flag a nearly black outline solely because chroma evidence is nearby", () => {
    const key: [number, number, number] = [255, 0, 255];
    const frame = makeFrame("black-outline", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [45, 105, 55, 255]);
      setPixel(22, 30, [12, 5, 19, 255]);
    });
    const evidence = makeFrame("original-chroma", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [45, 105, 55, 255]);
      setPixel(22, 30, [151, 7, 164, 255]);
      setPixel(21, 30, [255, 0, 255, 255]);
    });
    frame.keyRgb = key;
    frame.evidenceRgba = evidence.rgba;

    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(0);
    expect(evaluateFrameSequence([frame]).passed).toBe(true);
  });

  it("accepts a despilled edge color continued by the immediate local palette", () => {
    const key: [number, number, number] = [245, 12, 229];
    const frame = makeFrame("palette-witness", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [235, 158, 52, 255]);
      setPixel(22, 30, [80, 3, 16, 255]);
      setPixel(23, 30, [80, 3, 16, 255]);
    });
    const evidence = makeFrame("original-chroma", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [235, 158, 52, 255]);
      setPixel(21, 30, key.concat(255) as [number, number, number, number]);
      setPixel(22, 30, [155, 3, 111, 255]);
      setPixel(23, 30, [80, 3, 16, 255]);
    });
    frame.keyRgb = key;
    frame.evidenceRgba = evidence.rgba;

    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(0);
    expect(evaluateFrameSequence([frame]).passed).toBe(true);
  });

  it("does not let a distant matching palette color hide an evidence-backed halo", () => {
    const key: [number, number, number] = [255, 0, 255];
    const frame = makeFrame("distant-palette-halo", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [45, 105, 55, 255]);
      setPixel(22, 30, [101, 65, 111, 255]);
      setPixel(40, 30, [101, 65, 111, 255]);
    });
    const evidence = makeFrame("original-chroma", (setPixel) => {
      rectangle(setPixel, 20, 16, 24, 40, [45, 105, 55, 255]);
      setPixel(21, 30, key.concat(255) as [number, number, number, number]);
      setPixel(22, 30, [171, 17, 176, 255]);
      setPixel(40, 30, [101, 65, 111, 255]);
    });
    frame.keyRgb = key;
    frame.evidenceRgba = evidence.rgba;

    expect(inspectRgbaFrame(frame).chromaFringePixels).toBe(1);
    expect(evaluateFrameSequence([frame]).violations).toEqual([
      expect.objectContaining({
        code: "CHROMA_FRINGE",
        actual: 1,
      }),
    ]);
  });
});
