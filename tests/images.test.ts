import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculatePoseSheetCells,
  createPoseSheetFrameAssets,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  parseEncodedImageDimensions,
  validateImageDimensions,
} from "../src/renderer/lib/images";

function pngFile(width: number, height: number, name = "pose-sheet.png"): File {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  const file = new File([bytes], name, { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.slice().buffer,
  });
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image dimension limits", () => {
  it("accepts normal mascot images within the documented limit", () => {
    expect(validateImageDimensions(1254, 1254)).toBeNull();
    expect(validateImageDimensions(2000, 2000)).toBeNull();
    expect(MAX_IMAGE_PIXELS).toBe(4_000_000);
  });

  it("rejects oversized or invalid dimensions before canvas processing", () => {
    expect(validateImageDimensions(2001, 2000)).toContain("4MP");
    expect(validateImageDimensions(MAX_IMAGE_EDGE + 1, 1)).toContain("4096px");
    expect(validateImageDimensions(0, 64)).toContain("확인하지 못했습니다");
    expect(validateImageDimensions(64.5, 64)).toContain("확인하지 못했습니다");
  });

  it("reads PNG dimensions from the encoded header before full pixel decode", () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 5000);
    view.setUint32(20, 64);
    const dimensions = parseEncodedImageDimensions(bytes, "image/png");
    expect(dimensions).toEqual({ width: 5000, height: 64 });
    expect(validateImageDimensions(dimensions!.width, dimensions!.height)).toContain("4096px");
  });

  it("rejects malformed encoded headers instead of falling through to full decode", () => {
    expect(parseEncodedImageDimensions(new Uint8Array(24), "image/png")).toBeNull();
    expect(parseEncodedImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg"))
      .toBeNull();
  });
});

describe("pose sheet import", () => {
  it("calculates exact equal cells from left to right", () => {
    expect(calculatePoseSheetCells(256, 64, 4)).toEqual([
      { index: 0, x: 0, y: 0, width: 64, height: 64 },
      { index: 1, x: 64, y: 0, width: 64, height: 64 },
      { index: 2, x: 128, y: 0, width: 64, height: 64 },
      { index: 3, x: 192, y: 0, width: 64, height: 64 },
    ]);
  });

  it("rejects a sheet whose width cannot be divided by the motion slot count", () => {
    expect(() => calculatePoseSheetCells(257, 64, 4)).toThrow(
      "257px을 4개 프레임으로 똑같이 나눌 수 없어요",
    );
  });

  it("applies the existing whole-image dimension limit before splitting", async () => {
    await expect(createPoseSheetFrameAssets(pngFile(MAX_IMAGE_EDGE + 1, 64), 4))
      .rejects.toThrow("4096px");
  });

  it("creates ordered FrameAssets for every rendered cell", async () => {
    const renderedCells: Array<{ x: number; width: number }> = [];
    const fakeImage = {
      naturalWidth: 256,
      naturalHeight: 64,
    } as HTMLImageElement;
    const frames = await createPoseSheetFrameAssets(
      pngFile(256, 64, "idle poses.png"),
      4,
      {
        loadImage: vi.fn().mockResolvedValue(fakeImage),
        renderCell: vi.fn(async (_image, cell) => {
          renderedCells.push({ x: cell.x, width: cell.width });
          return {
            dataUrl: `data:image/png;base64,${String(cell.index).padStart(4, "A")}`,
            byteLength: 4,
          };
        }),
        now: () => "2026-07-16T00:00:00.000Z",
      },
    );

    expect(renderedCells).toEqual([
      { x: 0, width: 64 },
      { x: 64, width: 64 },
      { x: 128, width: 64 },
      { x: 192, width: 64 },
    ]);
    expect(frames.map((frame) => frame.name)).toEqual([
      "idle poses-frame-01.png",
      "idle poses-frame-02.png",
      "idle poses-frame-03.png",
      "idle poses-frame-04.png",
    ]);
    expect(frames.map((frame) => [frame.width, frame.height])).toEqual([
      [64, 64],
      [64, 64],
      [64, 64],
      [64, 64],
    ]);
    expect(frames.every((frame) => frame.dataUrl === frame.originalDataUrl)).toBe(true);
  });

  it("uses a browser canvas to crop each cell at its exact source coordinate", async () => {
    const drawCalls: number[][] = [];
    class PoseSheetImage {
      naturalWidth = 128;
      naturalHeight = 32;
      onload: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.(new Event("load")));
      }
    }
    vi.stubGlobal("Image", PoseSheetImage);

    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName !== "canvas") return createElement(tagName);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: true,
          drawImage: (...args: unknown[]) => {
            drawCalls.push(args.slice(1) as number[]);
          },
        }),
        toBlob: (callback: BlobCallback) => {
          callback(new Blob([new Uint8Array([1])], { type: "image/png" }));
        },
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    await createPoseSheetFrameAssets(pngFile(128, 32), 4);

    expect(drawCalls).toEqual([
      [0, 0, 32, 32, 0, 0, 32, 32],
      [32, 0, 32, 32, 0, 0, 32, 32],
      [64, 0, 32, 32, 0, 0, 32, 32],
      [96, 0, 32, 32, 0, 0, 32, 32],
    ]);
  });

  it("rejects a rendered cell that exceeds the existing per-image byte limit", async () => {
    await expect(
      createPoseSheetFrameAssets(pngFile(256, 64), 4, {
        loadImage: vi.fn().mockResolvedValue({
          naturalWidth: 256,
          naturalHeight: 64,
        } as HTMLImageElement),
        renderCell: vi.fn().mockResolvedValue({
          dataUrl: "data:image/png;base64,AAAA",
          byteLength: MAX_IMAGE_BYTES + 1,
        }),
        now: () => "2026-07-16T00:00:00.000Z",
      }),
    ).rejects.toThrow("한 장당 20MB");
  });
});
