import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PetSurface } from "../src/renderer/components/PetSurface";
import type { PetRenderCommand, PixelPetApi } from "../src/shared/ipc";
import type { PixelPetFrameAsset, PixelPetProject } from "../src/shared/project";

function frame(index: number, prefix = "frame"): PixelPetFrameAsset {
  const dataUrl = `data:image/png;base64,${prefix}-${index}`;
  return {
    id: `${prefix}-${index}`,
    name: `${prefix}-${index}.png`,
    dataUrl,
    originalDataUrl: dataUrl,
    width: 64,
    height: 64,
    backgroundRemoved: true,
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function project(): PixelPetProject {
  return {
    version: 1,
    name: "순서 테스트 펫",
    activeKitId: "test:playback",
    frames: {
      idle: [frame(0), frame(1), frame(2), frame(3)],
      walk: [],
      jump: [],
      sleep: [],
      reaction: [
        frame(0, "reaction"),
        frame(1, "reaction"),
        frame(2, "reaction"),
        frame(3, "reaction"),
      ],
    },
    fps: 4,
    motionFps: {
      idle: 4,
      walk: 8,
      jump: 8,
      sleep: 4,
      reaction: 8,
    },
    scale: 3,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function installPetApi() {
  let listener: ((command: PetRenderCommand) => void) | undefined;
  Object.defineProperty(window, "pixelPet", {
    configurable: true,
    value: {
      onPetCommand(nextListener: (command: PetRenderCommand) => void) {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    } as unknown as PixelPetApi,
  });
  return (command: PetRenderCommand) => {
    if (!listener) throw new Error("pet command listener was not installed");
    act(() => listener?.(command));
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "pixelPet");
  document.documentElement.classList.remove("pet-window");
  document.body.classList.remove("pet-window");
});

describe("desktop-pet chronological playback", () => {
  it("renders 0→1→2→3→0 at the project FPS without a second CSS motion", () => {
    vi.useFakeTimers();
    const send = installPetApi();
    render(<PetSurface />);
    send({
      type: "hydrate",
      project: project(),
      animation: "idle",
      direction: "right",
      paused: false,
    });

    const surface = screen.getByLabelText("순서 테스트 펫 데스크톱 펫");
    const rendered: string[] = [];
    const capture = () => rendered.push(surface.querySelector("img")?.getAttribute("src") ?? "");
    capture();
    for (let step = 0; step < 4; step += 1) {
      act(() => vi.advanceTimersByTime(250));
      capture();
    }

    expect(rendered).toEqual([
      "data:image/png;base64,frame-0",
      "data:image/png;base64,frame-1",
      "data:image/png;base64,frame-2",
      "data:image/png;base64,frame-3",
      "data:image/png;base64,frame-0",
    ]);
    expect(surface).toHaveAttribute("data-motion-driver", "frames");
    expect(surface).not.toHaveClass("pet-motion--idle");
  });

  it("uses the selected motion's FPS instead of the last global setting", () => {
    vi.useFakeTimers();
    const send = installPetApi();
    render(<PetSurface />);
    send({
      type: "hydrate",
      project: project(),
      animation: "reaction",
      direction: "right",
      paused: false,
    });

    const image = screen
      .getByLabelText("순서 테스트 펫 데스크톱 펫")
      .querySelector("img");
    expect(image).toHaveAttribute("src", "data:image/png;base64,reaction-0");
    act(() => vi.advanceTimersByTime(125));
    expect(image).toHaveAttribute("src", "data:image/png;base64,reaction-1");
  });
});
