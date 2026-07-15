import { dialog, type BrowserWindow, type FileFilter } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  ExportPetRequest,
  ExportPetResult,
  LoadProjectResult,
  PetExportFormat,
  SaveProjectRequest,
  SaveProjectResult,
} from "../shared/ipc.js";
import {
  PET_ANIMATION_NAMES,
  PIXELPET_PROJECT_VERSION,
  type PixelPetFrameAsset,
  type PixelPetProject,
} from "../shared/project.js";

const MAX_PROJECT_BYTES = 128 * 1024 * 1024;
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
const MAX_FRAMES_PER_ANIMATION = 240;

const EXPORT_OPTIONS: Record<
  PetExportFormat,
  { extension: string; filter: FileFilter }
> = {
  png: { extension: "png", filter: { name: "PNG image", extensions: ["png"] } },
  gif: { extension: "gif", filter: { name: "GIF animation", extensions: ["gif"] } },
  webp: {
    extension: "webp",
    filter: { name: "WebP animation", extensions: ["webp"] },
  },
  apng: {
    extension: "png",
    filter: { name: "Animated PNG", extensions: ["png"] },
  },
  spritesheet: {
    extension: "png",
    filter: { name: "PNG sprite sheet", extensions: ["png"] },
  },
  json: { extension: "json", filter: { name: "JSON data", extensions: ["json"] } },
  zip: { extension: "zip", filter: { name: "ZIP archive", extensions: ["zip"] } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFrameAsset(value: unknown): value is PixelPetFrameAsset {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.dataUrl === "string" &&
    typeof value.originalDataUrl === "string" &&
    isPositiveFiniteNumber(value.width) &&
    isPositiveFiniteNumber(value.height) &&
    typeof value.backgroundRemoved === "boolean" &&
    isNonEmptyString(value.updatedAt)
  );
}

/** Runtime guard for documents crossing the renderer/main trust boundary. */
export function assertPixelPetProject(value: unknown): asserts value is PixelPetProject {
  if (!isRecord(value)) throw new TypeError("PixelPet project must be an object.");
  if (value.version !== PIXELPET_PROJECT_VERSION) {
    throw new TypeError(`Unsupported PixelPet project version: ${String(value.version)}`);
  }
  if (!isNonEmptyString(value.name) || !isNonEmptyString(value.activeKitId)) {
    throw new TypeError("PixelPet project name and active kit are required.");
  }
  if (!isPositiveFiniteNumber(value.fps) || value.fps > 60) {
    throw new TypeError("PixelPet FPS must be between 0 and 60.");
  }
  if (!isPositiveFiniteNumber(value.scale) || value.scale > 16) {
    throw new TypeError("PixelPet scale must be between 0 and 16.");
  }
  if (!isNonEmptyString(value.createdAt) || !isNonEmptyString(value.updatedAt)) {
    throw new TypeError("PixelPet timestamps are required.");
  }
  if (!isRecord(value.frames)) {
    throw new TypeError("PixelPet frames must be grouped by animation.");
  }

  for (const animation of PET_ANIMATION_NAMES) {
    const frames = value.frames[animation];
    if (!Array.isArray(frames) || frames.length > MAX_FRAMES_PER_ANIMATION) {
      throw new TypeError(`Invalid ${animation} frame collection.`);
    }
    if (!frames.every((frame) => frame === null || isFrameAsset(frame))) {
      throw new TypeError(`Invalid frame in ${animation} animation.`);
    }
  }
}

function sanitizeFileStem(value: string): string {
  const stem = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return stem || "pixel-pet";
}

function withExtension(filePath: string, extension: string): string {
  return filePath.toLocaleLowerCase().endsWith(`.${extension}`)
    ? filePath
    : `${filePath}.${extension}`;
}

async function writeFileAtomically(filePath: string, data: string | Uint8Array): Promise<void> {
  const byteLength = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
  if (byteLength > MAX_EXPORT_BYTES) {
    throw new RangeError("Export is larger than the 256 MiB safety limit.");
  }

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, data);
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class ProjectFileService {
  readonly #getOwnerWindow: () => BrowserWindow | null;
  readonly #authorizedProjectPaths = new Set<string>();

  constructor(getOwnerWindow: () => BrowserWindow | null) {
    this.#getOwnerWindow = getOwnerWindow;
  }

  async save(request: SaveProjectRequest): Promise<SaveProjectResult> {
    assertPixelPetProject(request.project);

    let targetPath: string | undefined;
    if (request.currentPath && !request.saveAs) {
      const normalizedPath = path.resolve(request.currentPath);
      if (this.#authorizedProjectPaths.has(normalizedPath)) targetPath = normalizedPath;
    }

    if (!targetPath) {
      const owner = this.#getOwnerWindow();
      const options = {
        title: "PixelPet 프로젝트 저장",
        defaultPath: `${sanitizeFileStem(request.project.name)}.pixelpet`,
        filters: [
          { name: "PixelPet project", extensions: ["pixelpet"] },
          { name: "JSON", extensions: ["json"] },
        ],
        properties: ["showOverwriteConfirmation" as const, "createDirectory" as const],
      };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { status: "cancelled" };
      targetPath = withExtension(result.filePath, "pixelpet");
    }

    const serialized = `${JSON.stringify(request.project, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_PROJECT_BYTES) {
      throw new RangeError("Project is larger than the 128 MiB safety limit.");
    }
    await writeFileAtomically(targetPath, serialized);
    const normalizedTarget = path.resolve(targetPath);
    this.#authorizedProjectPaths.add(normalizedTarget);
    return { status: "saved", path: normalizedTarget };
  }

  async load(): Promise<LoadProjectResult> {
    const owner = this.#getOwnerWindow();
    const options = {
      title: "PixelPet 프로젝트 열기",
      filters: [
        { name: "PixelPet project", extensions: ["pixelpet", "json"] },
      ],
      properties: ["openFile" as const],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { status: "cancelled" };

    const projectPath = path.resolve(result.filePaths[0]);
    const stats = await fs.stat(projectPath);
    if (!stats.isFile() || stats.size > MAX_PROJECT_BYTES) {
      throw new RangeError("Project is not a file or exceeds the 128 MiB safety limit.");
    }

    const serialized = await fs.readFile(projectPath, "utf8");
    const project: unknown = JSON.parse(serialized);
    assertPixelPetProject(project);
    this.#authorizedProjectPaths.add(projectPath);
    return { status: "loaded", path: projectPath, project };
  }

  async export(request: ExportPetRequest): Promise<ExportPetResult> {
    if (!isNonEmptyString(request.suggestedName)) {
      throw new TypeError("An export file name is required.");
    }
    if (!Object.prototype.hasOwnProperty.call(EXPORT_OPTIONS, request.format)) {
      throw new TypeError("Unsupported export format.");
    }
    if (typeof request.data !== "string" && !(request.data instanceof Uint8Array)) {
      throw new TypeError("Export data must be text or a Uint8Array.");
    }

    const { extension, filter } = EXPORT_OPTIONS[request.format];
    const owner = this.#getOwnerWindow();
    const options = {
      title: "PixelPet 내보내기",
      defaultPath: withExtension(sanitizeFileStem(request.suggestedName), extension),
      filters: [filter],
      properties: ["showOverwriteConfirmation" as const, "createDirectory" as const],
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { status: "cancelled" };

    const targetPath = withExtension(result.filePath, extension);
    await writeFileAtomically(targetPath, request.data);
    return { status: "exported", path: path.resolve(targetPath) };
  }
}
