import type { PetAnimationName, PixelPetProject } from "./project.js";

export const IPC_CHANNELS = {
  projectSave: "pixelpet:project:save",
  projectLoad: "pixelpet:project:load",
  exportPet: "pixelpet:export:save",
  petStart: "pixelpet:pet:start",
  petUpdate: "pixelpet:pet:update",
  petStop: "pixelpet:pet:stop",
  petGetState: "pixelpet:pet:get-state",
  petStateChanged: "pixelpet:pet:state-changed",
  petRenderCommand: "pixelpet:pet:render-command",
} as const;

export type IpcChannels = typeof IPC_CHANNELS;

export type PetDirection = "left" | "right";
export type PetRunStatus = "stopped" | "running" | "paused";

export interface Point {
  x: number;
  y: number;
}

export interface PetMotion {
  /** Horizontal velocity in physical screen pixels per second. */
  velocityX: number;
  /** Vertical velocity in physical screen pixels per second. */
  velocityY: number;
  /** Reflect velocity at the current display work-area boundary. */
  bounce: boolean;
}

export interface StartPetRequest {
  project: PixelPetProject;
  animation?: PetAnimationName;
  position?: Point;
  motion?: Partial<PetMotion>;
}

export interface UpdatePetRequest {
  project?: PixelPetProject;
  animation?: PetAnimationName;
  position?: Point;
  delta?: Point;
  motion?: Partial<PetMotion>;
  paused?: boolean;
}

export interface PetWindowState {
  status: PetRunStatus;
  animation: PetAnimationName;
  direction: PetDirection;
  position: Point | null;
  size: { width: number; height: number } | null;
  motion: PetMotion;
}

export type PetRenderCommand =
  | {
      type: "hydrate";
      project: PixelPetProject;
      animation: PetAnimationName;
      direction: PetDirection;
      paused: boolean;
    }
  | { type: "project"; project: PixelPetProject }
  | { type: "animation"; animation: PetAnimationName }
  | { type: "direction"; direction: PetDirection }
  | { type: "pause"; paused: boolean };

export interface SaveProjectRequest {
  project: PixelPetProject;
  /** A path previously returned by this API. Untrusted arbitrary paths are ignored. */
  currentPath?: string;
  saveAs?: boolean;
}

export type SaveProjectResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" };

export type LoadProjectResult =
  | { status: "loaded"; path: string; project: PixelPetProject }
  | { status: "cancelled" };

export type PetExportFormat =
  | "png"
  | "gif"
  | "webp"
  | "apng"
  | "spritesheet"
  | "json"
  | "zip";

export interface ExportPetRequest {
  suggestedName: string;
  format: PetExportFormat;
  /** Text for JSON exports, or raw encoded file bytes for image/archive exports. */
  data: string | Uint8Array;
}

export type ExportPetResult =
  | { status: "exported"; path: string }
  | { status: "cancelled" };

export interface PixelPetApi {
  readonly platform: "darwin" | "win32" | "linux";
  startPet(request: StartPetRequest): Promise<PetWindowState>;
  updatePet(request: UpdatePetRequest): Promise<PetWindowState>;
  stopPet(): Promise<PetWindowState>;
  getPetState(): Promise<PetWindowState>;
  saveProject(request: SaveProjectRequest): Promise<SaveProjectResult>;
  loadProject(): Promise<LoadProjectResult>;
  exportPet(request: ExportPetRequest): Promise<ExportPetResult>;
  onPetState(listener: (state: PetWindowState) => void): () => void;
  onPetCommand(listener: (command: PetRenderCommand) => void): () => void;
}
