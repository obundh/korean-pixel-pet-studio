import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PetSurface } from "../src/renderer/components/PetSurface";
import type { PetRenderCommand, PixelPetApi } from "../src/shared/ipc";
import type { PixelPetFrameAsset, PixelPetProject } from "../src/shared/project";

function frame(id: string): PixelPetFrameAsset {
  return {
    id,
    name: `${id}.png`,
    dataUrl: "data:image/png;base64,AA==",
    originalDataUrl: "data:image/png;base64,AA==",
    width: 64,
    height: 64,
    backgroundRemoved: true,
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function project(idleFrames: PixelPetFrameAsset[]): PixelPetProject {
  return {
    version: 1,
    name: "테스트 펫",
    activeKitId: "test",
    frames: {
      idle: idleFrames,
      walk: [],
      jump: [],
      sleep: [],
      reaction: [],
    },
    fps: 4,
    scale: 3,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function installPetApi() {
  let listener: ((command: PetRenderCommand) => void) | undefined;
  const api = {
    onPetCommand: vi.fn((nextListener: (command: PetRenderCommand) => void) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    }),
  } as unknown as PixelPetApi;
  Object.defineProperty(window, "pixelPet", {
    configurable: true,
    value: api,
  });
  return {
    send(command: PetRenderCommand) {
      if (!listener) throw new Error("pet command listener was not installed");
      act(() => listener?.(command));
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "pixelPet");
  document.documentElement.classList.remove("pet-window");
  document.body.classList.remove("pet-window");
});

describe("desktop pet motion", () => {
  it("uses frame timing alone for a multi-frame loop and CSS only as a single-frame fallback", () => {
    const api = installPetApi();
    render(<PetSurface />);

    api.send({
      type: "hydrate",
      project: project([frame("one"), frame("two")]),
      animation: "idle",
      direction: "right",
      paused: false,
    });

    const surface = screen.getByLabelText("테스트 펫 데스크톱 펫");
    expect(surface).toHaveAttribute("data-motion-driver", "frames");
    expect(surface).not.toHaveClass("pet-motion--idle");

    api.send({ type: "project", project: project([frame("only")]) });
    expect(surface).toHaveAttribute("data-motion-driver", "css");
    expect(surface).toHaveClass("pet-motion--idle");

    api.send({ type: "pause", paused: true });
    expect(surface).toHaveAttribute("data-motion-driver", "paused");
    expect(surface).not.toHaveClass("pet-motion--idle");
  });
});
