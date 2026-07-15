import { describe, expect, it } from "vitest";

import {
  PET_ANIMATION_NAMES,
  PIXELPET_PROJECT_VERSION,
  createEmptyFrameMap,
  isPixelPetChromaKey,
} from "../src/shared/project";

describe("PixelPet project contract", () => {
  it("keeps the portable project version and all animation lanes stable", () => {
    expect(PIXELPET_PROJECT_VERSION).toBe(1);
    expect(PET_ANIMATION_NAMES).toEqual([
      "idle",
      "walk",
      "jump",
      "sleep",
      "reaction",
    ]);
    expect(createEmptyFrameMap()).toEqual({
      idle: [],
      walk: [],
      jump: [],
      sleep: [],
      reaction: [],
    });
  });

  it("accepts only a three-channel byte tuple as persisted chroma metadata", () => {
    expect(isPixelPetChromaKey([0, 128, 255])).toBe(true);
    expect(isPixelPetChromaKey([0, 128])).toBe(false);
    expect(isPixelPetChromaKey([0, 128, 256])).toBe(false);
    expect(isPixelPetChromaKey([0, 1.5, 2])).toBe(false);
    expect(isPixelPetChromaKey("0,128,255")).toBe(false);
  });
});
