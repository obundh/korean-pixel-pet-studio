import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  parseEncodedImageDimensions,
  validateImageDimensions,
} from "../src/renderer/lib/images";

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
