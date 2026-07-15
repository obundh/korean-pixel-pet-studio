import { contextBridge, ipcRenderer } from "electron";

import type {
  ExportPetRequest,
  IpcChannels,
  PetRenderCommand,
  PetWindowState,
  PixelPetApi,
  SaveProjectRequest,
  StartPetRequest,
  UpdatePetRequest,
} from "../shared/ipc.js";

// Keep the sandboxed preload self-contained. Sandboxed Electron preloads have
// a deliberately limited `require`, so runtime imports of local shared files
// would work in TypeScript but fail after packaging.
const IPC_CHANNELS = {
  projectSave: "pixelpet:project:save",
  projectLoad: "pixelpet:project:load",
  exportPet: "pixelpet:export:save",
  petStart: "pixelpet:pet:start",
  petUpdate: "pixelpet:pet:update",
  petStop: "pixelpet:pet:stop",
  petGetState: "pixelpet:pet:get-state",
  petStateChanged: "pixelpet:pet:state-changed",
  petRenderCommand: "pixelpet:pet:render-command",
} as const satisfies IpcChannels;

const platform: PixelPetApi["platform"] =
  process.platform === "darwin" || process.platform === "win32"
    ? process.platform
    : "linux";

const petStateListeners = new Set<(state: PetWindowState) => void>();
const petCommandListeners = new Set<(command: PetRenderCommand) => void>();
const bufferedPetCommands: PetRenderCommand[] = [];
let latestPetState: PetWindowState | null = null;

ipcRenderer.on(
  IPC_CHANNELS.petStateChanged,
  (_event: Electron.IpcRendererEvent, state: PetWindowState) => {
    latestPetState = state;
    for (const listener of petStateListeners) listener(state);
  },
);

ipcRenderer.on(
  IPC_CHANNELS.petRenderCommand,
  (_event: Electron.IpcRendererEvent, command: PetRenderCommand) => {
    if (petCommandListeners.size === 0) {
      bufferedPetCommands.push(command);
      if (bufferedPetCommands.length > 16) bufferedPetCommands.shift();
      return;
    }
    for (const listener of petCommandListeners) listener(command);
  },
);

const api: PixelPetApi = Object.freeze({
  platform,
  startPet: (request: StartPetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.petStart, request),
  updatePet: (request: UpdatePetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.petUpdate, request),
  stopPet: () => ipcRenderer.invoke(IPC_CHANNELS.petStop),
  getPetState: () => ipcRenderer.invoke(IPC_CHANNELS.petGetState),
  saveProject: (request: SaveProjectRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectSave, request),
  loadProject: () => ipcRenderer.invoke(IPC_CHANNELS.projectLoad),
  exportPet: (request: ExportPetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportPet, request),
  onPetState: (listener: (state: PetWindowState) => void) => {
    petStateListeners.add(listener);
    if (latestPetState) {
      const state = latestPetState;
      queueMicrotask(() => {
        if (petStateListeners.has(listener)) listener(state);
      });
    }
    return () => petStateListeners.delete(listener);
  },
  onPetCommand: (listener: (command: PetRenderCommand) => void) => {
    petCommandListeners.add(listener);
    if (bufferedPetCommands.length > 0) {
      const commands = bufferedPetCommands.splice(0);
      queueMicrotask(() => {
        if (!petCommandListeners.has(listener)) return;
        for (const command of commands) listener(command);
      });
    }
    return () => petCommandListeners.delete(listener);
  },
});

contextBridge.exposeInMainWorld("pixelPet", api);
