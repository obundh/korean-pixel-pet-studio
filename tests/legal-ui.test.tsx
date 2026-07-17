import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PixelPetApi } from "../src/shared/ipc";

vi.mock("../src/renderer/lib/referenceCatalog", () => ({
  loadReferenceCatalog: vi.fn().mockResolvedValue({
    isFallback: false,
    examples: [],
    styles: [],
    poses: [],
  }),
}));

import App from "../src/renderer/App";

const petState = {
  status: "stopped" as const,
  animation: "idle" as const,
  direction: "right" as const,
  position: null,
  size: null,
  motion: { velocityX: 0, velocityY: 0, bounce: true },
};

function installDesktopApi(overrides: Partial<PixelPetApi> = {}): PixelPetApi {
  const api: PixelPetApi = {
    platform: "linux",
    startPet: vi.fn(),
    updatePet: vi.fn(),
    stopPet: vi.fn(),
    getPetState: vi.fn().mockResolvedValue(petState),
    saveProject: vi.fn(),
    loadProject: vi.fn(),
    exportPet: vi.fn(),
    openSourceRepository: vi.fn().mockResolvedValue({ status: "opened" }),
    openLegalDirectory: vi.fn().mockResolvedValue({ status: "opened" }),
    onPetState: vi.fn(() => () => undefined),
    onPetCommand: vi.fn(() => () => undefined),
    ...overrides,
  };
  Object.defineProperty(window, "pixelPet", {
    configurable: true,
    value: api,
  });
  return api;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "pixelPet");
});

describe("open-source information", () => {
  it("opens only the fixed desktop source and legal-resource actions", async () => {
    const api = installDesktopApi();
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "오픈소스 및 라이선스 정보",
      }),
    );

    expect(
      screen.getByRole("dialog", { name: "오픈소스와 이용 권리" }),
    ).toBeVisible();
    expect(
      screen.getByText("AGPL-3.0-or-later", { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByText("Copyright © 2026 obundh and contributors"),
    ).toBeVisible();
    expect(screen.getByText("어떠한 보증도 없이", { exact: false })).toBeVisible();
    expect(
      screen.getByText("복제·수정·재배포", { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "https://github.com/obundh/korean-pixel-pet-studio",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "소스 저장소 보기" }));
    await waitFor(() => expect(api.openSourceRepository).toHaveBeenCalledWith());

    fireEvent.click(screen.getByRole("button", { name: "라이선스 폴더 열기" }));
    await waitFor(() => expect(api.openLegalDirectory).toHaveBeenCalledWith());
  });

  it("shows a clear error returned by the protected main-process action", async () => {
    installDesktopApi({
      openLegalDirectory: vi.fn().mockResolvedValue({
        status: "unavailable",
        message: "라이선스 고지 폴더가 아직 준비되지 않았습니다.",
      }),
    });
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "오픈소스 및 라이선스 정보",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "라이선스 폴더 열기" }));

    expect(
      await screen.findByText("라이선스 고지 폴더가 아직 준비되지 않았습니다."),
    ).toBeVisible();
  });
});
