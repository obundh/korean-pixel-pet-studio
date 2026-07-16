import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/lib/referenceCatalog", () => ({
  loadReferenceCatalog: vi.fn().mockResolvedValue({
    isFallback: false,
    examples: [],
    styles: [{ id: "soft", label: "소프트", canvas: "64 × 64" }],
    poses: [],
  }),
}));

import App from "../src/renderer/App";

afterEach(() => cleanup());

describe("motion frame beginner controls", () => {
  it("exposes the bulk input and one-click shared processing button", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("workflow-step-frames"));

    expect(screen.getByTestId("bulk-motion-frames-input")).toHaveAttribute("multiple");
    expect(screen.getByTestId("process-motion-frames")).toHaveTextContent(
      "이 동작 한 번에 정리",
    );
    expect(screen.getByTestId("process-motion-frames")).toBeDisabled();
    expect(screen.getByTestId("motion-frame-processing-status")).toHaveTextContent(
      "이 동작 한 번에 정리",
    );
  });

  it("keeps a separate playback rate for each motion tab", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("workflow-step-preview"));

    expect(screen.getByLabelText("대기 프레임 속도")).toHaveValue("4");
    fireEvent.click(screen.getByRole("tab", { name: /걷기/ }));
    const walkSpeed = screen.getByLabelText("걷기 프레임 속도");
    expect(walkSpeed).toHaveValue("8");
    fireEvent.change(walkSpeed, { target: { value: "10" } });

    fireEvent.click(screen.getByRole("tab", { name: /대기/ }));
    expect(screen.getByLabelText("대기 프레임 속도")).toHaveValue("4");
    fireEvent.click(screen.getByRole("tab", { name: /걷기/ }));
    expect(screen.getByLabelText("걷기 프레임 속도")).toHaveValue("10");
  });
});
