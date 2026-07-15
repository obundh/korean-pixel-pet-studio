import { describe, expect, it } from "vitest";

import {
  PET_ANIMATION_NAMES,
  PIXELPET_PROJECT_VERSION,
  createEmptyFrameMap,
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
});
