import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: {} }));

import { assertPixelPetProject } from "../src/main/project-files";
import { MAX_IMAGE_BYTES } from "../src/shared/image-validation";
import { createEmptyFrameMap, type PixelPetProject } from "../src/shared/project";

const toDataUrl = (mimeType: string, bytes: Uint8Array): string =>
  `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

const pngDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return toDataUrl("image/png", bytes);
};

const jpegDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(11);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return toDataUrl("image/jpeg", bytes);
};

const webpDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(30);
  bytes.set([..."RIFF"].map((character) => character.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map((character) => character.charCodeAt(0)), 8);
  bytes.set([..."VP8X"].map((character) => character.charCodeAt(0)), 12);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes.set([
    encodedWidth & 0xff,
    (encodedWidth >> 8) & 0xff,
    (encodedWidth >> 16) & 0xff,
    encodedHeight & 0xff,
    (encodedHeight >> 8) & 0xff,
    (encodedHeight >> 16) & 0xff,
  ], 24);
  return toDataUrl("image/webp", bytes);
};

function projectWithFrame(overrides: Record<string, unknown> = {}): PixelPetProject {
  const dataUrl = pngDataUrl(64, 64);
  return {
    version: 1,
    name: "validation-fixture",
    activeKitId: "custom:soft-pixel",
    frames: {
      ...createEmptyFrameMap(),
      idle: [
        {
          id: "idle-1",
          name: "idle-1.png",
          dataUrl,
          originalDataUrl: dataUrl,
          width: 64,
          height: 64,
          backgroundRemoved: true,
          updatedAt: "2026-07-15T00:00:00.000Z",
          ...overrides,
        },
      ],
    },
    fps: 8,
    scale: 3,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  } as PixelPetProject;
}

describe("PixelPet project image trust boundary", () => {
  it("accepts existing local PNG/JPEG/WebP-style frame contracts without chroma metadata", () => {
    expect(() =>
      assertPixelPetProject(projectWithFrame({ originalDataUrl: jpegDataUrl(64, 64) })),
    ).not.toThrow();
    const webp = webpDataUrl(64, 64);
    expect(() =>
      assertPixelPetProject(projectWithFrame({ dataUrl: webp, originalDataUrl: webp })),
    ).not.toThrow();
  });

  it("accepts complete per-motion FPS values and rejects an invalid motion rate", () => {
    const project = projectWithFrame();
    project.motionFps = {
      idle: 4,
      walk: 8,
      jump: 8,
      sleep: 4,
      reaction: 8,
    };
    expect(() => assertPixelPetProject(project)).not.toThrow();

    project.motionFps.reaction = 0;
    expect(() => assertPixelPetProject(project)).toThrow(
      "PixelPet reaction FPS must be between 0 and 60",
    );
  });

  it("rejects remote and unsupported frame sources", () => {
    expect(() =>
      assertPixelPetProject(projectWithFrame({ dataUrl: "https://example.test/tracker.png" })),
    ).toThrow("Invalid frame in idle animation");
    expect(() =>
      assertPixelPetProject(
        projectWithFrame({ dataUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw=" }),
      ),
    ).toThrow("Invalid frame in idle animation");
  });

  it("rejects encoded dimensions that exceed the cap or disagree with frame metadata", () => {
    expect(() =>
      assertPixelPetProject(projectWithFrame({ dataUrl: pngDataUrl(4097, 1), width: 4097, height: 1 })),
    ).toThrow("Invalid frame in idle animation");
    expect(() =>
      assertPixelPetProject(projectWithFrame({ dataUrl: pngDataUrl(32, 64) })),
    ).toThrow("Invalid frame in idle animation");
    expect(() => assertPixelPetProject(projectWithFrame({ width: 64.5 }))).toThrow(
      "Invalid frame in idle animation",
    );
  });

  it("rejects a decoded frame payload larger than the direct-import limit", () => {
    const oversizedPayload = "A".repeat(Math.ceil((MAX_IMAGE_BYTES + 1) / 3) * 4);
    expect(() =>
      assertPixelPetProject(
        projectWithFrame({ dataUrl: `data:image/png;base64,${oversizedPayload}` }),
      ),
    ).toThrow("Invalid frame in idle animation");
  });
});
