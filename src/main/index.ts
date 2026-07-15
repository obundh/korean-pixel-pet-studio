import { app, session } from "electron";

import { installAppProtocol, registerAppScheme } from "./app-protocol.js";
import { registerIpcHandlers, unregisterIpcHandlers } from "./ipc.js";
import { ProjectFileService } from "./project-files.js";
import { WindowManager } from "./window-manager.js";

registerAppScheme();

const windows = new WindowManager();
const projectFiles = new ProjectFileService(() => windows.studioWindow);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void windows.createStudioWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("studio.pixelpet.app");
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    await installAppProtocol();
    registerIpcHandlers(windows, projectFiles);
    await windows.createStudioWindow();

    app.on("activate", () => {
      void windows.createStudioWindow();
    });
  });
}

app.on("before-quit", () => {
  unregisterIpcHandlers();
  windows.dispose();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
