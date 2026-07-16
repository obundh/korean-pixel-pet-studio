import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FrameAsset } from "../src/renderer/types";

const mocks = vi.hoisted(() => ({
  createPoseSheetFrameAssets: vi.fn(),
}));

vi.mock("../src/renderer/lib/referenceCatalog", () => ({
  loadReferenceCatalog: vi.fn().mockResolvedValue({
    isFallback: false,
    examples: [],
    styles: [],
    poses: [],
  }),
}));

vi.mock("../src/renderer/lib/images", async () => {
  const actual = await vi.importActual<typeof import("../src/renderer/lib/images")>(
    "../src/renderer/lib/images",
  );
  return {
    ...actual,
    createPoseSheetFrameAssets: mocks.createPoseSheetFrameAssets,
  };
});

import App from "../src/renderer/App";

const frame = (index: number): FrameAsset => ({
  id: `sheet-frame-${index}`,
  name: `sheet-frame-${index + 1}.png`,
  dataUrl: `data:image/png;base64,${String(index).padStart(4, "A")}`,
  originalDataUrl: `data:image/png;base64,${String(index).padStart(4, "A")}`,
  width: 64,
  height: 64,
  backgroundRemoved: false,
  updatedAt: "2026-07-16T00:00:00.000Z",
});

afterEach(() => {
  cleanup();
  mocks.createPoseSheetFrameAssets.mockReset();
  Reflect.deleteProperty(window, "pixelPet");
});

describe("pose sheet import UI", () => {
  it("imports one sheet using the current motion slot count and fills slots in order", async () => {
    mocks.createPoseSheetFrameAssets.mockImplementation(
      async (_file: File, frameCount: number) =>
        Array.from({ length: frameCount }, (_, index) => frame(index)),
    );
    render(<App />);
    fireEvent.click(screen.getByTestId("workflow-step-frames"));

    const button = screen.getByTestId("pose-sheet-import");
    const input = screen.getByTestId("pose-sheet-input");
    expect(button).toHaveTextContent("포즈 시트 한 장 가져오기");
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
    expect(input).not.toHaveAttribute("multiple");

    const file = new File(["sheet"], "idle-sheet.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.createPoseSheetFrameAssets).toHaveBeenCalledWith(file, 4);
    });
    await waitFor(() => {
      expect(screen.getByTestId("frame-slot-idle-0").querySelector("img"))
        .toHaveAttribute("src", frame(0).dataUrl);
      expect(screen.getByTestId("frame-slot-idle-3").querySelector("img"))
        .toHaveAttribute("src", frame(3).dataUrl);
    });
    expect(
      screen.getByText("대기 포즈 시트를 왼쪽부터 4개 프레임으로 가져왔습니다."),
    ).toBeVisible();
  });
});
