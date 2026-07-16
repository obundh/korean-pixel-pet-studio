// @vitest-environment node

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(""),
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getAppPath: () => "/unused-in-packaged-mode",
  },
  shell: {
    openExternal: electronMocks.openExternal,
    openPath: electronMocks.openPath,
  },
}));

import {
  openLegalDirectory,
  openSourceRepository,
} from "../src/main/legal-resources";

const originalResourcesPath = Object.getOwnPropertyDescriptor(
  process,
  "resourcesPath",
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  electronMocks.openExternal.mockClear();
  electronMocks.openPath.mockClear();
  if (originalResourcesPath) {
    Object.defineProperty(process, "resourcesPath", originalResourcesPath);
  } else {
    Reflect.deleteProperty(process, "resourcesPath");
  }
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe("protected legal resources", () => {
  it("opens the one fixed HTTPS source repository", async () => {
    await expect(openSourceRepository()).resolves.toEqual({ status: "opened" });
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      "https://github.com/obundh/korean-pixel-pet-studio",
    );
  });

  it("opens only the packaged legal directory under resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pixelpet-legal-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "legal"));
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: root,
    });

    await expect(openLegalDirectory()).resolves.toEqual({ status: "opened" });
    expect(electronMocks.openPath).toHaveBeenCalledWith(
      path.join(root, "legal"),
    );
  });
});
