import { app, shell } from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  SOURCE_REPOSITORY_URL,
  type OpenLegalResourceResult,
} from "../shared/ipc.js";

function isFixedSourceRepository(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.pathname.replace(/\/+$/, "") === "/obundh/korean-pixel-pet-studio" &&
    url.search === "" &&
    url.hash === ""
  );
}

async function firstAvailableLegalDirectory(): Promise<string | null> {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "legal")]
    : [
        path.resolve(app.getAppPath(), "build", "legal"),
        path.resolve(app.getAppPath(), "legal"),
      ];

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // A development checkout may not have prepared legal assets yet.
    }
  }
  return null;
}

export async function openSourceRepository(): Promise<OpenLegalResourceResult> {
  try {
    const url = new URL(SOURCE_REPOSITORY_URL);
    if (!isFixedSourceRepository(url)) {
      return {
        status: "unavailable",
        message: "허용된 소스 저장소 주소를 확인하지 못했습니다.",
      };
    }
    await shell.openExternal(url.toString());
    return { status: "opened" };
  } catch {
    return {
      status: "unavailable",
      message: "기본 브라우저에서 소스 저장소를 열지 못했습니다.",
    };
  }
}

export async function openLegalDirectory(): Promise<OpenLegalResourceResult> {
  const directory = await firstAvailableLegalDirectory();
  if (!directory) {
    return {
      status: "unavailable",
      message: "라이선스 고지 폴더가 아직 준비되지 않았습니다.",
    };
  }

  try {
    const errorMessage = await shell.openPath(directory);
    if (!errorMessage) return { status: "opened" };
  } catch {
    // Return the same user-safe message for OS and shell failures.
  }
  return {
    status: "unavailable",
    message: "파일 탐색기에서 라이선스 고지 폴더를 열지 못했습니다.",
  };
}
