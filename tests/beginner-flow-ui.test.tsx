import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  schemaVersion: "1.0.0",
  kitName: "beginner-flow-test-kit",
  isFallback: false,
  examples: [],
  styles: [
    {
      id: "soft-cluster-16",
      label: "소프트 클러스터",
      image: "/mock/style-board.png",
      canvas: "64 × 64",
      paletteMax: 16,
      prompt: "Use crisp pixel clusters.",
    },
  ],
  poses: [
    {
      id: "idle-breathe-4",
      label: "대기 호흡",
      loop: true,
      guideImage: "/mock/idle-pose-guide.png",
      frames: Array.from({ length: 4 }, (_, index) => ({
        id: `idle-${index + 1}`,
        label: `대기 ${index + 1}`,
        image: `/mock/idle-${index + 1}.png`,
      })),
      durationsMs: [250, 250, 250, 250],
      prompt: "Keep the idle motion subtle.",
    },
  ],
}));

vi.mock("../src/renderer/lib/referenceCatalog", () => ({
  loadReferenceCatalog: vi.fn().mockResolvedValue(catalog),
}));

import App from "../src/renderer/App";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "pixelPet");
});

describe("beginner one-image workflow", () => {
  it("keeps the generation guide to one source image and two separate AI requests", async () => {
    const { container } = render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "준비할 것은 마스코트 이미지 1장뿐이에요",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("사용자 준비물: 마스코트 원본 1장"),
    ).toBeVisible();

    expect(
      screen.getByRole("heading", { name: "원본 한 장으로 픽셀 마스터 만들기" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "1차 프롬프트 복사" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "마스터와 가이드로 4칸 시트 만들기" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "2차 프롬프트 복사" }),
    ).toBeVisible();

    const guideLink = await screen.findByRole("link", {
      name: "대기 포즈 가이드 1장 저장",
    });
    expect(guideLink).toHaveAttribute("href", catalog.poses[0].guideImage);
    expect(guideLink).toHaveAttribute(
      "download",
      "pixelpet-idle-pose-guide-4cuts.png",
    );

    await waitFor(() => {
      expect(
        container.querySelector(`img[src="${catalog.styles[0].image}"]`),
      ).not.toBeInTheDocument();
    });
  });

  it("shows one idle sheet by default and keeps all 28 motion slots in collapsed advanced settings", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByTestId("workflow-step-frames"));

    expect(
      screen.getByRole("heading", { name: "대기 포즈 시트 한 장만 가져오세요" }),
    ).toBeVisible();
    expect(screen.getByTestId("pose-sheet-import")).toHaveTextContent(
      "대기 포즈 시트 한 장 가져오기",
    );
    expect(screen.getByTestId("pose-sheet-input")).not.toHaveAttribute("multiple");
    expect(
      screen.getByText("프레임 파일 4개가 아니라 시트 파일 1개예요"),
    ).toBeVisible();

    const advanced = container.querySelector<HTMLDetailsElement>(
      "details.advanced-frames-disclosure",
    );
    expect(advanced).not.toBeNull();
    expect(advanced).not.toHaveAttribute("open");

    const advancedUi = within(advanced!);
    const summary = advancedUi.getByText("추가 동작·개별 프레임 고급 설정").closest("summary");
    expect(summary).not.toBeNull();
    const collapsedWalkTab = advancedUi.getByRole("tab", { name: /걷기/ });
    expect(advanced).toContainElement(collapsedWalkTab);
    expect(collapsedWalkTab).not.toBeVisible();
    expect(screen.getByTestId("frame-slot-idle-0")).not.toBeVisible();

    fireEvent.click(summary!);
    expect(advanced).toHaveAttribute("open");

    const slotCounts = [
      ["대기", 4],
      ["걷기", 8],
      ["점프", 6],
      ["잠자기", 4],
      ["반응", 6],
    ] as const;
    let totalSlots = 0;

    for (const [motion, expectedCount] of slotCounts) {
      fireEvent.click(advancedUi.getByRole("tab", { name: new RegExp(motion) }));
      const slots = advanced!.querySelectorAll<HTMLElement>(
        "[data-testid^='frame-slot-']",
      );
      expect(slots).toHaveLength(expectedCount);
      for (const slot of slots) expect(advanced).toContainElement(slot);
      totalSlots += slots.length;
    }

    expect(totalSlots).toBe(28);

    fireEvent.click(summary!);
    expect(advanced).not.toHaveAttribute("open");
    expect(screen.getByTestId("frame-slot-reaction-0")).not.toBeVisible();
  });

  it("treats idle as the only required motion in preview and completion", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByTestId("workflow-step-preview"));

    expect(screen.getByRole("tab", { name: /대기 0\/4/ })).toBeVisible();
    expect(
      screen.getByText("첫 펫은 대기 4컷만 확인하면 됩니다."),
    ).toBeVisible();

    const optionalPreview = container.querySelector<HTMLDetailsElement>(
      "details.preview-optional-motions",
    );
    expect(optionalPreview).not.toBeNull();
    expect(optionalPreview).not.toHaveAttribute("open");
    expect(
      within(optionalPreview!).getByRole("tab", { name: /걷기/ }),
    ).not.toBeVisible();

    fireEvent.click(screen.getByTestId("workflow-step-publish"));
    expect(
      screen.getByRole("heading", { name: "대기 4컷을 채우면 완성돼요" }),
    ).toBeVisible();

    const readiness = screen.getByTestId("beginner-readiness");
    expect(within(readiness).getByText("대기 4컷만 있으면 됩니다.")).toBeVisible();
    expect(within(readiness).getByText("0 / 4 frames")).toBeVisible();
    expect(within(readiness).getByText("추가 동작")).toBeVisible();
    expect(within(readiness).getByText("선택 사항")).toBeVisible();
    expect(within(readiness).queryByText("걷기")).not.toBeInTheDocument();
  });
});
