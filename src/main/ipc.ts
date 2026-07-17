import { ipcMain, type IpcMainInvokeEvent } from "electron";

import {
  IPC_CHANNELS,
  type ExportPetRequest,
  type SaveProjectRequest,
  type StartPetRequest,
  type UpdatePetRequest,
} from "../shared/ipc.js";
import {
  openLegalDirectory,
  openSourceRepository,
} from "./legal-resources.js";
import type { ProjectFileService } from "./project-files.js";
import type { WindowManager } from "./window-manager.js";

function replaceHandler(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

export function registerIpcHandlers(
  windows: WindowManager,
  projectFiles: ProjectFileService,
): void {
  const requireTrusted = (event: IpcMainInvokeEvent): void => {
    if (!windows.isTrustedSender(event.sender.id)) {
      throw new Error("IPC request rejected: unknown sender.");
    }
  };
  const requireStudio = (event: IpcMainInvokeEvent): void => {
    if (!windows.isStudioSender(event.sender.id)) {
      throw new Error("IPC request rejected: studio window required.");
    }
  };

  replaceHandler(IPC_CHANNELS.petStart, async (event, request) => {
    requireStudio(event);
    return windows.startPet(request as StartPetRequest);
  });
  replaceHandler(IPC_CHANNELS.petUpdate, (event, request) => {
    requireTrusted(event);
    return windows.updatePet(request as UpdatePetRequest);
  });
  replaceHandler(IPC_CHANNELS.petStop, (event) => {
    requireTrusted(event);
    return windows.stopPet();
  });
  replaceHandler(IPC_CHANNELS.petGetState, (event) => {
    requireTrusted(event);
    return windows.getPetState();
  });
  replaceHandler(IPC_CHANNELS.projectSave, async (event, request) => {
    requireStudio(event);
    return projectFiles.save(request as SaveProjectRequest);
  });
  replaceHandler(IPC_CHANNELS.projectLoad, async (event) => {
    requireStudio(event);
    return projectFiles.load();
  });
  replaceHandler(IPC_CHANNELS.exportPet, async (event, request) => {
    requireStudio(event);
    return projectFiles.export(request as ExportPetRequest);
  });
  replaceHandler(IPC_CHANNELS.legalOpenSource, async (event) => {
    requireStudio(event);
    return openSourceRepository();
  });
  replaceHandler(IPC_CHANNELS.legalOpenDirectory, async (event) => {
    requireStudio(event);
    return openLegalDirectory();
  });
}

export function unregisterIpcHandlers(): void {
  for (const channel of [
    IPC_CHANNELS.petStart,
    IPC_CHANNELS.petUpdate,
    IPC_CHANNELS.petStop,
    IPC_CHANNELS.petGetState,
    IPC_CHANNELS.projectSave,
    IPC_CHANNELS.projectLoad,
    IPC_CHANNELS.exportPet,
    IPC_CHANNELS.legalOpenSource,
    IPC_CHANNELS.legalOpenDirectory,
  ]) {
    ipcMain.removeHandler(channel);
  }
}
